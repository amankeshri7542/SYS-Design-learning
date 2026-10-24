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
      if ((n.spec.callTimeoutMs || n.spec.deadlines === "honour") && n.held.length) this.callTimeouts(n);
      if (n.spec.deadlines === "honour" && n.work.length) this.cancelLate(n);
      if (n.spec.ack && n.inflight.size) this.visibility(n);
      if (n.spec.connect && (n.conns.length || n.sendq.length)) this.tidyConns(n);
      // A sender told its receiver has no room tries again in time (a zero-window probe).
      if (n.spec.client?.window && n.sendq.length && !n.flying) this.pump(n);
      if (n.spec.advertise && n.starved.size) this.updateWindows(n);
      if (n.spec.hold && n.subs.length) this.expireSubs(n);
      if (n.spec.client?.subscribe?.heartbeat && n.subOf.size) this.heartbeats(n);
      if (n.spec.hedgeMs) this.hedge(n);
      if (n.spec.cluster) this.raftTick(n);
      if (n.spec.lock && n.locks.size) this.expireLocks(n);
      if (n.spec.promote) {
        // Health checks benched the primary: promote the first healthy target after it.
        if (!n.primary) n.primary = this.flat(n.spec.to)[0] ?? "";
        const c = this.candidates(n);
        if (n.primary && c.length && !c.includes(n.primary)) this.promote(n, c[0]);
      }
      if (n.spec.outbox && t >= n.nextRelay) this.relay(n);
      if (n.spec.health && t >= n.nextProbe) {
        n.nextProbe = t + n.spec.health.everyMs;
        for (const id of this.flat(n.spec.to)) this.probe(n, id);
      }
      if (n.spec.autoscale && t >= n.nextScale) this.autoscale(n);
      if (n.spec.overload) this.overload(n);
      if (n.spec.rollback) this.rollback(n);
    }
  },

  /**
   * Honouring deadlines: work for a request whose deadline has passed (or whose caller gave up on it) stops now. The
   * time already spent is wasted; the worker is free at once, and the request is turned away.
   */
  cancelLate(n: NodeRt) {
    for (const r of [...n.work]) {
      if (r.deadline > this.t && !r.abandoned && !r.orphanAt) continue;
      n.work.splice(n.work.indexOf(r), 1);
      const ms = this.t - r.started;
      r.work += ms;
      this.workLog.push({ t: this.t, ms, wasted: true });
      this.refuse(n, r);
    }
  },

  /** Jobs out too long without an ack: handed out again at the front of the line or, past the limit, dead-lettered. */
  visibility(n: NodeRt) {
    const a = n.spec.ack!;
    for (const [id, e] of n.inflight) {
      if (this.t - e.at < a.visibilityMs) continue;
      n.inflight.delete(id);
      const job = e.job;
      if (a.maxDeliveries && job.attempt + 1 >= a.maxDeliveries) {
        this.deadLettered.add(this.t);
        this.effect("dead", n.spec.id);
        if (a.deadLetter && this.nodes.has(a.deadLetter)) {
          const m = this.clone(n, job);
          m.attempt = job.attempt;
          m.deadLetter = true;
          this.send(m, a.deadLetter);
        }
        job.phase = "gone";
        continue;
      }
      job.attempt++;
      job.phase = "wait";
      n.queue.unshift(job);
      this.redelivered.add(this.t);
      this.effect("redeliver", n.spec.id);
    }
  },

  /** The outbox relay: each event not yet accepted downstream is sent, and sent again once `retryMs` has passed. */
  relay(n: NodeRt) {
    const o = n.spec.outbox!;
    n.nextRelay = this.t + o.everyMs;
    if (!n.up) return;
    for (const e of n.outbox) {
      if (this.t - e.sentAt < (o.retryMs ?? 600)) continue;
      const m = this.make(n.spec.id, "write", e.key, e.tag);
      m.detached = true;
      m.relay = true;
      m.logicalId = e.id;
      m.stack = [{ id: n.spec.id, calls: [] }];
      m.at = n.spec.id;
      e.sentAt = this.t;
      this.send(m, o.to);
    }
  },

  /** Crash when the line or the load stays past its mark for long enough; come back later, cold. */
  overload(n: NodeRt) {
    const o = n.spec.overload!;
    if (!n.up) {
      if (n.restartAt && this.t >= n.restartAt) {
        n.restartAt = 0;
        this.setUp(n.spec.id, true);
        n.coldFrom = this.t;
      }
      return;
    }
    const over = (o.queueAbove !== undefined && n.queue.length > o.queueAbove) || (o.loadAbove !== undefined && n.load > o.loadAbove);
    if (!over) n.overSince = -1;
    else if (n.overSince < 0) n.overSince = this.t;
    else if (this.t - n.overSince >= o.forMs) {
      n.overSince = -1;
      n.restartAt = this.t + o.restartMs;
      this.setUp(n.spec.id, false);
      this.note(`${n.spec.label} crashed under load`);
      // A queue that runs out of memory loses every job in it.
      if (n.spec.kind === "queue") {
        for (const j of n.queue) {
          j.phase = "gone";
          this.lostJobs.add(this.t);
        }
        n.queue = [];
      }
    }
  },

  /** A canary whose answers are failing more than allowed: the balancer stops sending it anything. */
  rollback(lb: NodeRt) {
    const rb = lb.spec.rollback!;
    if (lb.rolledBack.has(rb.target)) return;
    const s = lb.results.get(rb.target);
    if (!s) return;
    const err = s.err.count(this.t);
    const all = err + s.ok.count(this.t);
    if (all >= 5 && err / all > rb.errorsAbove) {
      lb.rolledBack.add(rb.target);
      this.effect("open", lb.spec.id);
      this.note(`${this.nodes.get(rb.target)?.spec.label ?? rb.target} rolled back`);
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

  /** Stop waiting on a call that took too long, or (honouring deadlines) whose caller's deadline has passed. */
  callTimeouts(n: NodeRt) {
    const limit = n.spec.callTimeoutMs ?? Infinity;
    const honour = n.spec.deadlines === "honour";
    for (const r of [...n.held]) if (this.t - r.calledAt >= limit || (honour && r.deadline <= this.t)) this.giveUp(n, r);
  },

  /** Stop waiting on a downstream call: the original becomes a ghost, an error answer leaves from here. */
  giveUp(n: NodeRt, r: Req) {
    n.held.splice(n.held.indexOf(r), 1);
    r.orphanAt = n.spec.id;
    const depth = r.stack.findIndex((f) => f.id === n.spec.id);
    // Still waiting to go out, it never will; on its way, its connection is given up on too.
    const q = n.sendq.indexOf(r);
    if (q >= 0) {
      n.sendq.splice(q, 1);
      r.phase = "gone";
    }
    if (r.stack[depth]?.conn) this.hangUp(n, r.stack[depth], true);
    const c = this.make(r.client, r.op, r.key, r.tag);
    Object.assign(c, {
      first: r.first,
      born: r.born,
      attempt: r.attempt,
      deadline: r.deadline,
      abandoned: r.abandoned,
      logicalId: r.logicalId,
      detached: r.detached,
      deliveryOf: r.deliveryOf,
      acked: r.acked,
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
