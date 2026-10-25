import type { Call, Result } from "../types";
import { Win, type NodeRt, type Req } from "./model";
import { Sim } from "./sim";

/** Work at a node: entering it, waiting in line, being served, calling downstream, and the way back through it. */
const work: Partial<Sim> & ThisType<Sim> = {
  enter(n: NodeRt, r: Req) {
    n.arrivals.add(this.t);
    if (r.op === "repl") return this.applyRepl(n, r);
    if (r.op === "probe") {
      // A heartbeat passes through the nodes on its connection's path, on to the server holding the connection.
      if (r.beat && r.probeOf !== n.spec.id && n.up && n.on) {
        const path = this.nodes.get(r.client)?.subOf.get(r.key)?.stack.map((f) => f.id) ?? [];
        return this.send(r, path[path.indexOf(n.spec.id) + 1] ?? r.probeOf);
      }
      // A handshake is refused past the node's connection limit.
      if (n.up) return this.respond(r, r.hand && !this.admitConn(n, r) ? "error" : "ok");
      if (n.spec.downMode === "hang") return this.park(n, r);
      return this.respond(r, "error");
    }
    if (!n.up || !n.on) {
      // A paused worker keeps its jobs; a copy from a queue that keeps jobs until acked is simply lost (no ack comes).
      if (n.spec.sink && n.on && !r.deliveryOf) {
        n.queue.push(r);
        r.phase = "wait";
        r.queuedAt = this.t;
        return;
      }
      if (n.spec.downMode === "hang") return this.park(n, r);
      return this.fail(n, r);
    }
    switch (n.spec.kind) {
      case "lb":
        // A balancer that reads each request (an L7 gateway with `serviceMs`) parses it first, in line for a worker.
        return n.spec.serviceMs ? this.admit(n, r) : this.route(n, r);
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
        if (this.existence(n, r)) return;
        return this.admit(n, r);
      default:
        if (n.spec.sessions && !this.signedIn(n, r)) return this.respond(r, "error");
        if (n.spec.idempotent && this.repeat(n, r)) return;
        if (r.deliveryOf && this.nodes.get(r.stack[0]?.id)?.spec.ack?.mode === "receive") this.sendAck(n, r);
        return this.admit(n, r);
    }
  },

  /** The idempotency note for a logical message: its sender and id. */
  noteOf(r: Req) {
    return `${r.client}:${r.logicalId}`;
  },

  /**
   * An idempotent node has done this message before: answer it from its note, without doing the work again (a job is
   * acknowledged, so its queue stops handing it out).
   */
  repeat(n: NodeRt, r: Req) {
    const note = n.done.get(this.noteOf(r));
    if (!note) return false;
    this.effect("dupe", n.spec.id);
    if (r.detached) {
      if (r.deliveryOf) this.sendAck(n, r);
      r.phase = "gone";
    } else this.respond(r, note.result);
    return true;
  },

  /** Note a finished message; a node that isn't idempotent and has done it before counts a duplicate. */
  remember(n: NodeRt, r: Req, result: Result) {
    if (n.spec.idempotent === undefined) return;
    const note = this.noteOf(r);
    if (n.done.has(note)) n.dupes.add(this.t);
    n.done.set(note, { t: this.t, id: r.logicalId, result });
  },

  /** A worker tells the queue it has the job (or has finished it): a small green ack back to the queue. */
  sendAck(n: NodeRt, r: Req) {
    const q = r.stack[0]?.id;
    if (r.acked || !q) return;
    r.acked = true;
    const a = this.make(n.spec.id, "ack", r.key, r.tag);
    a.detached = true;
    a.ack = true;
    a.deliveryOf = r.deliveryOf;
    a.stack = [
      { id: q, calls: [] },
      { id: n.spec.id, calls: [] },
    ];
    a.at = n.spec.id;
    this.respond(a, "ok");
  },

  /**
   * A server that keeps sessions in memory: is this user signed in here? A first visit signs them in. A user whose
   * session is on another server, or was lost when this one crashed, is signed out: false. Either way the session is
   * here from now on.
   */
  signedIn(n: NodeRt, r: Req) {
    const user = `${r.client}:${r.key}`;
    const home = this.sessionOf.get(user);
    const ok = home === undefined || (home === n.spec.id && n.sessions.has(user));
    this.sessionOf.set(user, n.spec.id);
    n.sessions.add(user);
    return ok;
  },

  park(n: NodeRt, r: Req) {
    n.parked = n.parked.filter((p) => p.phase === "parked");
    if (n.parked.length > 60) this.unpark(n.parked.shift()!);
    n.parked.push(r);
    r.phase = "parked";
  },

  /** Let go of a request hung on a node (it came back up, or too many hang on it). It never answers: whoever waits for it gives up in time. */
  unpark(r: Req) {
    if (r.phase !== "parked") return;
    this.release(r);
    r.phase = r.abandoned || r.detached || r.op === "probe" ? "gone" : "lost";
  },

  fail(n: NodeRt, r: Req) {
    // Refused at a full line: it falls from the line's tail.
    const full = n.queue.length >= (n.spec.queueMax ?? Infinity);
    this.effect("drop", n.spec.id, full ? n.queue.length : undefined);
    if (r.detached && !this.waitedOn(r)) {
      if (r.deliveryOf && r.acked) this.lostJobs.add(this.t);
      r.phase = "gone";
      return;
    }
    this.respond(r, "error");
  },

  /** A detached message (no one sent it expecting an answer) that a blocking server is nonetheless holding a worker for. */
  waitedOn(r: Req) {
    const caller = r.stack[r.stack.length - 2];
    return !!caller && !!this.nodes.get(caller.id)?.held.includes(r);
  },

  admit(n: NodeRt, r: Req) {
    if (n.queue.length >= (n.spec.queueMax ?? Infinity)) return this.fail(n, r);
    // Shedding: past the mark, turn the request away now, fast, instead of serving everyone late.
    const s = n.spec.shed;
    if (s && !s.keep?.includes(r.tag) && ((s.queueAbove !== undefined && n.queue.length >= s.queueAbove) || (s.loadAbove !== undefined && n.load >= s.loadAbove))) {
      n.shedAt = this.t;
      return this.refuse(n, r);
    }
    // Honouring deadlines: a request that can't be finished in the time it has left is refused now, not served late.
    // Its estimate: the line ahead shared among the workers, half a service for a busy worker to free up, then its own.
    if (n.spec.deadlines === "honour") {
      const slots = this.slotsOf(n);
      const busy = n.work.length + n.held.length >= slots ? 0.5 : 0;
      if (r.deadline - this.t < (n.queue.length / slots + busy + 1) * (n.spec.serviceBy?.[r.op === "write" ? "write" : "read"] ?? n.spec.serviceMs ?? 0)) return this.refuse(n, r);
    }
    n.queue.push(r);
    r.phase = "wait";
    r.queuedAt = this.t;
  },

  /** Turned away on purpose, at once: a slate square, not a failure. */
  refuse(n: NodeRt, r: Req) {
    this.effect("reject", n.spec.id);
    if (r.detached && !this.waitedOn(r)) {
      r.phase = "gone";
      return;
    }
    this.respond(r, "rejected");
  },

  clone(n: NodeRt, r: Req): Req {
    const c = this.make(n.spec.id, r.op, r.key, r.tag);
    c.detached = true;
    c.stack = [{ id: n.spec.id, calls: [] }];
    c.at = n.spec.id;
    c.logicalId = r.logicalId;
    c.poison = r.poison;
    c.news = r.news;
    return c;
  },

  enqueue(n: NodeRt, r: Req) {
    if (n.queue.length >= (n.spec.capacity ?? Infinity)) return this.fail(n, r);
    const bp = n.spec.backpressure;
    if (bp && !r.deadLetter) {
      if (bp.mode === "wait" && (n.waiting.length || n.queue.length >= bp.high)) {
        // Back-pressure: the producer's request waits here until there is room, so the producer slows down.
        r.phase = "parked";
        n.waiting.push(r);
        return;
      }
      if (n.queue.length >= bp.high) {
        if (bp.mode === "reject") return this.refuse(n, r);
        if (bp.mode === "drop-oldest") {
          n.queue.shift()!.phase = "gone";
          this.lostJobs.add(this.t);
          this.effect("drop", n.spec.id, 0);
        }
      }
    }
    this.accept(n, r);
  },

  /** A job goes in the line; its producer hears "ok" (a dead letter is just stored). */
  accept(n: NodeRt, r: Req) {
    const job = this.clone(n, r);
    job.phase = "wait";
    n.queue.push(job);
    if (r.deadLetter) r.phase = "gone";
    else this.respond(r, "ok");
  },

  /** Back-pressure: as the line shrinks below its low mark, the held producers' jobs go in, oldest first. */
  unblock(n: NodeRt) {
    const bp = n.spec.backpressure!;
    while (n.waiting.length && n.queue.length < (bp.low ?? bp.high)) {
      const r = n.waiting.shift()!;
      if (r.abandoned || r.phase !== "parked") {
        if (r.phase === "parked") r.phase = "gone";
        continue;
      }
      this.accept(n, r);
    }
  },

  publish(n: NodeRt, r: Req) {
    for (const id of this.flat(n.spec.to)) this.send(this.clone(n, r), id);
    this.respond(r, "ok");
  },

  service(n: NodeRt, r: Req) {
    const base = n.spec.serviceBy?.[r.op === "write" ? "write" : "read"] ?? n.spec.serviceMs ?? 0;
    const ms = base * r.cost * (0.6 + 0.8 * n.rng());
    const tail = n.spec.tail;
    return tail && n.rng() < tail.share ? ms * tail.mult : ms;
  },

  /** Workers it can use now: all of them, or (just back from an overload crash) a share that grows over its warm-up. */
  slotsOf(n: NodeRt) {
    const slots = n.spec.slots ?? Infinity;
    const warm = n.spec.overload?.warmMs;
    const since = this.t - n.coldFrom;
    return warm && since < warm ? Math.max(1, Math.floor((slots * since) / warm)) : slots;
  },

  /**
   * Which request in line a free worker takes: the oldest, or the newest (`order: "lifo"`); the most important tag
   * first (`priority`); and only one whose tag has a worker left (`bulkheads`). -1 when none can be taken.
   */
  next(n: NodeRt) {
    const { order, priority, bulkheads } = n.spec;
    if (!order && !priority && !bulkheads) return 0;
    let room: ((tag: string) => boolean) | null = null;
    if (bulkheads) {
      const used = new Map<string, number>();
      for (const r of [...n.work, ...n.held]) {
        const tag = r.tag in bulkheads ? r.tag : "";
        used.set(tag, (used.get(tag) ?? 0) + 1);
      }
      const shared = this.slotsOf(n) - Object.values(bulkheads).reduce((a, b) => a + b, 0);
      room = (tag) => (tag in bulkheads ? (used.get(tag) ?? 0) < bulkheads[tag] : (used.get("") ?? 0) < shared);
    }
    let best = -1;
    let rank = Infinity;
    for (let k = 0; k < n.queue.length; k++) {
      const i = order === "lifo" ? n.queue.length - 1 - k : k;
      const r = n.queue[i];
      if (room && !room(r.tag)) continue;
      const p = priority ? priority.indexOf(r.tag) + 1 || priority.length + 1 : 1;
      if (p < rank) {
        rank = p;
        best = i;
        if (p === 1) break;
      }
    }
    return best;
  },

  /** Workers that are free take the next requests in line. */
  take(n: NodeRt) {
    if (n.spec.kind === "queue") return this.dispatch(n);
    if (!n.up || !n.on) return;
    const slots = this.slotsOf(n);
    while (n.queue.length && n.work.length + n.held.length < slots) {
      const i = this.next(n);
      if (i < 0) break;
      const r = i === 0 ? n.queue.shift()! : n.queue.splice(i, 1)[0];
      // Honouring deadlines: nobody is waiting for this one any more, so no worker spends time on it. It is turned
      // away rather than dropped, so everything it holds on its way back (a worker, a balancer's count) lets go.
      if (n.spec.deadlines === "honour" && (r.abandoned || r.orphanAt)) {
        this.refuse(n, r);
        continue;
      }
      r.wait += this.t - r.queuedAt;
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
    const first = n.spec.consumers === "first";
    const ack = n.spec.ack;
    let i = 0;
    while (n.queue.length && i < workers.length * 2) {
      if (ack?.ordered && n.inflight.size) break;
      // One consumer per partition: the first live worker takes every job, and the next takes over if it fails.
      const w = first ? workers[0] : workers[n.rr++ % workers.length];
      i++;
      if (!w) break;
      const busy = w.work.length + w.held.length + w.queue.length + w.incoming;
      if (busy >= (w.spec.slots ?? 1)) {
        if (first) break;
        continue;
      }
      const job = n.queue.shift()!;
      if (ack) this.handOut(n, job, w.spec.id);
      else this.send(job, w.spec.id);
      i = 0;
    }
    if (n.waiting.length) this.unblock(n);
  },

  /** A queue that keeps jobs until acked hands out a copy, and keeps the job, invisible, until the copy is acked. */
  handOut(n: NodeRt, job: Req, to: string) {
    const copy = this.clone(n, job);
    copy.born = job.born;
    copy.first = job.first;
    copy.attempt = job.attempt;
    copy.cost = job.cost;
    copy.deliveryOf = copy.id;
    job.phase = "parked";
    n.inflight.set(copy.id, { job, at: this.t });
    this.send(copy, to);
  },

  finish(n: NodeRt) {
    for (let i = 0; i < n.work.length; ) {
      const r = n.work[i];
      if (r.doneAt > this.t) {
        i++;
        continue;
      }
      n.work.splice(i, 1);
      const ms = this.t - r.started;
      r.work += ms;
      this.workLog.push({ t: this.t, ms, wasted: r.abandoned || !!r.orphanAt });
      this.complete(n, r);
    }
  },

  complete(n: NodeRt, r: Req) {
    n.served++;
    // A bad deploy: some share of the work fails.
    if (n.spec.failRate && n.rng() < n.spec.failRate) return this.fail(n, r);
    if (n.spec.kind === "lb") return this.route(n, r);
    if (n.spec.kind === "db") return this.dbDone(n, r);
    // Taking a connection in costs a worker's time (a handshake, signing the user in); then it is held open.
    if (r.op === "sub" && n.spec.hold) return this.holdSub(n, r);
    // A feed keeps the latest news item it hears of, and a server holding connections pushes each one down all of them;
    // an item handed on by a topic needs no answer. A read of a feed is answered with its latest item.
    if (r.news && (n.spec.feed || n.spec.hold)) {
      if (n.spec.feed) n.latest = Math.max(n.latest, r.news);
      if (n.spec.hold) this.fanOut(n, r);
      if (r.detached) {
        r.phase = "gone";
        return;
      }
    } else if (n.spec.feed && r.op === "read") {
      r.news = n.latest;
      r.polled = true;
    }
    const calls = (n.spec.calls?.[r.op === "write" ? "write" : "read"] ?? n.spec.to ?? []).slice();
    // A poison job fails wherever it is finally handled: a worker, or the last server on its way (a dead website).
    if (r.poison && (n.spec.sink || !calls.length)) return this.fail(n, r);
    if (!calls.length) {
      this.remember(n, r, "ok");
      if (n.spec.sink) {
        if (r.deliveryOf) this.sendAck(n, r);
        r.phase = "gone";
        this.jobs.push({ t: this.t, lat: this.t - r.born });
        // Finished before an earlier job for the same key: out of order.
        const last = this.lastDone.get(r.key);
        if (last !== undefined && r.born < last) this.reordered.add(this.t);
        else this.lastDone.set(r.key, r.born);
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
    if (n.spec.connect) this.dial(n, r, this.resolve(n, next));
    else this.send(r, this.resolve(n, next));
  },

  back(n: NodeRt, r: Req) {
    if (r.op === "probe") {
      // A heartbeat or a handshake goes back the way it came; at its sender, it reports.
      if (r.beat || r.hand) {
        if (r.stack.length > 1) return this.respond(r);
        r.phase = "gone";
        return r.hand ? this.shaken(n, r) : this.beatResult(n, r, r.result === "ok");
      }
      if (!r.abandoned) this.healthResult(n, r.probeOf, r.result === "ok");
      r.phase = "gone";
      return;
    }
    // A push goes back along its connection's path to its user.
    if (r.op === "push") {
      if (r.stack.length > 1) return this.respond(r);
      r.phase = "gone";
      return this.heard(n, r);
    }
    // A replica confirms a copy its primary was waiting for: once every copy is confirmed, the write is answered.
    if (r.op === "repl") {
      r.phase = "gone";
      const w = this.syncWait.get(r.syncFor);
      if (!w || --w.left > 0) return;
      this.syncWait.delete(r.syncFor);
      const i = n.waiting.indexOf(w.write);
      if (i >= 0) {
        n.waiting.splice(i, 1);
        this.respond(w.write, "ok");
      }
      return;
    }
    if (r.orphanAt === n.spec.id) {
      r.phase = "gone";
      return;
    }
    // An ack lands at its queue, which forgets the job; an outbox event accepted downstream leaves the outbox. A window
    // update travels back to its sender, which may send again.
    if (r.op === "ack") {
      if (r.stack.length > 1) return this.respond(r);
      if (n.spec.kind === "queue") n.inflight.delete(r.deliveryOf);
      else if (r.window >= 0 && n.spec.client?.window) {
        n.peerWindow = r.window;
        this.pump(n);
      }
      r.phase = "gone";
      return;
    }
    if (r.relay) {
      if (r.result !== "error") n.outbox = n.outbox.filter((e) => e.id !== r.logicalId);
      r.phase = "gone";
      return;
    }
    // A worker that calls on (a fetcher) acks by answering: its copy coming back answered is the ack. One acked on
    // receipt and coming back failed is a job lost.
    if (n.spec.kind === "queue" && r.deliveryOf) {
      if (r.result !== "error") n.inflight.delete(r.deliveryOf);
      else if (r.acked) this.lostJobs.add(this.t);
      r.phase = "gone";
      return;
    }
    const frame = r.stack[r.stack.length - 1];
    // The exchange is over: the connection it went out on is free.
    if (frame.conn) this.hangUp(n, frame);
    switch (n.spec.kind) {
      case "client":
        if (r.op === "sub") return this.subEnded(n, r);
        return this.finishAtClient(n, r);
      case "lb":
        if (frame.via) n.out.set(frame.via, Math.max(0, (n.out.get(frame.via) ?? 1) - 1));
        // Watching a canary: how each target's answers are going.
        if (frame.via && n.spec.rollback) {
          let s = n.results.get(frame.via);
          if (!s) n.results.set(frame.via, (s = { ok: new Win(this.windowMs), err: new Win(this.windowMs) }));
          (r.result === "error" ? s.err : s.ok).add(this.t);
        }
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
