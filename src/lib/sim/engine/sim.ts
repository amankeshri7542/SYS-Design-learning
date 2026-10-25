import { hashStr, mulberry32, zipfCdf } from "../rng";
import type { Call, Fx, FxKind, LinkSpec, NodeSpec, Op, Result, SceneSpec, ScriptEvent } from "../types";
import { TICK, Win, type Done, type NodeRt, type Note, type Req, type Spawn } from "./model";
import { SAMPLE_KEYS, sameTargets } from "./ring";

/**
 * The behaviour the modules beside this file attach to `Sim` (`index.ts` loads them all). Lessons and the stage use
 * only the public controls documented on the class and the runtime state the metrics read.
 */
export interface Sim {
  // control.ts
  control(): void;
  probe(lb: NodeRt, target: string): void;
  healthResult(lb: NodeRt, target: string, ok: boolean): void;
  autoscale(lb: NodeRt): void;
  callTimeouts(n: NodeRt): void;
  overload(n: NodeRt): void;
  cancelLate(n: NodeRt): void;
  visibility(n: NodeRt): void;
  relay(n: NodeRt): void;
  rollback(lb: NodeRt): void;
  giveUp(n: NodeRt, r: Req): void;
  recordBreaker(n: NodeRt, ok: boolean): void;

  // clients.ts
  rate(n: NodeRt): number;
  gap(n: NodeRt, rate: number): number;
  arrivals(): void;
  spawn(n: NodeRt, key: number, op: Op, first: number, attempt: number, cost: number, extra?: { logicalId?: number; absent?: boolean; poison?: boolean; deadline?: number }): void;
  finishAtClient(n: NodeRt, r: Req): void;
  timeout(r: Req): void;
  retry(n: NodeRt, r: Req): boolean;

  // transport.ts
  latency(a: string, b: string): number;
  linkOf(a: string, b: string): LinkSpec | undefined;
  cross(r: Req, from: string, to: string, ms: number): void;
  vanish(r: Req): void;
  release(r: Req): void;
  send(r: Req, to: string, ms?: number): void;
  link(a: string, b: string): { sent: number; failed: number };
  respond(r: Req, result?: Result): void;
  arrive(r: Req): void;
  unwind(r: Req): void;

  // routing.ts
  candidates(n: NodeRt, r?: Req): string[];
  route(n: NodeRt, r: Req): void;
  limit(n: NodeRt, r: Req): void;
  resolve(n: NodeRt, call: Call): string;
  owners(spec: NodeSpec): string[];

  // cache.ts
  lookup(n: NodeRt, r: Req): void;
  fill(n: NodeRt, r: Req): void;
  evict(n: NodeRt): void;
  existence(n: NodeRt, r: Req): boolean;

  // data.ts
  setPartition(on: boolean): void;
  dbDone(n: NodeRt, r: Req): void;
  sendRepl(m: Req, peer: NodeRt | undefined): void;
  applyRepl(n: NodeRt, r: Req): void;
  cut(a: NodeRt, b: NodeRt): boolean;

  // work.ts
  enter(n: NodeRt, r: Req): void;
  park(n: NodeRt, r: Req): void;
  unpark(r: Req): void;
  fail(n: NodeRt, r: Req): void;
  admit(n: NodeRt, r: Req): void;
  refuse(n: NodeRt, r: Req): void;
  noteOf(r: Req): string;
  repeat(n: NodeRt, r: Req): boolean;
  remember(n: NodeRt, r: Req, result: Result): void;
  sendAck(n: NodeRt, r: Req): void;
  accept(n: NodeRt, r: Req): void;
  unblock(n: NodeRt): void;
  handOut(n: NodeRt, job: Req, to: string): void;
  signedIn(n: NodeRt, r: Req): boolean;
  clone(n: NodeRt, r: Req): Req;
  enqueue(n: NodeRt, r: Req): void;
  publish(n: NodeRt, r: Req): void;
  service(n: NodeRt, r: Req): number;
  slotsOf(n: NodeRt): number;
  next(n: NodeRt): number;
  take(n: NodeRt): void;
  dispatch(n: NodeRt): void;
  finish(n: NodeRt): void;
  complete(n: NodeRt, r: Req): void;
  call(n: NodeRt, r: Req, calls: Call[]): void;
  back(n: NodeRt, r: Req): void;
}

