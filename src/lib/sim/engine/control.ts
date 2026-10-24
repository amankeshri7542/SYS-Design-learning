import type { NodeRt, Req } from "./model";
import { Sim } from "./sim";

/** Controllers that run every 10 ms: load and running hot, boot and drain, breakers, call timeouts, health probes and the autoscaler. */
const control: Partial<Sim> & ThisType<Sim> = {
  control() {
    const t = this.t;
    for (const n of this.list) {
      const slots = n.spec.slots;
      if (slots) {
        const util = Math.min(1, (n.work.length + n.held.length) / slots);
        n.load += (util - n.load) * 0.05;
        // Hot on a line twice its workers (or saturated with any line); cool again once the line is back to its workers.
        const hot = n.hot ? n.queue.length > slots : n.queue.length > slots * 2 || (n.load > 0.92 && n.queue.length > 0);
        if (hot && !n.hot) this.effect("hot", n.spec.id);
        n.hot = hot;
      }
      if (n.bootUntil && t >= n.bootUntil) {
        n.bootUntil = 0;
        n.ready = true;
      }
      if (n.on && !n.ready && !n.bootUntil && !n.work.length && !n.held.length && !n.queue.length) {
        n.on = false;
        n.load = 0;
      }
      const b = n.spec.breaker;
      if (b && n.breaker.state === "open" && t - n.breaker.openedAt >= b.cooldownMs) {
        n.breaker.state = "half";
        n.breaker.trial = false;
      }
      if (n.spec.callTimeoutMs && n.held.length) this.callTimeouts(n);
      if (n.spec.health && t >= n.nextProbe) {
        n.nextProbe = t + n.spec.health.everyMs;
        for (const id of this.flat(n.spec.to)) this.probe(n, id);
      }
      if (n.spec.autoscale && t >= n.nextScale) this.autoscale(n);
    }
  },

  probe(lb: NodeRt, target: string) {
    const r = this.make(lb.spec.id, "probe", 0, "probe");
    r.deadline = this.t + lb.spec.health!.timeoutMs;
    r.probeOf = target;
    this.send(r, target);
  },

  healthResult(lb: NodeRt, target: string, ok: boolean) {
    const h = lb.spec.health;
    if (!h) return;
    const s = lb.health.get(target) ?? { ok: true, fails: 0, passes: 0 };
    if (ok) {
      s.fails = 0;
      s.passes++;
      if (!s.ok && s.passes >= h.passAfter) s.ok = true;
    } else {
      s.passes = 0;
      s.fails++;
      if (s.ok && s.fails >= h.failAfter) s.ok = false;
    }
    lb.health.set(target, s);
  },

  autoscale(lb: NodeRt) {
    const a = lb.spec.autoscale!;
    lb.nextScale = this.t + a.everyMs;
    const pool = this.flat(lb.spec.to)
      .map((id) => this.nodes.get(id))
      .filter((n): n is NodeRt => !!n);
    const live = pool.filter((n) => n.on && (n.ready || n.bootUntil));
    const serving = live.filter((n) => n.ready);
    if (!serving.length) return;
    const avg = serving.reduce((s, n) => s + n.load, 0) / serving.length;
    const want = Math.max(a.min, Math.min(a.max, Math.ceil((serving.length * avg) / a.target)));
    if (want > live.length) {
      for (const n of pool) {
        if (live.length >= want) break;
        if (n.on) continue;
        n.on = true;
        n.ready = false;
        n.bootUntil = this.t + a.warmupMs;
        n.load = 0;
        live.push(n);
        this.effect("boot", n.spec.id);
      }
      lb.lastScaleOut = this.t;
    } else if (want < live.length && this.t - lb.lastScaleOut > a.everyMs * 3) {
      const victim = [...live].reverse().find((n) => n.ready);
      if (victim && serving.length > a.min) victim.ready = false;
    }
  },

  callTimeouts(n: NodeRt) {
    const limit = n.spec.callTimeoutMs!;
    for (const r of [...n.held]) if (this.t - r.calledAt >= limit) this.giveUp(n, r);
  },

  /** Stop waiting on a downstream call: the original becomes a ghost, an error answer leaves from here. */
  giveUp(n: NodeRt, r: Req) {
    n.held.splice(n.held.indexOf(r), 1);
    r.orphanAt = n.spec.id;
    const depth = r.stack.findIndex((f) => f.id === n.spec.id);
    const c = this.make(r.client, r.op, r.key, r.tag);
    Object.assign(c, {
      first: r.first,
      born: r.born,
      attempt: r.attempt,
      deadline: r.deadline,
      abandoned: r.abandoned,
      detached: r.detached,
      stack: r.stack.slice(0, depth + 1).map((f) => ({ ...f, calls: [] })),
      at: n.spec.id,
    });
    this.recordBreaker(n, false);
    this.respond(c, "error");
  },

  recordBreaker(n: NodeRt, ok: boolean) {
    const spec = n.spec.breaker;
    if (!spec) return;
    const b = n.breaker;
    if (ok) {
      if (b.state === "half") {
        b.state = "closed";
        this.effect("close", n.spec.id);
      }
      b.fails = 0;
      b.trial = false;
      b.trialId = 0;
      return;
    }
    b.fails++;
    if (b.state === "half" || (b.state === "closed" && b.fails >= spec.threshold)) {
      b.state = "open";
      b.openedAt = this.t;
      b.trial = false;
      b.trialId = 0;
      this.effect("open", n.spec.id);
    }
  },
};

Object.assign(Sim.prototype, control);
