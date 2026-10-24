import type { NodeRt, Req } from "./model";
import { Sim } from "./sim";

/** Caches: look up, fill on the way back (waking coalesced waiters), and evict the least recently used. */
const cache: Partial<Sim> & ThisType<Sim> = {
  lookup(n: NodeRt, r: Req) {
    const origin = this.resolve(n, n.spec.to![0]);
    if (r.op === "write") {
      if (n.spec.invalidate) n.cache.delete(r.key);
      return this.send(r, origin);
    }
    const e = n.cache.get(r.key);
    if (e && e.exp > this.t) {
      e.last = this.t;
      n.hits.add(this.t);
      r.hit = true;
      r.seq = e.seq;
      r.stale = e.seq < (this.truth.get(r.key) ?? 0);
      this.effect("hit", n.spec.id);
      return this.respond(r, "ok");
    }
    if (e) n.cache.delete(r.key);
    n.misses.add(this.t);
    this.effect("miss", n.spec.id);
    if (n.spec.coalesce) {
      const w = n.waiters.get(r.key);
      if (w) {
        w.push(r);
        r.phase = "parked";
        return;
      }
      n.waiters.set(r.key, []);
    }
    this.send(r, origin);
  },

  fill(n: NodeRt, r: Req) {
    if (r.op !== "read" || r.hit) return;
    const ok = r.result === "ok";
    if (ok && (n.spec.capacity ?? 0) > 0) {
      n.cache.set(r.key, { seq: r.seq, exp: this.t + (n.spec.ttlMs ?? Infinity), last: this.t });
      this.effect("fill", n.spec.id);
      this.evict(n);
    }
    const w = n.waiters.get(r.key);
    if (!w) return;
    n.waiters.delete(r.key);
    for (const x of w) {
      x.seq = r.seq;
      x.stale = r.stale;
      x.hit = true;
      this.respond(x, ok ? "ok" : "error");
    }
  },

  evict(n: NodeRt) {
    const cap = n.spec.capacity ?? 0;
    while (n.cache.size > cap) {
      let lru = -1;
      let oldest = Infinity;
      for (const [k, e] of n.cache)
        if (e.last < oldest) {
          oldest = e.last;
          lru = k;
        }
      n.cache.delete(lru);
      this.effect("evict", n.spec.id);
    }
  },
};

Object.assign(Sim.prototype, cache);
