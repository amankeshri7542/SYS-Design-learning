import type { Call, NodeSpec } from "../types";
import type { NodeRt, Req } from "./model";
import { ownerOf, SAMPLE_KEYS } from "./ring";
import { Sim } from "./sim";

/** Routing: a balancer picks a target, a limiter spends a token, a pool picks a member, and a hash picks an owner. */
const routing: Partial<Sim> & ThisType<Sim> = {
  /**
   * The targets a balancer may send this request to: those for its tag, on, ready, healthy and not rolled back. At layer
   * 4 it can't see the tag.
   */
  candidates(n: NodeRt, r?: Req) {
    const pool = (r && n.spec.layer !== 4 && n.spec.byTag?.[r.tag]) || n.spec.to;
    return this.flat(pool).filter((id) => {
      const s = this.nodes.get(id);
      if (!s || !s.on || !s.ready) return false;
      if (n.rolledBack.has(id)) return false;
      if (n.spec.health) return n.health.get(id)?.ok ?? true;
      return true;
    });
  },

  route(n: NodeRt, r: Req) {
    if (n.spec.promote) return this.toPrimary(n, r);
    const c = this.candidates(n, r);
    if (!c.length) return this.fail(n, r);
    // Layer 4: every request on a connection goes where its connection was first sent, while that target is there.
    const conn = n.spec.layer === 4 ? this.connKey(r) : "";
    const pinned = conn ? n.pins.get(conn) : undefined;
    if (pinned && c.includes(pinned)) return this.forward(n, r, pinned);
    let pick: string;
    switch (n.spec.algo) {
      case "random":
        pick = c[Math.floor(n.rng() * c.length)];
        break;
      case "least": {
        const start = n.rr++ % c.length;
        pick = c[start];
        for (let i = 1; i < c.length; i++) {
          const id = c[(start + i) % c.length];
          if ((n.out.get(id) ?? 0) < (n.out.get(pick) ?? 0)) pick = id;
        }
        break;
      }
      case "hash":
      case "ring":
        pick = ownerOf(r.key, c, n.spec.algo);
        break;
      case "nearest":
        // The healthy target with the shortest link from here (anycast, geo routing).
        pick = c.reduce((best, id) => (this.latency(n.spec.id, id) < this.latency(n.spec.id, best) ? id : best));
        break;
      case "weighted": {
        // At random, in proportion to each target's weight: a canary gets its few percent.
        const w = (id: string) => n.spec.weights?.[id] ?? 1;
        let u = n.rng() * c.reduce((sum, id) => sum + w(id), 0);
        pick = c.find((id) => (u -= w(id)) < 0) ?? c[c.length - 1];
        break;
      }
      default:
        pick = c[n.rr++ % c.length];
    }
    if (conn) {
      n.pins.set(conn, pick);
      // Forget the oldest pins once there are many (connections long closed).
      if (n.pins.size > 600) for (const k of [...n.pins.keys()].slice(0, 200)) n.pins.delete(k);
    }
    this.forward(n, r, pick);
  },

  /** Send a request on to the target a balancer picked, counting it as outstanding there. */
  forward(n: NodeRt, r: Req, pick: string) {
    n.out.set(pick, (n.out.get(pick) ?? 0) + 1);
    r.stack[r.stack.length - 1].via = pick;
    this.send(r, pick);
  },

  limit(n: NodeRt, r: Req) {
    const l = n.spec.limit!;
    if (l.tags && !l.tags.includes(r.tag)) return this.send(r, this.resolve(n, n.spec.to![0]));
    // One bucket per client, or (shared) one for everyone.
    const key = l.shared ? "" : r.tag;
    const b = n.buckets.get(key) ?? { tokens: l.burst, t: this.t };
    b.tokens = Math.min(l.burst, b.tokens + ((this.t - b.t) * l.rps) / 1000);
    b.t = this.t;
    n.buckets.set(key, b);
    if (b.tokens < 1) {
      this.effect("reject", n.spec.id);
      return this.respond(r, "rejected");
    }
    b.tokens -= 1;
    this.send(r, this.resolve(n, n.spec.to![0]));
  },

  /** Resolve a call target; pools pick round-robin among nodes that are on and up. */
  resolve(n: NodeRt, call: Call): string {
    if (!Array.isArray(call)) return call;
    const live = call.filter((id) => {
      const s = this.nodes.get(id);
      return s && s.on && s.up;
    });
    const pool = live.length ? live : call;
    return pool[n.rr++ % pool.length];
  },

  owners(spec: NodeSpec) {
    const targets = this.flat(spec.to);
    const out: string[] = [];
    for (let k = 0; k < SAMPLE_KEYS; k++) out.push(targets.length ? ownerOf(k, targets, spec.algo) : "");
    return out;
  },
};

Object.assign(Sim.prototype, routing);
