import type { Op } from "../types";
import type { Gather, NodeRt, Req } from "./model";
import { Sim } from "./sim";

/**
 * Coordination. One primitive, a request sent out in parts and gathered back (`scatter`), serves fan-out to shards
 * (with hedging), quorum reads and writes, and a cluster leader's commits. Around it: elections in a cluster, locks
 * with leases, bookings that read before they write (and compare-and-set), and sagas that undo what they did.
 */
const coordination: Partial<Sim> & ThisType<Sim> = {
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
    this.respond(r, ok ? "ok" : "error");
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

  // ------------------------------------------------------------------------------------------------ elections

  /** Every 10 ms at a cluster member: a leader beats; a member that has heard no leader for its timeout stands for election. */
  raftTick(n: NodeRt) {
    const c = n.spec.cluster!;
    const s = n.raft;
    if (n.spec.id === c.group[0]) {
      this.leaderSamples.add(this.t);
      if (!c.group.some((id) => this.nodes.get(id)?.up && this.nodes.get(id)!.raft.role === "leader")) this.leaderless.add(this.t);
    }
    if (!n.up) return;
    if (!s.timeout) s.timeout = c.electionMs[0] + n.rng() * (c.electionMs[1] - c.electionMs[0]);
    if (s.role === "leader") {
      if (this.t < s.nextBeat) return;
      s.nextBeat = this.t + c.heartbeatMs;
      for (const id of c.group) if (id !== n.spec.id) this.raftSend(n, id, "beat");
      return;
    }
    if (this.t - s.lastBeat < s.timeout) return;
    // Silence: a new term, and this member stands for it.
    s.term++;
    s.role = "candidate";
    s.votedFor = n.spec.id;
    s.votes = new Set([n.spec.id]);
    s.lastBeat = this.t;
    s.timeout = c.electionMs[0] + n.rng() * (c.electionMs[1] - c.electionMs[0]);
    if (c.majority === false || c.group.length === 1) return this.lead(n);
    for (const id of c.group) if (id !== n.spec.id) this.raftSend(n, id, "vote");
  },

  /** A beat or a request for votes reaches a member. A later term makes it a follower of that term; one vote per term, to the first who asks. */
  raftMessage(n: NodeRt, r: Req) {
    const s = n.raft;
    if (!n.up || !n.spec.cluster) {
      r.phase = "gone";
      return;
    }
    if (r.term > s.term) {
      s.term = r.term;
      s.votedFor = "";
      s.role = "follower";
    }
    if (r.op === "beat") {
      if (r.term >= s.term) {
        s.role = "follower";
        s.leader = r.client;
        s.lastBeat = this.t;
      }
      r.phase = "gone";
      return;
    }
    const grant = r.term >= s.term && (s.votedFor === "" || s.votedFor === r.client);
    if (grant) {
      s.votedFor = r.client;
      s.lastBeat = this.t;
    }
    this.respond(r, grant ? "ok" : "rejected");
  },

  /** A vote comes back to its candidate: a majority of the group makes it leader. */
  raftReply(n: NodeRt, r: Req) {
    r.phase = "gone";
    const s = n.raft;
    if (s.role !== "candidate" || r.term !== s.term || r.result !== "ok") return;
    s.votes.add(r.from);
    if (s.votes.size > n.spec.cluster!.group.length / 2) this.lead(n);
  },

  /** The leader this member would pass a write to: one it knows of, up, and not cut off from it. */
  leaderOf(n: NodeRt) {
    const id = n.raft.leader;
    const m = id && id !== n.spec.id ? this.nodes.get(id) : undefined;
    return m && m.up && m.raft.role === "leader" && !this.cut(n, m) ? m : undefined;
  },

  /** A request reaching a cluster member that doesn't lead goes on to the leader, or fails if it knows of none it can reach. True when handled. */
  clusterWrite(n: NodeRt, r: Req) {
    if (n.raft.role === "leader") return false;
    const lead = this.leaderOf(n);
    if (!lead) this.fail(n, r);
    else this.send(r, lead.spec.id);
    return true;
  },

  // ------------------------------------------------------------------------------------------------ locks and bookings

  /**
   * A request for a key: it takes the lock and goes on if the key is free (a lease that ran out frees it), and waits at
   * the back of the line if the key is held or others are already waiting for it.
   */
  acquire(n: NodeRt, r: Req) {
    const h = n.locks.get(r.key);
    if (h && h.until <= this.t) n.locks.delete(r.key);
    const held = n.locks.has(r.key);
    let line = n.waiters.get(r.key);
    if (!held && !line?.length) return this.grant(n, r);
    if (!line) n.waiters.set(r.key, (line = []));
    line.push(r);
    r.phase = "parked";
    if (!held) this.wake(n, r.key);
  },

  /** The key's lock goes to `r`, for one lease, and `r` goes on. */
  grant(n: NodeRt, r: Req) {
    n.locks.set(r.key, { holder: r.id, until: this.t + n.spec.lock!.leaseMs });
    this.send(r, this.resolve(n, n.spec.to![0]));
  },

  /** The holder's answer passes back through the lock: the key is free, and the next in line takes it. */
  unlock(n: NodeRt, r: Req) {
    const h = n.locks.get(r.key);
    if (h?.holder !== r.id) return;
    n.locks.delete(r.key);
    this.wake(n, r.key);
  },

  /** Every 10 ms at a lock: a lease that ran out frees its key, though its holder may still be at work (no fencing). */
  expireLocks(n: NodeRt) {
    for (const [key, h] of [...n.locks]) {
      if (h.until > this.t) continue;
      n.locks.delete(key);
      this.wake(n, key);
    }
  },

  /** A booking's answer comes back to its server: after the read, a taken key turns it away and a free one is written; after the write, it is done. */
  reserveBack(n: NodeRt, r: Req) {
    const held = n.held.indexOf(r);
    if (held >= 0) n.held.splice(held, 1);
    if (r.reserving === 1 && r.result !== "error") {
      r.op = "write";
      if (r.seq > 0) {
        // Taken already: sold out, turned away.
        r.reserving = 0;
        r.result = "rejected";
        return this.respond(r);
      }
      r.expect = r.seq;
      r.reserving = 2;
      return this.call(n, r, [n.spec.reserve!.db]);
    }
    r.op = "write";
    r.reserving = 0;
    this.respond(r);
  },

  /**
   * A saga's step came back. Failed after earlier steps succeeded, the done steps are undone in reverse; once the last
   * undo is back, the request is turned away (cancelled, cleanly). True when the saga took it over.
   */
  sagaBack(n: NodeRt, r: Req) {
    const frame = r.stack[r.stack.length - 1];
    if (r.undoing) {
      if (frame.calls.length) {
        this.call(n, r, frame.calls);
        return true;
      }
      r.undoing = false;
      r.result = "rejected";
      this.respond(r);
      return true;
    }
    if (r.result !== "error" && r.result !== "rejected") return false;
    const steps = n.spec.calls?.[r.op === "write" ? "write" : "read"] ?? n.spec.to ?? [];
    const done = steps.length - frame.calls.length - 1;
    if (done <= 0) return false;
    r.undoing = true;
    this.call(n, r, n.spec.saga!.undo.slice(0, done).reverse());
    return true;
  },

  /** Enough parts answered well, or too many failed for `need` to be reached: the wait ends. */
  check(n: NodeRt, g: Gather) {
    if (g.got >= g.need) this.finishGather(n, g, true);
    else if (g.slots.length - g.bad < g.need) this.finishGather(n, g, false);
  },

  /** A member becomes leader of its term, and beats at once. */
  lead(n: NodeRt) {
    const s = n.raft;
    s.role = "leader";
    s.leader = n.spec.id;
    s.nextBeat = this.t;
    this.effect("elect", n.spec.id);
    this.note(`${n.spec.label} elected leader`);
  },

  /** A beat or a request for votes to another member (not across a partition). */
  raftSend(n: NodeRt, to: string, op: Op) {
    const peer = this.nodes.get(to);
    if (!peer || this.cut(n, peer)) return;
    const m = this.make(n.spec.id, op, 0, op);
    m.detached = true;
    m.term = n.raft.term;
    m.logicalId = (Math.imul(n.raft.term + 1, 0x9e3779b1) ^ Math.imul(this.t + 1, 0x85ebca6b)) >>> 0;
    m.stack = [{ id: n.spec.id, calls: [] }];
    m.at = n.spec.id;
    this.send(m, to);
  },

  /** A committed write is applied at the leader (the followers applied their copies), and counted where it landed. */
  commit(n: NodeRt, r: Req) {
    this.truth.set(r.key, r.seq);
    n.data.set(r.key, r.seq);
    if (this.partitioned && n.spec.region) {
      const s = this.writtenIn.get(n.spec.region) ?? new Set<number>();
      s.add(r.key);
      this.writtenIn.set(n.spec.region, s);
    }
  },

  /** The next live request waiting for a key takes its lock. */
  wake(n: NodeRt, key: number) {
    const w = n.waiters.get(key);
    while (w && w.length) {
      const next = w.shift()!;
      if (next.abandoned || next.phase !== "parked") {
        if (next.phase === "parked") next.phase = "gone";
        continue;
      }
      this.grant(n, next);
      break;
    }
    if (w && !w.length) n.waiters.delete(key);
  },
};

Object.assign(Sim.prototype, coordination);
