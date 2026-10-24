import type { Call } from "../types";
import type { NodeRt, Req } from "./model";
import { Sim } from "./sim";

/** Work at a node: entering it, waiting in line, being served, calling downstream, and the way back through it. */
const work: Partial<Sim> & ThisType<Sim> = {
  enter(n: NodeRt, r: Req) {
    n.arrivals.add(this.t);
    if (r.op === "repl") return this.applyRepl(n, r);
    if (r.op === "probe") {
      if (n.up) return this.respond(r, "ok");
      if (n.spec.downMode === "hang") return this.park(n, r);
      return this.respond(r, "error");
    }
    if (!n.up || !n.on) {
      if (n.spec.sink && n.on) {
        n.queue.push(r);
        r.phase = "wait";
        return;
      }
      if (n.spec.downMode === "hang") return this.park(n, r);
      return this.fail(n, r);
    }
    switch (n.spec.kind) {
      case "lb":
        return this.route(n, r);
      case "limiter":
        return this.limit(n, r);
      case "cache":
        return this.lookup(n, r);
      case "queue":
        return this.enqueue(n, r);
      case "topic":
        return this.publish(n, r);
      case "db":
        if (n.spec.leader) {
          const leader = this.nodes.get(n.spec.leader);
          if (!leader || this.cut(n, leader)) return this.fail(n, r);
          return this.send(r, leader.spec.id);
        }
        return this.admit(n, r);
      default:
        return this.admit(n, r);
    }
  },

  park(n: NodeRt, r: Req) {
    n.parked = n.parked.filter((p) => p.phase === "parked");
    if (n.parked.length > 60) n.parked.shift()!.phase = "gone";
    n.parked.push(r);
    r.phase = "parked";
  },

  fail(n: NodeRt, r: Req) {
    // Refused at a full line: it falls from the line's tail.
    const full = n.queue.length >= (n.spec.queueMax ?? Infinity);
    this.effect("drop", n.spec.id, full ? n.queue.length : undefined);
    if (r.detached) {
      r.phase = "gone";
      return;
    }
    this.respond(r, "error");
  },

  admit(n: NodeRt, r: Req) {
    if (n.queue.length >= (n.spec.queueMax ?? Infinity)) return this.fail(n, r);
    n.queue.push(r);
    r.phase = "wait";
  },

  clone(n: NodeRt, r: Req): Req {
    const c = this.make(n.spec.id, r.op, r.key, r.tag);
    c.detached = true;
    c.stack = [{ id: n.spec.id, calls: [] }];
    c.at = n.spec.id;
    return c;
  },

  enqueue(n: NodeRt, r: Req) {
    if (n.queue.length >= (n.spec.capacity ?? Infinity)) return this.fail(n, r);
    const job = this.clone(n, r);
    job.phase = "wait";
    n.queue.push(job);
    this.respond(r, "ok");
  },

  publish(n: NodeRt, r: Req) {
    for (const id of this.flat(n.spec.to)) this.send(this.clone(n, r), id);
    this.respond(r, "ok");
  },

  service(n: NodeRt, r: Req) {
    const base = n.spec.serviceMs ?? 0;
    return base * r.cost * (0.6 + 0.8 * n.rng());
  },

  /** Workers that are free take the next requests in line. */
  take(n: NodeRt) {
    if (n.spec.kind === "queue") return this.dispatch(n);
    if (!n.up || !n.on) return;
    const slots = n.spec.slots ?? Infinity;
    while (n.queue.length && n.work.length + n.held.length < slots) {
      const r = n.queue.shift()!;
      r.phase = "work";
      r.at = n.spec.id;
      r.started = this.t;
      r.doneAt = this.t + this.service(n, r);
      n.work.push(r);
    }
  },

  dispatch(n: NodeRt) {
    const workers = this.flat(n.spec.to)
      .map((id) => this.nodes.get(id))
      .filter((w): w is NodeRt => !!w && w.on && w.up);
    let i = 0;
    while (n.queue.length && i < workers.length * 2) {
      const w = workers[n.rr++ % workers.length];
      i++;
      if (!w) break;
      const busy = w.work.length + w.held.length + w.queue.length + w.incoming;
      if (busy >= (w.spec.slots ?? 1)) continue;
      const job = n.queue.shift()!;
      this.send(job, w.spec.id);
      i = 0;
    }
  },

  finish(n: NodeRt) {
    for (let i = 0; i < n.work.length; ) {
      const r = n.work[i];
      if (r.doneAt > this.t) {
        i++;
        continue;
      }
      n.work.splice(i, 1);
      this.complete(n, r);
    }
  },

  complete(n: NodeRt, r: Req) {
    n.served++;
    if (n.spec.kind === "db") return this.dbDone(n, r);
    const calls = (n.spec.calls?.[r.op === "write" ? "write" : "read"] ?? n.spec.to ?? []).slice();
    if (!calls.length) {
      if (n.spec.sink) {
        r.phase = "gone";
        this.jobs.push({ t: this.t, lat: this.t - r.born });
        this.effect("done", n.spec.id);
        return;
      }
      return this.respond(r, "ok");
    }
    if (n.spec.breaker) {
      const b = n.breaker;
      if (b.state === "open" || (b.state === "half" && b.trial)) {
        this.effect("reject", n.spec.id);
        return this.respond(r, "fallback");
      }
      if (b.state === "half") {
        b.trial = true;
        b.trialId = r.id;
      }
    }
    this.call(n, r, calls);
  },

  call(n: NodeRt, r: Req, calls: Call[]) {
    const [next, ...rest] = calls;
    r.result = null;
    r.stack[r.stack.length - 1].calls = rest;
    r.calledAt = this.t;
    if (n.spec.blocking) n.held.push(r);
    this.send(r, this.resolve(n, next));
  },

  back(n: NodeRt, r: Req) {
    if (r.op === "probe") {
      if (!r.abandoned) this.healthResult(n, r.probeOf, r.result === "ok");
      r.phase = "gone";
      return;
    }
    if (r.orphanAt === n.spec.id) {
      r.phase = "gone";
      return;
    }
    const frame = r.stack[r.stack.length - 1];
    switch (n.spec.kind) {
      case "client":
        return this.finishAtClient(n, r);
      case "lb":
        if (frame.via) n.out.set(frame.via, Math.max(0, (n.out.get(frame.via) ?? 1) - 1));
        break;
      case "server": {
        const idx = n.held.indexOf(r);
        if (idx >= 0) n.held.splice(idx, 1);
        if (n.spec.breaker) this.recordBreaker(n, r.result !== "error");
        if (r.result !== "error" && r.result !== "rejected" && frame.calls.length) {
          return this.call(n, r, frame.calls);
        }
        break;
      }
      case "cache":
        this.fill(n, r);
        break;
    }
    this.respond(r);
  },
};

Object.assign(Sim.prototype, work);
