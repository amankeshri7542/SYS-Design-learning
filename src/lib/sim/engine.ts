import { hashStr, mix, mulberry32, sampleCdf, zipfCdf } from "./rng";
import type {
  Call,
  Fx,
  FxKind,
  NodeSpec,
  Op,
  Result,
  SceneSpec,
} from "./types";

/** Fixed simulation step in simulated milliseconds. */
export const TICK = 2;

export type Phase = "travel" | "wait" | "work" | "parked" | "gone";

export interface Frame {
  id: string;
  calls: Call[];
  /** Load balancer: which target this request was sent to. */
  via?: string;
}

export interface Req {
  id: number;
  op: Op;
  key: number;
  tag: string;
  client: string;
  /** When the logical request (first attempt) started. */
  first: number;
  born: number;
  attempt: number;
  deadline: number;
  stack: Frame[];
  dir: 1 | -1;
  phase: Phase;
  /** Node the request is at (when not travelling). */
  at: string;
  from: string;
  to: string;
  t0: number;
  t1: number;
  doneAt: number;
  started: number;
  calledAt: number;
  result: Result | null;
  seq: number;
  stale: boolean;
  hit: boolean;
  abandoned: boolean;
  detached: boolean;
  /** Set when a server gave up waiting for this request; it is now a ghost. */
  orphanAt: string;
  cost: number;
  probeOf: string;
}

interface Entry {
  seq: number;
  exp: number;
  last: number;
}

export interface Done {
  t: number;
  lat: number;
  result: Result;
  tag: string;
  op: Op;
}

/** Counts timestamps inside a sliding window. */
export class Win {
  private ts: number[] = [];
  private head = 0;
  constructor(private w: number) {}
  add(t: number) {
    this.ts.push(t);
  }
  count(now: number) {
    const from = now - this.w;
    while (this.head < this.ts.length && this.ts[this.head] <= from) this.head++;
    if (this.head > 1024) {
      this.ts = this.ts.slice(this.head);
      this.head = 0;
    }
    return this.ts.length - this.head;
  }
}

export interface NodeRt {
  spec: NodeSpec;
  up: boolean;
  /** Exists and is drawn (autoscaled servers can be off). */
  on: boolean;
  /** Can receive traffic (false while booting or draining). */
  ready: boolean;
  bootUntil: number;
  work: Req[];
  held: Req[];
  queue: Req[];
  parked: Req[];
  incoming: number;
  rr: number;
  out: Map<string, number>;
  cache: Map<number, Entry>;
  waiters: Map<number, Req[]>;
  data: Map<number, number>;
  buckets: Map<string, { tokens: number; t: number }>;
  /** `trialId`: the request sent as the half-open breaker's one trial (0 when none). */
  breaker: { state: "closed" | "open" | "half"; fails: number; openedAt: number; trial: boolean; trialId: number };
  health: Map<string, { ok: boolean; fails: number; passes: number }>;
  load: number;
  /** Running hot: its line passed twice its workers, and has not yet fallen back to its workers' count. */
  hot: boolean;
  hits: Win;
  misses: Win;
  arrivals: Win;
  served: number;
  nextArrival: number;
  nextProbe: number;
  nextScale: number;
  lastScaleOut: number;
  moved: number;
  movedAt: number;
  rng: () => number;
  cdf: number[] | null;
}

export interface Note {
  t: number;
  text: string;
}

/** A logical request's first attempt leaving its client. */
export interface Spawn {
  t: number;
  client: string;
  key: number;
  op: Op;
  cost: number;
}