/**
 * The simulation: its state, the fixed-tick loop, and the public controls. Behaviour by concern lives beside it
 * (control, clients, transport, routing, cache, data, work), attached to the prototype.
 */
export class Sim {
  t = 0;
  spec: SceneSpec;
  nodes = new Map<string, NodeRt>();
  list: NodeRt[] = [];
  reqs: Req[] = [];
  fx: Fx[] = [];
  notes: Note[] = [];
  done: Done[] = [];
  jobs: { t: number; lat: number }[] = [];
  partitioned = false;
  blocked: Req[] = [];
  conflicts = 0;
  /**
   * Traffic per link (keyed by the two node ids, sorted, joined by "~"): requests sent along it and errors that came
   * back along it. Output only, for the stage's flow glow (`flowOf` in metrics.ts).
   */
  links = new Map<string, { sent: number; failed: number }>();
  /** Every first attempt, in order (only with `{ trace: true }`). A problem and its fix must produce the same trace. */
  trace: Spawn[] = [];
  readonly windowMs: number;
  attempts: Win;
  logical: Win;
  retries: Win;
  /** Crossings of every link, and those lost on the way (the `lost` metric). */
  crossings: Win;
  lostCrossings: Win;
  /** Service time spent, and whether it went to a request someone had already given up on (the `wasted` metric). */
  workLog: { t: number; ms: number; wasted: boolean }[] = [];
  /** Answers over the availability window: all of them, and those answered well and on time. */
  sloAll: Win;
  sloGood: Win;
  /** Each link's crossings in flight, one way, by when they end (links with `parallel`). */
  linkBusy = new Map<string, number[]>();
  /** Which server holds each user's session (`client:key`), for servers that keep sessions in memory. */
  sessionOf = new Map<string, string>();
  /** Jobs accepted and then lost (a worker died after acking on receipt, a queue dropped or lost them), redelivered, dead-lettered, and finished out of order for their key. */
  lostJobs: Win;
  redelivered: Win;
  deadLettered: Win;
  reordered: Win;
  /** The latest-born job finished so far for each key, to spot jobs finished out of order. */
  lastDone = new Map<number, number>();
  tracing: boolean;
  seq = 0;
  truth = new Map<number, number>();
  writtenIn = new Map<string, Set<number>>();
  nextId = 1;
  acc = 0;
  /** Retries waiting for their moment. */
  retrying: { at: number; client: string; key: number; op: Op; first: number; attempt: number; cost: number; logicalId: number; absent: boolean; poison: boolean; deadline: number }[] = [];
  retryRng: () => number;
  cycleStart = 0;
  cursor = 0;
  /** The script's looping events (armed ones never loop). */
  loop: ScriptEvent[] = [];
  /** Armed events that have been fired and are on their way, soonest first. */
  armed: { t: number; e: ScriptEvent }[] = [];
  /** Clients send nothing until `start()` (a lesson introduces its parts before any traffic). */
  holding = false;
  seed: number;

  constructor(spec: SceneSpec, opts: { trace?: boolean } = {}) {
    this.spec = spec;
    this.tracing = !!opts.trace;
    this.seed = spec.seed ?? 7;
    this.windowMs = spec.windowMs ?? 1000;
    this.attempts = new Win(this.windowMs);
    this.logical = new Win(this.windowMs);
    this.retries = new Win(this.windowMs);
    this.crossings = new Win(this.windowMs);
    this.lostCrossings = new Win(this.windowMs);
    this.sloAll = new Win(spec.sloWindowMs ?? this.windowMs * 10);
    this.sloGood = new Win(spec.sloWindowMs ?? this.windowMs * 10);
    this.lostJobs = new Win(this.windowMs);
    this.redelivered = new Win(this.windowMs);
    this.deadLettered = new Win(this.windowMs);
    this.reordered = new Win(this.windowMs);
    this.retryRng = mulberry32(this.seed ^ 0x9e3779b9);
    this.reconfigure(spec);
  }

