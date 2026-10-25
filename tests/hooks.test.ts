import assert from "node:assert/strict";
import { test } from "node:test";
import { Sim, type Req } from "../src/lib/sim/engine";
import { fate } from "../src/lib/sim/engine/transport";
import { measure, type MetricSpec } from "../src/lib/sim/metrics";
import { leakedHolds } from "../src/lib/sim/invariants";
import type { ClientSpec, LinkSpec, NodeSpec, SceneSpec } from "../src/lib/sim/types";

// One test per engine hook of batch 1 (docs/plan-v3.md M6, docs/research/architecture.md §2.1). Every hook is off by
// default; tests/lessons.test.ts and the fingerprint of every scene prove that the lessons built before it are unchanged.

const scene = (nodes: NodeSpec[], extra: Partial<SceneSpec> = {}): SceneSpec => ({ nodes, sloMs: 400, timeoutMs: 1600, seed: 3, ...extra });
const client = (id: string, rate: ClientSpec["rate"], to: string, extra: Partial<NodeSpec["client"]> = {}, at: [number, number] = [0, 50]): NodeSpec => ({
  id,
  kind: "client",
  label: id,
  at,
  client: { rate, keys: 50, ...extra },
  to: [to],
});
const server = (id: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ id, kind: "server", label: id, at: [50, 50], slots: 4, serviceMs: 50, ...extra });
const lb = (id: string, to: string[], extra: Partial<NodeSpec> = {}): NodeSpec => ({ id, kind: "lb", label: id, at: [30, 50], to, algo: "round-robin", ...extra });
const m = (id: MetricSpec["id"], extra: Partial<MetricSpec> = {}): MetricSpec => ({ id, label: id, ...extra });