const SAMPLE_KEYS = 1000;

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
  private tracing: boolean;
  private seq = 0;
  private truth = new Map<number, number>();
  private writtenIn = new Map<string, Set<number>>();
  private nextId = 1;
  private acc = 0;
  private pending: { at: number; client: string; key: number; op: Op; first: number; attempt: number; cost: number }[] = [];
  private retryRng: () => number;
  private cycleStart = 0;
  private cursor = 0;
  private seed: number;

  constructor(spec: SceneSpec, opts: { trace?: boolean } = {}) {
    this.spec = spec;
    this.tracing = !!opts.trace;
    this.seed = spec.seed ?? 7;
    this.windowMs = spec.windowMs ?? 1000;
    this.attempts = new Win(this.windowMs);
    this.logical = new Win(this.windowMs);
    this.retries = new Win(this.windowMs);
    this.retryRng = mulberry32(this.seed ^ 0x9e3779b9);
    this.reconfigure(spec);
  }

  // ---------------------------------------------------------------- topology

  reconfigure(spec: SceneSpec) {
    this.spec = spec;
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
    };
    if (spec.client) {
      const r = this.rate(rt);
      rt.nextArrival = this.t + (r > 0 ? this.gap(rt, r) : 50);
    }
    return rt;
  }

  // ---------------------------------------------------------------- public controls

  /** Crash (false) or restore (true) a node. */
  setUp(id: string, up: boolean) {
    const n = this.nodes.get(id);
    if (!n || n.up === up) return;
    n.up = up;
    this.effect(up ? "recover" : "crash", id);
    if (!up) {
      n.cache.clear();
      if (!n.spec.sink && n.spec.kind !== "queue") {
        for (const r of [...n.queue, ...n.work]) this.fail(n, r);
        n.queue = [];
        n.work = [];
        for (const r of [...n.held]) this.giveUp(n, r);
      }
    } else {
      for (const r of n.parked) r.phase = "gone";
      n.parked = [];
    }
  }

  setPartition(on: boolean) {
    if (this.partitioned === on) return;
    this.partitioned = on;
    if (on) {
      this.writtenIn.clear();
      return;
    }
    const sides = [...this.writtenIn.values()];
    if (sides.length > 1) {
      const [a, ...rest] = sides;
      for (const k of a) if (rest.some((s) => s.has(k))) this.conflicts++;
    }
    this.writtenIn.clear();
    const msgs = this.blocked;
    this.blocked = [];
    for (const r of msgs) this.sendRepl(r, this.nodes.get(r.to));
  }

  /** Drop a key from every cache (used to stage a cache stampede). */
  expire(key: number) {
    for (const n of this.list) if (n.spec.kind === "cache") n.cache.delete(key);
  }

  note(text: string) {
    this.notes.push({ t: this.t, text });
    if (this.notes.length > 20) this.notes.shift();
  }

  /** Current time including the partial tick, for smooth drawing between steps. */
  get now() {
    return this.t + this.acc;
  }

  // ---------------------------------------------------------------- stepping

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
      if (r.phase === "travel" && r.t1 <= t) this.arrive(r);
    }
    for (const n of this.list) {
      if (n.work.length) this.finish(n);
      if (n.queue.length) this.start(n);
    }
    for (let i = 0; i < this.reqs.length; i++) {
      const r = this.reqs[i];
      if (r.phase !== "gone" && !r.abandoned && r.deadline <= t) this.timeout(r);
    }
    if (t % 100 === 0) this.prune();
  }

  private runScript() {
    const s = this.spec.script;
    if (!s || !s.events.length) return;
    if (this.t >= this.cycleStart + s.loopMs) {
      this.cycleStart += s.loopMs;
      this.cursor = 0;
    }
    while (this.cursor < s.events.length && this.t >= this.cycleStart + s.events[this.cursor].at) {
      const e = s.events[this.cursor++];
      e.run(this);
      if (e.label) this.note(e.label);
    }
  }

  private prune() {
    this.reqs = this.reqs.filter((r) => r.phase !== "gone");
    const from = this.t - this.windowMs * 2;
    if (this.done.length && this.done[0].t < from) this.done = this.done.filter((d) => d.t >= from);
    if (this.jobs.length && this.jobs[0].t < from) this.jobs = this.jobs.filter((d) => d.t >= from);
    if (this.fx.length > 120) this.fx = this.fx.slice(-80);
  }

  // ---------------------------------------------------------------- controllers

  private control() {
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
  }

  private probe(lb: NodeRt, target: string) {
    const r = this.make(lb.spec.id, "probe", 0, "probe");
    r.deadline = this.t + lb.spec.health!.timeoutMs;
    r.probeOf = target;
    this.send(r, target);
  }

  private healthResult(lb: NodeRt, target: string, ok: boolean) {
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
  }

  private autoscale(lb: NodeRt) {
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
  }

  private callTimeouts(n: NodeRt) {
    const limit = n.spec.callTimeoutMs!;
    for (const r of [...n.held]) if (this.t - r.calledAt >= limit) this.giveUp(n, r);
  }

  /** Stop waiting on a downstream call: the original becomes a ghost, an error answer leaves from here. */
  private giveUp(n: NodeRt, r: Req) {
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
  }

  // ---------------------------------------------------------------- arrivals

  private rate(n: NodeRt) {
    const r = n.spec.client?.rate ?? 0;
    return typeof r === "function" ? r(this.t) : r;
  }

  private gap(n: NodeRt, rate: number) {
    return (-Math.log(1 - n.rng()) / rate) * 1000;
  }

  private arrivals() {
    const t = this.t;
    for (const n of this.list) {
      const c = n.spec.client;
      if (!c) continue;
      let guard = 0;
      while (n.nextArrival <= t && guard++ < 50) {
        const rate = this.rate(n);
        if (rate <= 0) {
          n.nextArrival = t + 50;
          break;
        }
        const u = n.rng();
        const key = c.hot && u < c.hot ? 0 : sampleCdf(n.cdf!, n.rng());
        const op: Op = c.writes && n.rng() < c.writes ? "write" : "read";
        const cost = c.heavy && n.rng() < c.heavy.share ? c.heavy.cost : 1;
        this.spawn(n, key, op, t, 0, cost);
        n.nextArrival += this.gap(n, rate);
      }
    }
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= t);
      if (due.length) {
        this.pending = this.pending.filter((p) => p.at > t);
        for (const p of due) {
          const n = this.nodes.get(p.client);
          if (n) this.spawn(n, p.key, p.op, p.first, p.attempt, p.cost);
        }
      }
    }
  }

  private make(client: string, op: Op, key: number, tag: string): Req {
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
    };
    this.reqs.push(r);
    return r;
  }

  private spawn(n: NodeRt, key: number, op: Op, first: number, attempt: number, cost: number) {
    const c = n.spec.client!;
    const r = this.make(n.spec.id, op, key, c.tag ?? "user");
    r.first = first;
    r.attempt = attempt;
    r.cost = cost;
    const timeout = c.timeoutMs ?? this.spec.timeoutMs;
    if (timeout) r.deadline = this.t + timeout;
    this.attempts.add(this.t);
    if (attempt === 0) this.logical.add(this.t);
    if (attempt === 0 && this.tracing) this.trace.push({ t: this.t, client: n.spec.id, key, op, cost });
    const target = n.spec.to?.[0];
    if (target) this.send(r, this.resolve(n, target));
  }

  // ---------------------------------------------------------------- movement

  latency(a: string, b: string) {
    const o = this.spec.links?.[`${a}>${b}`] ?? this.spec.links?.[`${b}>${a}`];
    if (o !== undefined) return o;
    const A = this.nodes.get(a)?.spec.at;
    const B = this.nodes.get(b)?.spec.at;
    if (!A || !B) return 20;
    const d = Math.hypot(A[0] - B[0], (A[1] - B[1]) * 0.6);
    return Math.max(12, d * (this.spec.msPerUnit ?? 1.2));
  }

  private send(r: Req, to: string, ms?: number) {
    const from = r.stack[r.stack.length - 1].id;
    r.phase = "travel";
    r.dir = 1;
    r.from = from;
    r.to = to;
    r.t0 = this.t;
    r.t1 = this.t + (ms ?? this.latency(from, to));
    const dest = this.nodes.get(to);
    if (dest) dest.incoming++;
    if (r.op !== "probe") this.link(from, to).sent++;
  }

  private link(a: string, b: string) {
    const key = a < b ? `${a}~${b}` : `${b}~${a}`;
    let l = this.links.get(key);
    if (!l) this.links.set(key, (l = { sent: 0, failed: 0 }));
    return l;
  }

  private respond(r: Req, result?: Result) {
    if (result && !r.result) r.result = result;
    const from = r.stack.pop()!.id;
    if (!r.stack.length) {
      r.phase = "gone";
      return;
    }
    const to = r.stack[r.stack.length - 1].id;
    r.phase = "travel";
    r.dir = -1;
    r.from = from;
    r.to = to;
    r.t0 = this.t;
    r.t1 = this.t + this.latency(from, to);
    if (r.op !== "probe" && r.result === "error") this.link(from, to).failed++;
  }

  private arrive(r: Req) {
    const n = this.nodes.get(r.to);
    if (r.dir === 1 && n) n.incoming = Math.max(0, n.incoming - 1);
    if (!n) return this.unwind(r);
    r.at = n.spec.id;
    if (r.dir === 1) {
      r.stack.push({ id: n.spec.id, calls: [] });
      this.enter(n, r);
    } else {
      this.back(n, r);
    }
  }

  /** A node on this request's path was removed: hand it back, as an error, to the nearest node that still exists. */
  private unwind(r: Req) {
    if (r.dir === 1 && r.phase === "travel") {
      // Still on its way out: the sender's frame is on top.
    } else {
      r.stack.pop();
    }
    while (r.stack.length && !this.nodes.has(r.stack[r.stack.length - 1].id)) r.stack.pop();
    const prev = r.stack.length ? this.nodes.get(r.stack[r.stack.length - 1].id) : undefined;
    if (!prev || r.detached) {
      r.phase = "gone";
      return;
    }
    r.dir = -1;
    r.at = prev.spec.id;
    r.result ??= "error";
    this.back(prev, r);
  }

  // ---------------------------------------------------------------- outbound behaviour

  private enter(n: NodeRt, r: Req) {
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
  }

  private park(n: NodeRt, r: Req) {
    n.parked = n.parked.filter((p) => p.phase === "parked");
    if (n.parked.length > 60) n.parked.shift()!.phase = "gone";
    n.parked.push(r);
    r.phase = "parked";
  }

  private fail(n: NodeRt, r: Req) {
    // Refused at a full line: it falls from the line's tail.
    const full = n.queue.length >= (n.spec.queueMax ?? Infinity);
    this.effect("drop", n.spec.id, full ? n.queue.length : undefined);
    if (r.detached) {
      r.phase = "gone";
      return;
    }
    this.respond(r, "error");
  }

  private admit(n: NodeRt, r: Req) {
    if (n.queue.length >= (n.spec.queueMax ?? Infinity)) return this.fail(n, r);
    n.queue.push(r);
    r.phase = "wait";
  }

  private candidates(n: NodeRt) {
    return this.flat(n.spec.to).filter((id) => {
      const s = this.nodes.get(id);
      if (!s || !s.on || !s.ready) return false;
      if (n.spec.health) return n.health.get(id)?.ok ?? true;
      return true;
    });
  }

  private route(n: NodeRt, r: Req) {
    const c = this.candidates(n);
    if (!c.length) return this.fail(n, r);
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
      default:
        pick = c[n.rr++ % c.length];
    }
    n.out.set(pick, (n.out.get(pick) ?? 0) + 1);
    r.stack[r.stack.length - 1].via = pick;
    this.send(r, pick);
  }

  private limit(n: NodeRt, r: Req) {
    const l = n.spec.limit!;
    if (l.tags && !l.tags.includes(r.tag)) return this.send(r, this.resolve(n, n.spec.to![0]));
    const b = n.buckets.get(r.tag) ?? { tokens: l.burst, t: this.t };
    b.tokens = Math.min(l.burst, b.tokens + ((this.t - b.t) * l.rps) / 1000);
    b.t = this.t;
    n.buckets.set(r.tag, b);
    if (b.tokens < 1) {
      this.effect("reject", n.spec.id);
      return this.respond(r, "rejected");
    }
    b.tokens -= 1;
    this.send(r, this.resolve(n, n.spec.to![0]));
  }

  private lookup(n: NodeRt, r: Req) {
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
  }

  private clone(n: NodeRt, r: Req): Req {
    const c = this.make(n.spec.id, r.op, r.key, r.tag);
    c.detached = true;
    c.stack = [{ id: n.spec.id, calls: [] }];
    c.at = n.spec.id;
    return c;
  }

  private enqueue(n: NodeRt, r: Req) {
    if (n.queue.length >= (n.spec.capacity ?? Infinity)) return this.fail(n, r);
    const job = this.clone(n, r);
    job.phase = "wait";
    n.queue.push(job);
    this.respond(r, "ok");
  }

  private publish(n: NodeRt, r: Req) {
    for (const id of this.flat(n.spec.to)) this.send(this.clone(n, r), id);
    this.respond(r, "ok");
  }

  // ---------------------------------------------------------------- work

  private service(n: NodeRt, r: Req) {
    const base = n.spec.serviceMs ?? 0;
    return base * r.cost * (0.6 + 0.8 * n.rng());
  }

  private start(n: NodeRt) {
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
  }

  private dispatch(n: NodeRt) {
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
  }

  private finish(n: NodeRt) {
    for (let i = 0; i < n.work.length; ) {
      const r = n.work[i];
      if (r.doneAt > this.t) {
        i++;
        continue;
      }
      n.work.splice(i, 1);
      this.complete(n, r);
    }
  }

  private complete(n: NodeRt, r: Req) {
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
  }

  private call(n: NodeRt, r: Req, calls: Call[]) {
    const [next, ...rest] = calls;
    r.result = null;
    r.stack[r.stack.length - 1].calls = rest;
    r.calledAt = this.t;
    if (n.spec.blocking) n.held.push(r);
    this.send(r, this.resolve(n, next));
  }

  private dbDone(n: NodeRt, r: Req) {
    if (r.op === "write") {
      const seq = ++this.seq;
      this.truth.set(r.key, seq);
      n.data.set(r.key, seq);
      r.seq = seq;
      if (this.partitioned && n.spec.region) {
        const s = this.writtenIn.get(n.spec.region) ?? new Set<number>();
        s.add(r.key);
        this.writtenIn.set(n.spec.region, s);
      }
      for (const peer of this.list) {
        if (peer.spec.replicaOf === n.spec.id || n.spec.peer === peer.spec.id) {
          const m = this.make(n.spec.id, "repl", r.key, "repl");
          m.seq = seq;
          m.detached = true;
          m.at = n.spec.id;
          m.to = peer.spec.id;
          if (this.cut(n, peer)) {
            m.phase = "parked";
            this.blocked.push(m);
          } else this.sendRepl(m, peer);
        }
      }
    } else {
      r.seq = n.data.get(r.key) ?? 0;
      r.stale = r.seq < (this.truth.get(r.key) ?? 0);
    }
    this.respond(r, "ok");
  }

  private sendRepl(m: Req, peer: NodeRt | undefined) {
    if (!peer) {
      m.phase = "gone";
      return;
    }
    this.send(m, peer.spec.id, peer.spec.lagMs ?? this.latency(m.at, peer.spec.id));
  }

  private applyRepl(n: NodeRt, r: Req) {
    if ((n.data.get(r.key) ?? 0) < r.seq) n.data.set(r.key, r.seq);
    r.phase = "gone";
  }

  private cut(a: NodeRt, b: NodeRt) {
    return this.partitioned && !!a.spec.region && !!b.spec.region && a.spec.region !== b.spec.region;
  }

  // ---------------------------------------------------------------- return path

  private back(n: NodeRt, r: Req) {
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
  }

  private recordBreaker(n: NodeRt, ok: boolean) {
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
  }

  private fill(n: NodeRt, r: Req) {
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
  }

  private evict(n: NodeRt) {
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
  }

  private finishAtClient(n: NodeRt, r: Req) {
    r.phase = "gone";
    if (r.abandoned || r.detached) return;
    const res: Result = r.result === "ok" && r.stale ? "stale" : (r.result ?? "error");
    if (res === "error" && this.retry(n, r)) return;
    this.record(r, res);
  }

  private timeout(r: Req) {
    r.abandoned = true;
    if (r.op === "probe") {
      const lb = this.nodes.get(r.client);
      if (lb) this.healthResult(lb, r.probeOf, false);
      if (r.phase === "parked") r.phase = "gone";
      return;
    }
    if (r.detached) return;
    this.effect("timeout", r.client);
    const n = this.nodes.get(r.client);
    if (n && this.retry(n, r)) return;
    this.record(r, "error");
  }

  private retry(n: NodeRt, r: Req) {
    const p = n.spec.client?.retry;
    if (!p || p.mode === "none" || r.attempt >= p.max) return false;
    if (p.budget !== undefined && this.retries.count(this.t) >= p.budget * this.logical.count(this.t)) return false;
    this.retries.add(this.t);
    const base = p.baseMs ?? 100;
    const delay = p.mode === "now" ? 0 : this.retryRng() * base * Math.pow(2, r.attempt);
    this.pending.push({
      at: this.t + Math.max(TICK, delay),
      client: n.spec.id,
      key: r.key,
      op: r.op,
      first: r.first,
      attempt: r.attempt + 1,
      cost: r.cost,
    });
    return true;
  }

  private record(r: Req, result: Result) {
    this.done.push({ t: this.t, lat: this.t - r.first, result, tag: r.tag, op: r.op });
  }

  // ---------------------------------------------------------------- helpers

  flat(calls: Call[] | undefined): string[] {
    return (calls ?? []).flatMap((c) => (Array.isArray(c) ? c : [c]));
  }

  /** Resolve a call target; pools pick round-robin among nodes that are on and up. */
  private resolve(n: NodeRt, call: Call): string {
    if (!Array.isArray(call)) return call;
    const live = call.filter((id) => {
      const s = this.nodes.get(id);
      return s && s.on && s.up;
    });
    const pool = live.length ? live : call;
    return pool[n.rr++ % pool.length];
  }

  private owners(spec: NodeSpec) {
    const targets = this.flat(spec.to);
    const out: string[] = [];
    for (let k = 0; k < SAMPLE_KEYS; k++) out.push(targets.length ? ownerOf(k, targets, spec.algo) : "");
    return out;
  }

  private effect(kind: FxKind, node: string, slot?: number) {
    this.fx.push(slot === undefined ? { t: this.t, kind, node } : { t: this.t, kind, node, slot });
  }
}

function sameTargets(a: NodeSpec, b: NodeSpec) {
  return JSON.stringify(a.to) === JSON.stringify(b.to) && a.algo === b.algo;
}

const rings = new Map<string, { at: number; id: string }[]>();

/** Which target owns a key: plain modulo, or a consistent-hash ring with virtual nodes. */
export function ownerOf(key: number, targets: string[], algo: NodeSpec["algo"]): string {
  const h = mix(key + 1);
  if (algo !== "ring") return targets[h % targets.length];
  const sig = targets.join("|");
  let ring = rings.get(sig);
  if (!ring) {
    ring = [];
    for (const id of targets)
      for (let v = 0; v < 64; v++) ring.push({ at: mix(hashStr(id) ^ Math.imul(v + 1, 0x9e3779b1)), id });
    ring.sort((a, b) => a.at - b.at);
    rings.set(sig, ring);
  }
  let lo = 0;
  let hi = ring.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].at < h) lo = mid + 1;
    else hi = mid;
  }
  return ring[lo % ring.length].id;
}