  reconfigure(spec: SceneSpec) {
    this.spec = spec;
    this.loop = (spec.script?.events ?? []).filter((e) => !e.armed);
    const ids = new Set(spec.nodes.map((n) => n.id));
    const stranded: Req[] = [];
    for (const [id, rt] of this.nodes) {
      if (ids.has(id)) continue;
      stranded.push(...rt.queue, ...rt.work, ...rt.parked.filter((r) => r.phase === "parked"));
      for (const w of rt.waiters.values()) stranded.push(...w);
      this.nodes.delete(id);
      for (const other of this.nodes.values()) other.out.delete(id);
    }
    for (const ns of spec.nodes) {
      const rt = this.nodes.get(ns.id);
      if (!rt) {
        this.nodes.set(ns.id, this.create(ns));
        continue;
      }
      const prev = rt.spec;
      rt.spec = ns;
      if (ns.kind === "cache") this.evict(rt);
      if (ns.client) {
        if (prev.client?.keys !== ns.client.keys || prev.client?.skew !== ns.client.skew)
          rt.cdf = zipfCdf(ns.client.keys ?? 1, ns.client.skew ?? 0);
        const r = this.rate(rt);
        if (r > 0) rt.nextArrival = Math.min(rt.nextArrival, this.t + this.gap(rt, r));
      }
      if ((ns.algo === "hash" || ns.algo === "ring") && !sameTargets(prev, ns)) {
        const before = this.owners(prev);
        const after = this.owners(ns);
        let moved = 0;
        for (let k = 0; k < SAMPLE_KEYS; k++) if (before[k] !== after[k]) moved++;
        rt.moved = moved / SAMPLE_KEYS;
        rt.movedAt = this.t;
      }
    }
    this.list = spec.nodes.map((n) => this.nodes.get(n.id)!);
    for (const r of stranded) this.unwind(r);
    for (const rt of this.list) {
      const a = rt.spec.autoscale;
      if (!a || rt.nextScale) continue;
      const pool = this.flat(rt.spec.to);
      pool.forEach((id, i) => {
        const s = this.nodes.get(id);
        if (s) s.on = s.ready = i < a.min;
      });
      rt.nextScale = this.t + a.everyMs;
    }
  }

  private create(spec: NodeSpec): NodeRt {
    const rng = mulberry32(this.seed ^ hashStr(spec.id));
    const rt: NodeRt = {
      spec,
      up: true,
      on: true,
      ready: true,
      bootUntil: 0,
      work: [],
      held: [],
      queue: [],
      parked: [],
      incoming: 0,
      rr: 0,
      out: new Map(),
      cache: new Map(),
      waiters: new Map(),
      data: new Map(),
      buckets: new Map(),
      breaker: { state: "closed", fails: 0, openedAt: 0, trial: false, trialId: 0 },
      health: new Map(),
      load: 0,
      hot: false,
      hits: new Win(this.windowMs),
      misses: new Win(this.windowMs),
      arrivals: new Win(this.windowMs),
      served: 0,
      nextArrival: 0,
      nextProbe: this.t + 50,
      nextScale: 0,
      lastScaleOut: -1e9,
      moved: 0,
      movedAt: -1e9,
      rng,
      cdf: spec.client ? zipfCdf(spec.client.keys ?? 1, spec.client.skew ?? 0) : null,
      spawned: 0,
      filtered: new Win(this.windowMs),
      overSince: -1,
      restartAt: 0,
      coldFrom: -1e9,
      results: new Map(),
      rolledBack: new Set(),
      shedAt: -1e9,
      sessions: new Set(),
      done: new Map(),
      dupes: new Win(this.windowMs),
      inflight: new Map(),
      waiting: [],
      outbox: [],
      nextRelay: 0,
    };
    if (spec.client) {
      const r = this.rate(rt);
      rt.nextArrival = this.t + (r > 0 ? this.gap(rt, r) : 50);
    }
    return rt;
  }

  /** Take a node out of service gracefully: no new requests reach it, the ones it has finish, then it stops. */
  drain(id: string) {
    const n = this.nodes.get(id);
    if (n) n.ready = false;
  }