const run = (spec: SceneSpec, ms: number) => {
  const sim = new Sim(spec);
  sim.step(ms);
  return sim;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const value = (sim: Sim, metric: MetricSpec) => measure(sim, metric) ?? NaN;
/** Sample a metric every 100 ms after a warm-up, and average it. */
function average(spec: SceneSpec, metric: MetricSpec, ms = 6000) {
  const sim = new Sim(spec);
  const xs: number[] = [];
  for (let t = 0; t < ms; t += 100) {
    sim.step(100);
    const v = t >= 1000 ? measure(sim, metric) : null;
    if (v !== null) xs.push(v);
  }
  return mean(xs);
}

// ------------------------------------------------------------------------------------------------ links

test("a link's own latency replaces the distance", () => {
  const spec = (link?: number | LinkSpec) => scene([client("u", 10, "s"), server("s", { serviceMs: 10 })], { links: link === undefined ? undefined : { "u>s": link } });
  const p50 = (s: SceneSpec) => value(run(s, 4000), m("p50"));
  assert.ok(Math.abs(p50(spec({ ms: 200 })) - p50(spec(200))) < 1, "a LinkSpec's ms means what a bare number does");
  assert.ok(p50(spec({ ms: 200 })) > 400, "out and back: 2 × 200 ms");
});

test("a thin link adds transfer time to the payload: a read's answer, not its request", () => {
  const spec = (perCostMs: number) =>
    scene([client("u", 5, "s", { heavy: { share: 1, cost: 4 } }), server("s", { serviceMs: 1 })], { links: { "u>s": { ms: 50, perCostMs } } });
  const thin = run(spec(100), 4000);
  const done = thin.done.filter((d) => d.result === "ok");
  // Wire time: 50 out, then 50 + 4 × 100 back.
  assert.ok(Math.abs(mean(done.map((d) => d.wire)) - 500) < 10, `wire ${mean(done.map((d) => d.wire))}`);
});

test("jitter spreads trips without changing who is unlucky: the same run twice", () => {
  const spec = scene([client("u", 30, "s"), server("s", { serviceMs: 5, slots: 16 })], { links: { "u>s": { ms: 100, jitterMs: 80 } } });
  const a = run(spec, 4000);
  const b = run(spec, 4000);
  assert.deepEqual(a.done, b.done);
  const wires = a.done.map((d) => d.wire);
  assert.ok(Math.max(...wires) - Math.min(...wires) > 150, "trips vary by up to ± 80 ms each way");
});

test("loss is decided by what crosses which link, never by when: two worlds lose the same first attempts", () => {
  // The same arrivals; downstream differs (one fast server, one slow one), so timing and order differ.
  const spec = (slots: number) =>
    scene([client("u", 40, "s", { timeoutMs: 600, retry: { mode: "now", max: 3 } }), server("s", { slots, serviceMs: 40 })], { links: { "u>s": { ms: 30, loss: 0.25 } } });
  const lost = (slots: number) => {
    const sim = new Sim(spec(slots));
    const seen = new Set<string>();
    const vanish = sim.vanish.bind(sim);
    sim.vanish = (r: Req) => {
      if (r.from === "u" && r.attempt === 0) seen.add(String(r.logicalId));
      vanish(r);
    };
    sim.step(5000);
    return { seen, sim };
  };
  const a = lost(8);
  const b = lost(1);
  assert.ok(a.seen.size > 20, "first attempts were lost on the way out");
  // Requests sent before the slow world's line shifted anything: identical sets.
  assert.deepEqual([...a.seen].sort(), [...b.seen].sort());
  const share = value(a.sim, m("lost"));
  assert.ok(share > 0.15 && share < 0.35, `about a quarter of crossings lost: ${share}`);
  assert.ok(value(a.sim, m("amplify")) > 1.1, "lost requests are sent again");
  // The fate itself: the same inputs, the same number; another attempt, another number.
  const r = { logicalId: 77, attempt: 0, hop: 1 } as Req;
  assert.equal(fate("u>s", r, 0), fate("u>s", { ...r }, 0));
  assert.notEqual(fate("u>s", r, 0), fate("u>s", { ...r, attempt: 1 }, 0));
});

test("a narrow link lets only so many crossings through at once; the rest wait at its start", () => {
  const sim = new Sim(scene([client("u", 60, "s"), server("s", { serviceMs: 5, slots: 32 })], { links: { "u>s": { ms: 100, parallel: 2 } } }));
  let worst = 0;
  for (let t = 0; t < 3000; t += 2) {
    sim.step(2);
    const onLink = sim.reqs.filter((r) => r.phase === "travel" && r.from === "u" && r.to === "s" && r.t0 <= sim.t && sim.t < r.t1).length;
    worst = Math.max(worst, onLink);
  }
  assert.ok(worst <= 2, `at most 2 on the link at once, saw ${worst}`);
});

// ------------------------------------------------------------------------------------------------ where the time goes

test("an answer's time is its wire, its wait and its work, which add up to the whole", () => {
  const sim = run(scene([client("u", 60, "s"), server("s", { slots: 2, serviceMs: 25 })], { links: { "u>s": 120 } }), 5000);
  const done = sim.done.filter((d) => d.result === "ok");
  const gap = mean(done.map((d) => Math.abs(d.wire + d.wait + d.work - d.lat)));
  assert.ok(gap < 3, `the parts add up (off by ${gap} ms on average)`);
  assert.ok(Math.abs(value(sim, m("wire")) - 240) < 5, "wire: 120 ms each way");
  assert.ok(value(sim, m("wait")) > 5, "a busy server makes requests wait");
});

// ------------------------------------------------------------------------------------------------ servers

test("serviceBy: per-operation service time (an index makes reads cheap, writes dearer)", () => {
  const sim = run(
    scene([client("u", 20, "db", { writes: 0.5 }), { id: "db", kind: "db", label: "db", at: [60, 50], slots: 8, serviceBy: { read: 8, write: 80 } }], { links: { "u>db": 5 } }),
    5000,
  );
  const read = value(sim, m("p50", { op: "read" }));
  const write = value(sim, m("p50", { op: "write" }));
  assert.ok(read < write / 2, `reads ${read} ms, writes ${write} ms`);
});

test("tail: a few slow requests push p99 far past p50", () => {
  const spec = (tail?: NodeSpec["tail"]) => scene([client("u", 30, "s"), server("s", { slots: 16, serviceMs: 30, tail })], { windowMs: 4000 });
  const slow = run(spec({ share: 0.03, mult: 12 }), 6000);
  const even = run(spec(), 6000);
  assert.ok(value(slow, m("p99")) > 3 * value(slow, m("p50")));
  assert.ok(value(even, m("p99")) < 2 * value(even, m("p50")));
});

test("failRate: that share of completed work fails", () => {
  const e = value(run(scene([client("u", 100, "s"), server("s", { slots: 16, failRate: 0.2 })], { windowMs: 10_000 }), 11_000), m("errors"));
  assert.ok(Math.abs(e - 0.2) < 0.04, `errors ${e}`);
});

test("shedding turns the excess away at once, so the answered stay fast", () => {
  const spec = (shed?: NodeSpec["shed"]) => scene([client("u", 160, "s"), server("s", { shed, queueMax: 400 })]);
  const shed = run(spec({ queueAbove: 8 }), 5000);
  const all = run(spec(), 5000);
  assert.ok(value(shed, m("p95")) < 400, `shed p95 ${value(shed, m("p95"))}`);
  assert.ok(value(shed, m("rejected")) > 0.3, "turned away: slate squares");
  assert.ok(value(all, m("p95")) > 1200, "served in order, everyone is late");
});

test("lifo: under overload the newest are served first, while they are still worth serving", () => {
  const spec = (order?: "fifo" | "lifo") => scene([client("u", 110, "s", { timeoutMs: 800 }), server("s", { order })]);
  const share = (s: SceneSpec) => average(s, m("errors"));
  assert.ok(share(spec("lifo")) < share(spec()) - 0.1, `lifo errors ${share(spec("lifo"))}, fifo ${share(spec())}`);
});

test("priority: under overload the important tag is served first", () => {
  const sim = run(
    scene([
      client("vip", 30, "s", { tag: "vip" }, [0, 20]),
      client("bulk", 90, "s", { tag: "bulk" }, [0, 80]),
      server("s", { priority: ["vip"], queueMax: 400 }),
    ]),
    6000,
  );
  assert.ok(value(sim, m("p95", { tag: "vip" })) < 400, "vip within its target");
  assert.ok(value(sim, m("p95", { tag: "bulk" })) > 400, "bulk waits");
});

test("bulkheads: a hanging dependency can take only its own workers", () => {
  const spec = (bulkheads?: Record<string, number>) =>
    scene([
      client("pay", 10, "s", { tag: "pay", writes: 1 }, [0, 20]),
      client("browse", 20, "s", { tag: "browse" }, [0, 80]),
      server("s", { slots: 6, blocking: true, calls: { write: ["dep"], read: [] }, callTimeoutMs: 5000, bulkheads }),
      server("dep", { downMode: "hang" }),
    ], { timeoutMs: 1000 });
  const browseErrors = (b?: Record<string, number>) => {
    const sim = new Sim(spec(b));
    sim.step(500);
    sim.setUp("dep", false);
    sim.step(3000);
    return value(sim, m("errors", { tag: "browse" }));
  };
  assert.equal(browseErrors({ pay: 2 }), 0);
  assert.ok(browseErrors() > 0.3);
});

test("byTag: a balancer sends each tag to its own targets", () => {
  const sim = run(scene([client("a", 20, "lb", { tag: "a" }), lb("lb", ["x", "y"], { byTag: { a: ["x"] } }), server("x"), server("y")]), 3000);
  assert.ok(sim.nodes.get("x")!.served > 30);
  assert.equal(sim.nodes.get("y")!.served, 0);
});

test("deadlines: honouring them stops work for callers who have gone", () => {
  const spec = (deadlines?: "honour") =>
    scene([client("u", 60, "a", { timeoutMs: 300 }), server("a", { slots: 32, serviceMs: 5, to: ["b"], deadlines }), server("b", { slots: 2, serviceMs: 60, deadlines })]);
  const ignore = average(spec(), m("wasted"));
  const honour = average(spec("honour"), m("wasted"));
  assert.ok(ignore > 0.3, `ghost work without deadlines: ${ignore}`);
  assert.ok(honour < ignore / 2, `with deadlines: ${honour}`);
});

test("deadlines: honouring them stops work in progress once the deadline passes, and frees the worker", () => {
  // Work that is admitted in time but runs long: 120 ms on average, with a slow tail, against a 150 ms deadline.
  const spec = (deadlines?: "honour") =>
    scene([client("u", 20, "s", { timeoutMs: 150 }), server("s", { slots: 4, serviceMs: 120, tail: { share: 0.3, mult: 4 }, deadlines })], { links: { "u>s": 5 } });
  const sim = new Sim(spec("honour"));
  let longest = 0;
  for (let t = 0; t < 4000; t += 10) {
    sim.step(10);
    for (const r of sim.nodes.get("s")!.work) longest = Math.max(longest, sim.t - r.first);
  }
  assert.ok(longest <= 160, `no work runs past the deadline (longest ${longest} ms)`);
  assert.ok(value(run(spec(), 4000), m("wasted")) > value(sim, m("wasted")) + 0.1, "cancelling the rest wastes less than finishing it");
});

test("a shared deadline: retries spend what is left of the first attempt's time", () => {
  // Some answers fail fast, so retries go out while time is left.
  const spec = (deadline?: "shared") =>
    scene([client("u", 30, "s", { timeoutMs: 300, retry: { mode: "backoff", max: 3, baseMs: 60, deadline } }), server("s", { slots: 1, serviceMs: 40, failRate: 0.3 })], { windowMs: 1e9 });
  const worst = (s: SceneSpec) => Math.max(...run(s, 5000).done.map((d) => d.lat));
  assert.ok(worst(spec("shared")) <= 302, "never past the one deadline");
  assert.ok(worst(spec()) > 400, "fresh budgets let a request run long past it");
});

// ------------------------------------------------------------------------------------------------ routing

test("nearest: each request goes to the closest healthy target", () => {
  const spec = scene(
    [client("u", 30, "lb"), lb("lb", ["near", "far"], { algo: "nearest", health: { everyMs: 50, failAfter: 2, passAfter: 2, timeoutMs: 400 } }), server("near"), server("far")],
    { links: { "lb>near": 10, "lb>far": 120 } },
  );
  const sim = new Sim(spec);
  sim.step(2000);
  assert.equal(sim.nodes.get("far")!.served, 0);
  sim.setUp("near", false);
  sim.step(2000);
  assert.ok(sim.nodes.get("far")!.served > 20, "the far one takes over once the near one is out");
});

test("weighted: a canary gets its share of the traffic", () => {
  const sim = run(scene([client("u", 100, "lb"), lb("lb", ["a", "b"], { algo: "weighted", weights: { a: 9, b: 1 } }), server("a", { slots: 16 }), server("b", { slots: 16 })]), 5000);
  const b = sim.nodes.get("b")!.served / (sim.nodes.get("a")!.served + sim.nodes.get("b")!.served);
  assert.ok(Math.abs(b - 0.1) < 0.04, `canary share ${b}`);
});

test("rollback: a canary failing past its limit stops getting traffic", () => {
  const sim = new Sim(scene([client("u", 60, "lb"), lb("lb", ["v1", "v2"], { algo: "weighted", weights: { v2: 1, v1: 4 }, rollback: { target: "v2", errorsAbove: 0.3 } }), server("v1"), server("v2", { failRate: 1 })]));
  sim.step(1500);
  assert.ok(sim.nodes.get("lb")!.rolledBack.has("v2"), "rolled back");
  sim.step(1500);
  assert.equal(value(sim, m("errors")), 0, "once rolled back, nothing fails");
  assert.ok(sim.notes.some((n) => n.text.includes("rolled back")));
});

// ------------------------------------------------------------------------------------------------ operating

test("drain: a node finishes what it has and leaves without failing anyone; a kill fails its work", () => {
  const spec = scene([client("u", 60, "lb"), lb("lb", ["a", "b"]), server("a"), server("b")], { windowMs: 1e9 });
  const errors = (stop: (s: Sim) => void) => {
    const sim = new Sim(spec);
    sim.step(1000);
    stop(sim);
    sim.step(1500);
    return { sim, failed: sim.done.filter((d) => d.result === "error").length };
  };
  const drained = errors((s) => s.drain("a"));
  assert.equal(drained.failed, 0);
  assert.equal(drained.sim.nodes.get("a")!.on, false, "off once idle");
  assert.ok(errors((s) => s.setUp("a", false)).failed > 0);
  // And back: it boots, then takes traffic again.
  drained.sim.boot("a", 300);
  assert.equal(drained.sim.nodes.get("a")!.ready, false);
  drained.sim.step(400);
  assert.equal(drained.sim.nodes.get("a")!.ready, true);
});

test("overload: a node past its mark for too long crashes, then comes back with its workers ramping up", () => {
  const sim = new Sim(scene([client("u", 120, "s"), server("s", { queueMax: 200, overload: { queueAbove: 20, forMs: 200, restartMs: 400, warmMs: 1000 } })]));
  let crashedAt = -1;
  let backAt = -1;
  for (let t = 0; t < 4000 && backAt < 0; t += 10) {
    sim.step(10);
    const n = sim.nodes.get("s")!;
    if (crashedAt < 0 && !n.up) crashedAt = sim.t;
    if (crashedAt >= 0 && n.up) backAt = sim.t;
  }
  assert.ok(crashedAt > 0 && backAt - crashedAt >= 400, `crashed at ${crashedAt}, back at ${backAt}`);
  assert.ok(sim.slotsOf(sim.nodes.get("s")!) < 4, "cold: fewer workers just after the restart");
  sim.step(1100);
  assert.ok(sim.fx.some((f) => f.kind === "crash" && f.node === "s"));
});

// ------------------------------------------------------------------------------------------------ keys that don't exist

test("absent keys always miss, unless the cache remembers 'not found' or an existence check answers them", () => {
  const build = (cache: Partial<NodeSpec>) =>
    scene([
      client("u", 60, "c", { keys: 10, skew: 0, absent: 0.5 }),
      { id: "c", kind: "cache", label: "c", at: [50, 50], to: ["db"], capacity: 4000, ...cache },
      { id: "db", kind: "db", label: "db", at: [90, 50], slots: 8, serviceMs: 20 },
    ]);
  const plain = run(build({}), 5000);
  const negative = run(build({ negativeTtlMs: 60_000 }), 5000);
  const bloom = run(build({ bloom: { fp: 0.05 } }), 5000);
  assert.ok(value(plain, m("hit", { nodes: ["c"] })) < 0.55, "absent keys miss every time");
  // Absent keys are drawn from a million, so even remembering them helps only when they repeat; the check helps always.
  assert.ok(bloom.nodes.get("db")!.served < plain.nodes.get("db")!.served * 0.6, "the existence check spares the database");
  const f = value(bloom, m("filtered", { nodes: ["c"] }));
  assert.ok(Math.abs(f - 0.5 * 0.95) < 0.08, `filtered ${f}`);
  assert.ok(negative.nodes.get("db")!.served <= plain.nodes.get("db")!.served);
});

// ------------------------------------------------------------------------------------------------ SLOs

test("availability and the error budget: the share answered well and on time, and what the target still allows", () => {
  const spec = scene([client("u", 40, "s"), server("s")], { sloWindowMs: 10_000, sloTarget: 0.99 });
  const healthy = run(spec, 4000);
  assert.equal(value(healthy, m("availability")), 1);
  assert.equal(value(healthy, m("budget")), 1);
  const sim = new Sim(spec);
  sim.step(3000);
  sim.setUp("s", false);
  sim.step(600);
  sim.setUp("s", true);
  sim.step(1000);
  const a = value(sim, m("availability"));
  assert.ok(a < 0.95 && a > 0.7, `availability ${a}`);
  assert.equal(value(sim, m("budget")), 0, "a 600 ms outage spends a 1% budget");
});

// ------------------------------------------------------------------------------------------------ properties

/** Every hook at once: a lossy, jittery front link, a canary, shedding, a call that times out, a narrow thin link, an
 * existence check, a database that honours deadlines and crashes under load. `tweak` changes only what is downstream. */
function everything(tweak: { shed?: number; order?: "lifo"; slots?: number; least?: boolean } = {}): SceneSpec {
  return scene(
    [
      client("web", (t: number) => (t < 5000 ? 70 : 0), "lb", { keys: 200, absent: 0.1, writes: 0.2, timeoutMs: 500, retry: { mode: "backoff", max: 2, baseMs: 40 } }, [0, 30]),
      client("bulk", (t: number) => (t < 5000 ? 20 : 0), "lb", { tag: "bulk", timeoutMs: 800, retry: { mode: "backoff", max: 1, baseMs: 60, deadline: "shared" } }, [0, 70]),
      lb("lb", ["v1", "v2"], {
        algo: tweak.least ? "least" : "weighted",
        weights: { v1: 4, v2: 1 },
        rollback: { target: "v2", errorsAbove: 0.25 },
        health: { everyMs: 100, failAfter: 2, passAfter: 2, timeoutMs: 300 },
      }),
      server("v1", { slots: tweak.slots ?? 6, serviceMs: 8, queueMax: 100, to: ["c"], blocking: true, callTimeoutMs: 250, shed: tweak.shed ? { queueAbove: tweak.shed, keep: ["user"] } : undefined, order: tweak.order, priority: ["user"] }),
      server("v2", { slots: 4, serviceMs: 8, to: ["c"], failRate: 0.4 }),
      { id: "c", kind: "cache", label: "c", at: [70, 50], to: ["db"], capacity: 60, ttlMs: 2000, coalesce: true, bloom: { fp: 0.05 }, negativeTtlMs: 1000 },
      { id: "db", kind: "db", label: "db", at: [90, 50], slots: 3, serviceBy: { read: 20, write: 45 }, tail: { share: 0.05, mult: 6 }, deadlines: "honour", queueMax: 80, overload: { queueAbove: 30, forMs: 300, restartMs: 300, warmMs: 600 } },
    ],
    {
      links: { "web>lb": { ms: 30, jitterMs: 15, loss: 0.05 }, "bulk>lb": { ms: 40, loss: 0.05 }, "lb>v1": { ms: 15, loss: 0.03 }, "c>db": { ms: 10, perCostMs: 5, parallel: 4 } },
      windowMs: 1e9,
    },
  );
}

/** Watch a run: every logical request sent, every one recorded, and the books (`leakedHolds`) checked every 50 ms. */
function audit(spec: SceneSpec, ms: number) {
  const sim = new Sim(spec);
  const clients = new Set(spec.nodes.filter((n) => n.client).map((n) => n.id));
  const sent = new Set<string>();
  const recorded: string[] = [];
  // Requests are kept as made; their identity is read once the run is over, after their makers have set it.
  const made: Req[] = [];
  const make = sim.make.bind(sim);
  sim.make = (...a: Parameters<Sim["make"]>) => {
    const r = make(...a);
    made.push(r);
    return r;
  };
  const record = sim.record.bind(sim);
  sim.record = (r, result) => {
    recorded.push(`${r.client}:${r.logicalId}`);
    record(r, result);
  };
  const broken: string[] = [];
  for (let t = 0; t < ms; t += 50) {
    if (t === 5000) sim.holding = true;
    sim.step(50);
    broken.push(...leakedHolds(sim));
  }
  for (const r of made) if (clients.has(r.client) && r.op !== "probe" && !r.detached) sent.add(`${r.client}:${r.logicalId}`);
  return { sim, sent, recorded, broken };
}

test("property: the same scene runs the same, whatever the step size", () => {
  const a = new Sim(everything());
  a.step(7000);
  const b = new Sim(everything());
  for (let t = 0; t < 7000; t += 30) b.step(Math.min(30, 7000 - t));
  assert.deepEqual(a.done, b.done);
  assert.deepEqual(a.fx, b.fx);
  assert.deepEqual(a.notes, b.notes);
});

/** Run with traffic for 5 s, then none until everything settles: each request recorded once, nothing left holding on. */
function settles(spec: SceneSpec, label: string) {
  const { sim, sent, recorded, broken } = audit(spec, 30_000);
  assert.deepEqual(broken.slice(0, 5), [], label);
  assert.equal(new Set(recorded).size, recorded.length, `recorded twice: ${label}`);
  assert.ok(recorded.every((id) => sent.has(id)), "only what was sent is recorded");
  assert.equal(recorded.length, sent.size, `every request ended once traffic stopped: ${label}`);
  // Nothing left holding a worker, a place in line, a cache's waiting readers or a balancer's count.
  for (const n of sim.list) {
    assert.equal(n.queue.length + n.work.length + n.held.length + n.incoming + n.waiters.size, 0, `${n.spec.id} is idle: ${label}`);
    for (const [id, k] of n.out) assert.equal(k, 0, `${n.spec.id} → ${id} has nothing outstanding: ${label}`);
  }
  return sim;
}

test("property: every logical request is recorded exactly once, and the books balance throughout", () => {
  for (const tweak of [{}, { shed: 6 }, { order: "lifo" as const }, { slots: 2 }, { least: true }]) settles(everything(tweak), JSON.stringify(tweak));
});

test("a server that gives up on a call answers its caller once, and the ghost it leaves is never recorded", () => {
  // The call outlives both the server's patience and the client's: ghosts are still at work when the client's time is up.
  const spec = scene([client("u", 20, "s", { timeoutMs: 600 }), server("s", { slots: 8, serviceMs: 5, blocking: true, to: ["dep"], callTimeoutMs: 150 }), server("dep", { slots: 32, serviceMs: 900 })]);
  settles(spec, "ghosts");
  assert.ok(run(spec, 3000).done.filter((d) => d.result === "error").length > 30, "the server gave up and answered with errors");
});

test("a request dropped for its deadline lets go of what it held on the way: a balancer's count, a cache's readers", () => {
  const spec = scene([
    client("u", 80, "lb", { keys: 8, timeoutMs: 300 }),
    lb("lb", ["c"], { algo: "least" }),
    { id: "c", kind: "cache", label: "c", at: [60, 50], to: ["db"], coalesce: true },
    { id: "db", kind: "db", label: "db", at: [90, 50], slots: 1, serviceMs: 60, deadlines: "honour" },
  ]);
  settles(spec, "deadlines");
  assert.ok(run(spec, 3000).fx.some((f) => f.kind === "reject" && f.node === "db"), "the database turned some away");
});

test("property: what goes on downstream never changes the traffic that arrives", () => {
  const trace = (spec: SceneSpec) => {
    const sim = new Sim(spec, { trace: true });
    sim.step(5000);
    return sim.trace;
  };
  const base = trace(everything());
  assert.ok(base.length > 300);
  for (const tweak of [{ shed: 6 }, { order: "lifo" as const }, { slots: 2 }, { least: true }]) assert.deepEqual(trace(everything(tweak)), base, JSON.stringify(tweak));
});

// ------------------------------------------------------------------------------------------------ added with the M6 lessons

test("sessions in a server's memory: users moved to another server, or back after a crash, are signed out once", () => {
  const spec = (sessions: boolean) =>
    scene([
      client("u", 60, "lb", { keys: 30 }),
      lb("lb", ["a", "b", "c"], { algo: "hash", health: { everyMs: 50, failAfter: 2, passAfter: 2, timeoutMs: 200 } }),
      server("a", { sessions }),
      server("b", { sessions }),
      server("c", { sessions }),
    ], { windowMs: 1e9 });
  const signedOut = (sessions: boolean) => {
    const sim = new Sim(spec(sessions));
    sim.step(1500);
    const before = sim.done.filter((d) => d.result === "error").length;
    sim.setUp("b", false);
    sim.step(1500);
    sim.setUp("b", true);
    sim.step(1500);
    return { before, after: sim.done.filter((d) => d.result === "error").length - before };
  };
  const kept = signedOut(true);
  assert.equal(kept.before, 0, "the first visit signs users in");
  // Each of b's users fails once when moved, and once more when sent back to b, which lost their sessions.
  assert.ok(kept.after > signedOut(false).after + 10, `${kept.after} signed out, against ${signedOut(false).after} errors without sessions`);
});

test("absent keys from a small pool repeat, so remembering 'not found' spares the database", () => {
  const build = (absentKeys?: number) =>
    scene([
      client("bot", 60, "c", { absent: 1, absentKeys }),
      { id: "c", kind: "cache", label: "c", at: [50, 50], to: ["db"], capacity: 500, negativeTtlMs: 60_000 },
      { id: "db", kind: "db", label: "db", at: [90, 50], slots: 8, serviceMs: 20 },
    ]);
  const served = (absentKeys?: number) => run(build(absentKeys), 5000).nodes.get("db")!.served;
  assert.ok(served(50) < served() / 3, `${served(50)} lookups with 50 missing ids, ${served()} with a million`);
});
