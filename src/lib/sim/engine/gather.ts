import { mix } from "../rng";
import type { Op } from "../types";
import type { Gather, NodeRt, Req } from "./model";
import { Sim, attach } from "./sim";

/**
 * Fan-out and gather: one primitive, a request sent out in parts and gathered back (`scatter`), serves fan-out to
 * shards (with hedging), quorum reads and writes, a cluster leader's commits, and a traced route's calls made at the
 * same time. The route each request takes is picked here too: routes come only with traces, whose calls gather.
 */
const gather: Partial<Sim> & ThisType<Sim> = {
  /** The route a logical request takes: by its hash, in proportion to the routes' shares. */
  wayOf(routes: Record<string, number>, id: number) {
    const ways = Object.entries(routes);
    let u = (mix(id ^ 0x5bd1e995) / 2 ** 32) * ways.reduce((s, [, w]) => s + Math.max(0, w), 0);
    for (const [name, w] of ways) if ((u -= Math.max(0, w)) < 0) return name;
    return ways[ways.length - 1]?.[0] ?? "";
  },

  /**
   * Send `r` out in parts, one to each target (a pool picks a member), and hold it until `need` parts have answered
   * well, or so many have failed that they can't. `free`: it waits without holding a worker (a database's commit).
   */
  scatter(n: NodeRt, r: Req, targets: (string | string[])[], need: number, op: Op, free = false) {
    r.result = null;
    r.calledAt = this.t;
    if (free) n.waiting.push(r);
    else n.held.push(r);
    const g: Gather = { parent: r, node: n.spec.id, op, need, got: 0, bad: 0, best: -1, slots: targets.map((call) => ({ call, done: false, sentAt: this.t, hedged: false, kids: [] })) };
    this.gathers.set(r.id, g);
    g.slots.forEach((_, i) => this.sendPart(n, g, i));
    if (this.gathers.has(r.id)) this.check(n, g);
  },

  /** One part (or its twin): a detached copy that comes back to `n` when answered. A target cut off by a partition fails it at once. */
  sendPart(n: NodeRt, g: Gather, i: number) {
    const s = g.slots[i];
    const r = g.parent;
    const to = typeof s.call === "string" ? s.call : this.resolve(n, s.call);
    const peer = this.nodes.get(to);
    if (!peer || this.cut(n, peer)) {
      s.done = true;
      g.bad++;
      return;
    }
    const c = this.make(n.spec.id, g.op, r.key, r.tag);
    c.detached = true;
    c.parentId = r.id;
    c.slot = i;
    c.seq = r.seq;
    c.first = r.first;
    c.logicalId = (r.logicalId ^ Math.imul(i + 1 + 31 * s.kids.length, 0x9e3779b1)) >>> 0;
    c.route = r.route;
    c.stack = [{ id: n.spec.id, calls: [] }];
    c.at = n.spec.id;
    s.kids.push(c);
    s.sentAt = this.t;
    this.parts.add(this.t);
    if (g.op === "repl") this.sendRepl(c, peer);
    else this.send(c, to);
  },

  /** A part came back. The first answer for its slot counts (a twin still on its way is cancelled); enough, or too few left, ends the wait. */
  gathered(n: NodeRt, c: Req) {
    c.phase = "gone";
    const g = this.gathers.get(c.parentId);
    if (!g || g.node !== n.spec.id) return;
    const s = g.slots[c.slot];
    if (!s || s.done) return;
    s.done = true;
    for (const k of s.kids) if (k !== c) k.abandoned = true;
    if (c.result !== "error" && c.result !== "rejected") {
      g.got++;
      g.best = Math.max(g.best, c.seq);
    } else g.bad++;
    this.check(n, g);
  },

  finishGather(n: NodeRt, g: Gather, ok: boolean) {
    this.gathers.delete(g.parent.id);
    // Parts still out are no longer wanted: their work is wasted.
    for (const s of g.slots) if (!s.done) for (const k of s.kids) k.abandoned = true;
    const r = g.parent;
    const held = n.held.indexOf(r);
    if (held >= 0) n.held.splice(held, 1);
    const waiting = n.waiting.indexOf(r);
    if (waiting >= 0) n.waiting.splice(waiting, 1);
    // Given up on while it waited (a call timeout, a crash): nothing to answer.
    if (held < 0 && waiting < 0) return;
    if (n.spec.quorum && r.op === "read") {
      r.seq = Math.max(0, g.best);
      r.stale = r.seq < (this.truth.get(r.key) ?? 0);
    }
    // A quorum write is the latest once enough replicas have it, not when it was sent: a read racing it isn't stale.
    if (ok && n.spec.quorum && r.op === "write") this.truth.set(r.key, Math.max(this.truth.get(r.key) ?? 0, r.seq));
    // A cluster leader's write is committed once a majority has it: only then is it applied, and counted.
    if (ok && n.spec.cluster && r.op === "write") this.commit(n, r);
    // A route's calls made at the same time are all in: on to its next step.
    const rest = r.stack[r.stack.length - 1]?.calls;
    if (ok && n.spec.paths && rest?.length) return this.call(n, r, rest);
    this.respond(r, ok ? "ok" : "error");
  },

  /** Enough parts answered well, or too many failed for `need` to be reached: the wait ends. */
  check(n: NodeRt, g: Gather) {
    if (g.got >= g.need) this.finishGather(n, g, true);
    else if (g.slots.length - g.bad < g.need) this.finishGather(n, g, false);
  },

  /** Every 10 ms at a server with `hedgeMs`: a part slower than that gets a twin, once. */
  hedge(n: NodeRt) {
    for (const g of this.gathers.values()) {
      if (g.node !== n.spec.id) continue;
      g.slots.forEach((s, i) => {
        if (s.done || s.hedged || this.t - s.sentAt < n.spec.hedgeMs!) return;
        s.hedged = true;
        this.hedges.add(this.t);
        this.sendPart(n, g, i);
      });
      this.check(n, g);
    }
  },

  /** A quorum coordinator: a write numbered and sent to every replica, answered (and counted the latest) at `w`; a read sent to `r` of the live ones in turn. */
  quorumDone(n: NodeRt, r: Req) {
    const q = n.spec.quorum!;
    if (r.op === "write") {
      r.seq = ++this.seq;
      return this.scatter(n, r, q.replicas, q.w, "repl");
    }
    // A read asks `r` of the replicas that are up, in turn (too few up: it fails).
    const live = q.replicas.filter((id) => this.nodes.get(id)?.up);
    if (live.length < q.r) return this.respond(r, "error");
    const start = n.rr++ % live.length;
    const ask = Array.from({ length: q.r }, (_, i) => live[(start + i) % live.length]);
    this.scatter(n, r, ask, ask.length, "read");
  },
};

attach("gather", gather);