  /** Start a node (again): it comes up cold and takes traffic once `warmupMs` has passed. */
  boot(id: string, warmupMs: number) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.up = n.on = true;
    n.ready = false;
    n.bootUntil = this.t + Math.max(TICK, warmupMs);
    n.load = 0;
    this.effect("boot", id);
  }

  /** Crash (false) or restore (true) a node. */
  setUp(id: string, up: boolean) {
    const n = this.nodes.get(id);
    if (!n || n.up === up) return;
    n.up = up;
    this.effect(up ? "recover" : "crash", id);
    if (!up) {
      n.cache.clear();
      n.sessions.clear();
      // A worker's copies from a queue that keeps jobs until acked die with it: the queue hands them out again, unless
      // they were acked on receipt, in which case they are lost.
      if (n.spec.sink) {
        for (const r of [...n.queue, ...n.work]) {
          if (!r.deliveryOf) continue;
          if (r.acked) this.lostJobs.add(this.t);
          r.phase = "gone";
        }
        n.queue = n.queue.filter((r) => !r.deliveryOf);
        n.work = n.work.filter((r) => !r.deliveryOf);
      }
      if (!n.spec.sink && n.spec.kind !== "queue") {
        for (const r of [...n.queue, ...n.work]) this.fail(n, r);
        n.queue = [];
        n.work = [];
        for (const r of [...n.held]) this.giveUp(n, r);
      }
    } else {
      for (const r of n.parked) this.unpark(r);
      n.parked = [];
    }
  }

  /**
   * Every request this node is holding on to, whatever the container: its line, its workers, the calls its workers wait
   * on, requests hung on it, readers waiting on a cache fill, a queue's jobs out with workers, and producers held back
   * by back-pressure. A new container must be listed here.
   */
  holds(n: NodeRt): Req[] {
    const out = [...n.queue, ...n.work, ...n.held, ...n.parked.filter((r) => r.phase === "parked"), ...n.waiting];
    for (const w of n.waiters.values()) out.push(...w);
    for (const e of n.inflight.values()) out.push(e.job);
    return out;
  }

  /** Drop a key from every cache (used to stage a cache stampede). */
  expire(key: number) {
    for (const n of this.list) if (n.spec.kind === "cache") n.cache.delete(key);
  }

  note(text: string) {
    this.notes.push({ t: this.t, text });
    if (this.notes.length > 20) this.notes.shift();
  }

  /**
   * Play the script's armed events once, starting with the one labelled `label`, `delayMs` from now: that event, then
   * each later armed event at the same spacing as their `at`s. Firing again replaces whatever of that run is still on its
   * way. False when the script has no such armed event.
   */
  fire(label: string, delayMs = 0): boolean {
    const events = (this.spec.script?.events ?? []).filter((e) => e.armed);
    const i = events.findIndex((e) => e.label === label);
    if (i < 0) return false;
    const run = events.slice(i);
    const labels = new Set(run.map((e) => e.label));
    this.armed = this.armed.filter((q) => !labels.has(q.e.label));
    const at = this.t + Math.max(0, delayMs);
    for (const e of run) this.armed.push({ t: at + (e.at - events[i].at), e });
    this.armed.sort((a, b) => a.t - b.t);
    this.runArmed();
    return true;
  }

  /** Drop every armed event still on its way (an undo, or a restart of the story). */
  cancel() {
    this.armed = [];
  }

  /** Armed events still on their way: when each will run, and the station it happens to. */
  get pending(): { at: number; label: string; node?: string }[] {
    return this.armed.map((q) => ({ at: q.t, label: q.e.label, node: q.e.node }));
  }

  /**
   * Stop clients sending anything new until `start()`. Their arrivals still come due and are drawn, only not sent, so
   * the traffic after `start()` doesn't depend on when that is. Both worlds of a lesson hold and start together.
   */
  hold() {
    this.holding = true;
  }

  /** Let clients send again. */
  start() {
    this.holding = false;
  }

  /** False while the clients are held back for a scene's introduction. */
  get started() {
    return !this.holding;
  }

  private runArmed() {
    while (this.armed.length && this.armed[0].t <= this.t) {
      const { e } = this.armed.shift()!;
      e.run(this);
      if (e.label) this.note(e.label);
    }
  }

  /** Current time including the partial tick, for smooth drawing between steps. */
  get now() {
    return this.t + this.acc;
  }

  /** Advance by `ms` simulated milliseconds in fixed ticks. */
  step(ms: number) {
    this.acc += ms;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick();
    }
  }

  private tick() {
    this.t += TICK;
    const t = this.t;
    this.runScript();
    if (t % 10 === 0) this.control();
    this.arrivals();
    for (let i = 0; i < this.reqs.length; i++) {
      const r = this.reqs[i];
      if (r.phase !== "travel") continue;
      if (r.lostAt && r.lostAt <= t) this.vanish(r);
      else if (r.t1 <= t) this.arrive(r);
    }
    for (const n of this.list) {
      if (n.work.length) this.finish(n);
      if (n.queue.length) this.take(n);
    }
    for (let i = 0; i < this.reqs.length; i++) {
      const r = this.reqs[i];
      if (r.phase !== "gone" && !r.abandoned && r.deadline <= t) this.timeout(r);
    }
    if (t % 100 === 0) this.prune();
  }

  private runScript() {
    if (this.armed.length) this.runArmed();
    const s = this.spec.script;
    // This tick's events come from the script as it stands now, even if one of them swaps the scene's spec.
    const loop = this.loop;
    if (!s || !loop.length) return;
    if (this.t >= this.cycleStart + s.loopMs) {
      this.cycleStart += s.loopMs;
      this.cursor = 0;
    }
    while (this.cursor < loop.length && this.t >= this.cycleStart + loop[this.cursor].at) {
      const e = loop[this.cursor++];
      e.run(this);
      if (e.label) this.note(e.label);
    }
  }

  private prune() {
    this.reqs = this.reqs.filter((r) => r.phase !== "gone");
    const from = this.t - this.windowMs * 2;
    if (this.done.length && this.done[0].t < from) this.done = this.done.filter((d) => d.t >= from);
    if (this.jobs.length && this.jobs[0].t < from) this.jobs = this.jobs.filter((d) => d.t >= from);
    if (this.workLog.length && this.workLog[0].t < from) this.workLog = this.workLog.filter((d) => d.t >= from);
    if (this.fx.length > 120) this.fx = this.fx.slice(-80);
    // Idempotency notes are kept 30 s: long past any retry or redelivery the scenes make.
    if (this.t % 1000 === 0) for (const n of this.list) for (const [k, v] of n.done) if (v.t < this.t - 30_000) n.done.delete(k);
  }

  make(client: string, op: Op, key: number, tag: string): Req {
    const r: Req = {
      id: this.nextId++,
      op,
      key,
      tag,
      client,
      first: this.t,
      born: this.t,
      attempt: 0,
      deadline: Infinity,
      stack: [{ id: client, calls: [] }],
      dir: 1,
      phase: "wait",
      at: client,
      from: client,
      to: client,
      t0: this.t,
      t1: this.t,
      doneAt: 0,
      started: 0,
      calledAt: 0,
      result: null,
      seq: 0,
      stale: false,
      hit: false,
      abandoned: false,
      detached: false,
      orphanAt: "",
      cost: 1,
      probeOf: "",
      logicalId: 0,
      hop: 0,
      lostAt: 0,
      sentAt: 0,
      absent: false,
      wire: 0,
      wait: 0,
      work: 0,
      queuedAt: 0,
      xfer: 0,
      ack: false,
      poison: false,
      deliveryOf: 0,
      acked: false,
      relay: false,
      deadLetter: false,
    };
    this.reqs.push(r);
    return r;
  }

  record(r: Req, result: Result) {
    const lat = this.t - r.first;
    this.done.push({ t: this.t, lat, result, tag: r.tag, op: r.op, wire: r.wire, wait: r.wait, work: r.work });
    this.sloAll.add(this.t);
    if ((result === "ok" || result === "stale" || result === "fallback") && lat <= this.spec.sloMs) this.sloGood.add(this.t);
  }

  flat(calls: Call[] | undefined): string[] {
    return (calls ?? []).flatMap((c) => (Array.isArray(c) ? c : [c]));
  }

  effect(kind: FxKind, node: string, slot?: number) {
    this.fx.push(slot === undefined ? { t: this.t, kind, node } : { t: this.t, kind, node, slot });
  }
}
