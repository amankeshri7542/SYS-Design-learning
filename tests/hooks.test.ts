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
  for (const r of made) if (clients.has(r.client) && r.op !== "probe" && r.op !== "sub" && !r.detached) sent.add(`${r.client}:${r.logicalId}`);
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
  // Nothing left holding a worker, a place in line, a cache's waiting readers or a balancer's count. A queue with no
  // consumers (a dead-letter queue) keeps its jobs on purpose.
  for (const n of sim.list) {
    const store = n.spec.kind === "queue" && !sim.flat(n.spec.to).length;
    // Health checks and heartbeats never stop: one may be on its way.
    const probes = sim.reqs.filter((r) => r.phase === "travel" && r.dir === 1 && r.to === n.spec.id && r.op === "probe").length;
    assert.equal((store ? 0 : n.queue.length) + n.work.length + n.held.length + n.incoming - probes + n.waiters.size + n.waiting.length + n.inflight.size + n.sendq.length + n.subs.length, 0, `${n.spec.id} is idle: ${label}`);
    assert.ok(n.conns.every((k) => k.busy === 0), `${n.spec.id}'s connections are all free: ${label}`);
    if (n.spec.client?.window) assert.equal(n.flying, 0, `${n.spec.id} has nothing in flight: ${label}`);
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

// ------------------------------------------------------------------------------------------------ batch 2a: messages and delivery

const queue = (id: string, to: string[], extra: Partial<NodeSpec> = {}): NodeSpec => ({ id, kind: "queue", label: id, at: [40, 50], to, ...extra });
const worker = (id: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ id, kind: "server", label: id, at: [80, 50], slots: 1, serviceMs: 100, sink: true, ...extra });

test("acks over a lossy link: resending delivers everything, a lost ack means a duplicate, and an idempotent receiver does it once", () => {
  const spec = (idempotent: boolean) =>
    scene([client("u", 30, "r", { timeoutMs: 300, retry: { mode: "now", max: 6 } }), server("r", { slots: 8, serviceMs: 10, replies: "ack", idempotent })], {
      links: { "u>r": { ms: 40, loss: 0.2 } },
      windowMs: 1e9,
    });
  const twice = run(spec(false), 6000);
  const once = run(spec(true), 6000);
  for (const sim of [twice, once]) assert.ok(value(sim, m("answered")) > 0.99, "everything is delivered in the end");
  assert.ok(value(twice, m("duplicates", { nodes: ["r"] })) > 5, "lost acks make the receiver do messages again");
  assert.equal(value(once, m("duplicates", { nodes: ["r"] })), 0);
  assert.ok(once.fx.some((f) => f.kind === "dupe") || once.nodes.get("r")!.done.size > 0, "repeats are answered from notes");
  // Its answers are acks: drawn small.
  const r = new Sim(spec(true));
  let acks = 0;
  for (let t = 0; t < 2000; t += 10) {
    r.step(10);
    acks += r.reqs.filter((q) => q.ack && q.phase === "travel").length;
  }
  assert.ok(acks > 0);
});

test("an idempotent database applies a retried write once", () => {
  const spec = (idempotent: boolean) =>
    scene([
      client("u", 20, "app", { writes: 1, timeoutMs: 250, retry: { mode: "now", max: 2 } }),
      server("app", { slots: 16, serviceMs: 5, to: ["db"] }),
      { id: "db", kind: "db", label: "db", at: [90, 50], slots: 2, serviceMs: 120, idempotent },
    ], { windowMs: 1e9 });
  assert.ok(value(run(spec(false), 6000), m("duplicates", { nodes: ["db"] })) > 5, "a timed-out write is retried and applied twice");
  assert.equal(value(run(spec(true), 6000), m("duplicates", { nodes: ["db"] })), 0);
});

test("queue acks: acked on receipt, a crashed worker's job is lost; acked when done, it is handed out again", () => {
  const spec = (mode: "receive" | "finish") =>
    scene([
      client("u", 8, "q"),
      queue("q", ["w1", "w2"], { ack: { mode, visibilityMs: 600 } }),
      worker("w1", { serviceMs: 300 }),
      worker("w2", { serviceMs: 300 }),
    ], { windowMs: 1e9 });
  const crashed = (mode: "receive" | "finish") => {
    const sim = new Sim(spec(mode));
    sim.step(1500);
    sim.setUp("w2", false);
    sim.step(2000);
    return sim;
  };
  const receive = crashed("receive");
  assert.ok(value(receive, m("lostJobs")) >= 1);
  assert.equal(value(receive, m("redelivered")), 0);
  const finish = crashed("finish");
  assert.equal(value(finish, m("lostJobs")), 0);
  assert.ok(value(finish, m("redelivered")) >= 1);
});

test("a visibility timeout shorter than the job hands it out twice; an idempotent worker does it once", () => {
  const spec = (idempotent: boolean) =>
    scene([
      client("u", 6, "q"),
      queue("q", ["w1", "w2"], { ack: { mode: "finish", visibilityMs: 250 } }),
      worker("w1", { serviceMs: 400, idempotent }),
      worker("w2", { serviceMs: 400, idempotent }),
    ], { windowMs: 1e9 });
  // Two workers keep separate notes: the duplicate is done by the other one unless notes are shared, so one worker here.
  const one = (idempotent: boolean) =>
    scene([client("u", 2, "q"), queue("q", ["w"], { ack: { mode: "finish", visibilityMs: 250 } }), worker("w", { serviceMs: 400, idempotent })], { windowMs: 1e9 });
  assert.ok(value(run(spec(false), 5000), m("duplicates")) > 0);
  assert.equal(value(run(one(true), 5000), m("duplicates")), 0);
  assert.ok(value(run(one(false), 5000), m("duplicates")) > 0);
});

test("a poison job blocks an ordered line until it is dead-lettered after its last delivery", () => {
  const spec = (maxDeliveries?: number, ordered = true) =>
    scene([
      client("u", 5, "q", { poison: 0.15 }),
      queue("q", ["w"], { ack: { mode: "finish", visibilityMs: 200, maxDeliveries, deadLetter: maxDeliveries ? "dlq" : undefined, ordered } }),
      worker("w", { serviceMs: 60 }),
      queue("dlq", [], { at: [80, 90] }),
    ], { windowMs: 3000 });
  const stuck = run(spec(), 8000);
  const moving = run(spec(3), 8000);
  assert.ok(value(stuck, m("redelivered")) > 5, "the poison job comes back again and again");
  assert.ok(stuck.nodes.get("q")!.queue.length > 10, "and the line behind it grows");
  assert.ok(value(moving, m("deadLettered")) > 0);
  assert.ok(moving.nodes.get("dlq")!.queue.length > 0, "dead letters wait in their own queue");
  assert.ok(moving.nodes.get("q")!.queue.length < 5, "the line moves again");
  // Unordered, the worker serves the jobs behind a poison job while it waits out its visibility timeout.
  const jobWait = (s: SceneSpec) => value(run(s, 8000), m("jobWait"));
  assert.ok(jobWait(spec(3, false)) < jobWait(spec(3)), "an ordered line waits behind each poison job");
});

test("back-pressure: holding the producer keeps the line short; rejecting turns jobs away; dropping the oldest loses them", () => {
  const spec = (mode?: "wait" | "reject" | "drop-oldest") =>
    scene([client("u", 50, "q", { timeoutMs: 5000 }), queue("q", ["w"], { backpressure: mode ? { high: 20, low: 15, mode } : undefined }), worker("w", { slots: 3, serviceMs: 100 })], {
      windowMs: 1e9,
    });
  const unbounded = run(spec(), 6000);
  const held = run(spec("wait"), 6000);
  assert.ok(unbounded.nodes.get("q")!.queue.length > 80, "unbounded, the line grows without end");
  assert.ok(held.nodes.get("q")!.queue.length <= 20, "held, it stays at its mark");
  assert.ok(held.nodes.get("q")!.waiting.length > 0, "and the producer's requests wait instead");
  assert.ok(value(held, m("p95")) > value(unbounded, m("p50")) * 0 + 1000, "so the producer slows down");
  assert.ok(value(run(spec("reject"), 6000), m("rejected")) > 0.2);
  assert.ok(value(run(spec("drop-oldest"), 6000), m("lostJobs")) > 0);
});

test("the outbox: a dual write loses events while the broker is down; the outbox delivers them once it is back", () => {
  const spec = (outbox: boolean) =>
    scene([
      client("u", 20, "app", { writes: 1 }),
      server("app", { slots: 16, serviceMs: 5, calls: { write: outbox ? ["db"] : ["db", "broker"], read: [] } }),
      { id: "db", kind: "db", label: "db", at: [70, 30], slots: 8, serviceMs: 10, idempotent: false, outbox: outbox ? { to: "broker", everyMs: 100 } : undefined },
      queue("broker", ["c"], { at: [70, 70] }),
      worker("c", { slots: 8, serviceMs: 10, idempotent: true }),
    ], { windowMs: 2000 });
  const lost = (outbox: boolean) => {
    const sim = new Sim(spec(outbox));
    sim.step(1000);
    sim.setUp("broker", false);
    sim.step(1200);
    sim.setUp("broker", true);
    sim.step(3000);
    return value(sim, m("lostEvents", { nodes: ["db", "c"] }));
  };
  assert.ok(lost(false) > 0.1, `dual write: ${lost(false)} of events lost`);
  assert.equal(lost(true), 0);
});

test("one consumer per partition, failing over in order; several consumers on one queue finish a key's jobs out of order", () => {
  const spec = (consumers?: "first") =>
    scene([client("u", 25, "q", { keys: 3 }), queue("q", ["c1", "c2", "c3"], { consumers }), worker("c1", { serviceMs: 60 }), worker("c2", { serviceMs: 60 }), worker("c3", { serviceMs: 60 })], {
      windowMs: 1e9,
    });
  const spread = run(spec(), 5000);
  assert.ok(value(spread, m("reordered")) > 0, "round robin over three consumers loses per-key order");
  const first = new Sim(spec("first"));
  first.step(2500);
  assert.equal(first.nodes.get("c2")!.served + first.nodes.get("c3")!.served, 0, "only the first consumer takes jobs");
  first.setUp("c1", false);
  first.step(2500);
  assert.ok(first.nodes.get("c2")!.served > 10, "the next one takes over");
  assert.equal(value(first, m("reordered")), 0);
});

test("a queue that runs out of memory loses every job in it", () => {
  const sim = run(
    scene([client("u", 60, "q"), queue("q", ["w"], { overload: { queueAbove: 50, forMs: 200, restartMs: 500, warmMs: 1 } }), worker("w", { slots: 2, serviceMs: 100 })], { windowMs: 1e9 }),
    4000,
  );
  assert.ok(value(sim, m("lostJobs")) > 40);
});

test("property: every request is accounted for and nothing leaks, with every message-and-delivery hook at once", () => {
  settles(
    scene([
      client("u", 40, "q", { poison: 0.05, writes: 0.5, timeoutMs: 1500 }),
      queue("q", ["w1", "w2"], { ack: { mode: "finish", visibilityMs: 400, maxDeliveries: 3, deadLetter: "dlq" }, backpressure: { high: 25, low: 15, mode: "wait" } }),
      worker("w1", { serviceMs: 120, slots: 2, idempotent: true, to: ["db"], sink: false }),
      worker("w2", { serviceMs: 120, slots: 2, idempotent: false }),
      { id: "db", kind: "db", label: "db", at: [90, 20], slots: 4, serviceMs: 20, idempotent: true, outbox: { to: "events", everyMs: 80 } },
      queue("events", ["c"], { at: [90, 60] }),
      worker("c", { slots: 4, serviceMs: 10, idempotent: true }),
      queue("dlq", [], { at: [60, 90] }),
    ]),
    "batch 2a",
  );
});

test("a fetcher acks its job by answering; a dead site's job comes back; a crash loses only what was acked on receipt", () => {
  const spec = (mode: "receive" | "finish", poison?: number, workMs = 10) =>
    scene([
      client("u", 30, "q", { poison }),
      queue("q", ["f1", "f2"], { ack: { mode, visibilityMs: 900 } }),
      server("f1", { slots: 4, serviceMs: workMs, blocking: true, calls: { read: ["web"], write: ["web"] }, callTimeoutMs: 2000 }),
      server("f2", { slots: 4, serviceMs: workMs, blocking: true, calls: { read: ["web"], write: ["web"] }, callTimeoutMs: 2000 }),
      server("web", { slots: 64, serviceMs: 150 }),
    ], { windowMs: 1e9 });
  const healthy = run(spec("finish"), 4000);
  assert.equal(value(healthy, m("redelivered")), 0, "every answer acks its job: nothing is handed out again");
  assert.ok(healthy.nodes.get("q")!.inflight.size <= 10, "jobs out are only those being fetched");
  assert.ok(value(run(spec("finish", 0.1), 4000), m("redelivered")) > 0, "a dead site fails its job, which comes back");
  // The fetcher waiting on a dead site hears the failure at once, rather than holding a worker until its call times out.
  const dead = new Sim(spec("finish", 0.3));
  for (let t = 0; t < 3000; t += 50) {
    dead.step(50);
    assert.deepEqual(leakedHolds(dead), []);
  }
  const crash = (mode: "receive" | "finish", workMs?: number) => {
    const sim = new Sim(spec(mode, undefined, workMs));
    sim.step(1500);
    sim.setUp("f1", false);
    sim.step(2000);
    return sim;
  };
  assert.ok(value(crash("receive"), m("lostJobs")) > 0, "acked on receipt, the crashed fetcher's pages are lost");
  // Those it was still working on (not waiting on the site) are lost too.
  assert.ok(value(crash("receive", 200), m("lostJobs")) > value(crash("receive"), m("lostJobs")));
  assert.equal(value(crash("finish"), m("lostJobs")), 0);
  assert.ok(value(crash("finish"), m("redelivered")) > 0, "acked when done, they are handed out again");
});

// ------------------------------------------------------------------------------------------------ batch 2b: connections and real time

const db = (id: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ id, kind: "db", label: id, at: [90, 50], slots: 8, serviceMs: 10, ...extra });

test("a new connection costs its handshake's round trips; keep-alive pays them once", () => {
  // 50 ms each way: a round trip is 100 ms. Two handshake round trips, then the request's own.
  const spec = (keepAliveMs: number) =>
    scene([{ ...client("u", 4, "s"), connect: { handshakeRtts: 2, keepAliveMs, max: 6 } }, server("s", { serviceMs: 10 })], { links: { "u>s": 50 } });
  const fresh = run(spec(0), 6000);
  const p50 = value(fresh, m("p50"));
  assert.ok(Math.abs(p50 - (3 * 100 + 10)) < 25, `new connection each time: p50 ${p50} ≈ 3 round trips + service`);
  assert.ok(value(fresh, m("handshakes")) > 3, "a handshake for every request");
  const kept = run(spec(5000), 6000);
  assert.ok(Math.abs(value(kept, m("p50")) - (100 + 10)) < 25, `kept alive: p50 ${value(kept, m("p50"))} ≈ 1 round trip + service`);
  assert.equal(value(kept, m("handshakes")), 0, "no handshakes once the connections are open");
  assert.ok(value(kept, m("connections", { nodes: ["u"] })) <= 6);
  // Kept alive only briefly, a connection closes between requests a quarter of a second apart.
  assert.ok(value(run(spec(60), 6000), m("handshakes")) > 1, "idle connections close");
  // The handshake shows where the time went: on the wire.
  const d = fresh.done.filter((x) => x.result === "ok");
  assert.ok(mean(d.map((x) => x.wire)) > 280);
});

test("one exchange per connection makes requests wait their turn; a multiplexed connection carries them all at once", () => {
  const spec = (streams: "one" | "multiplex") =>
    scene([{ ...client("u", 3, "s", { page: 6 }), connect: { handshakeRtts: 1, keepAliveMs: 5000, max: 1, streams } }, server("s", { slots: 16, serviceMs: 20 })], { links: { "u>s": 30 } });
  const one = run(spec("one"), 6000);
  const mux = run(spec("multiplex"), 6000);
  assert.ok(value(one, m("sendWait")) > 100, `one at a time: requests wait at the browser (${value(one, m("sendWait"))} ms)`);
  assert.equal(value(mux, m("sendWait")), 0);
  assert.ok(value(one, m("pageMs")) > 3 * value(mux, m("pageMs")), "a page of six waits six round trips on one lane");
});

test("a database refuses connections past its limit; a pool of a few kept open never reaches it", () => {
  const spec = (pool: boolean) =>
    scene([
      client("u", 150, "app", { timeoutMs: 2000 }),
      server("app", { slots: 64, serviceMs: 2, to: ["db"], blocking: true, connect: pool ? { handshakeRtts: 1, keepAliveMs: Infinity, max: 6, waitMs: 800 } : { handshakeRtts: 1, keepAliveMs: 0, max: 1000 } }),
      db("db", { slots: 8, serviceMs: 30, maxConns: 6 }),
    ], { links: { "app>db": 8 } });
  const each = run(spec(false), 4000);
  assert.ok(value(each, m("errors")) > 0.1, `a connection per request: past 6 open, refused (${value(each, m("errors"))})`);
  const pool = run(spec(true), 4000);
  assert.equal(value(pool, m("errors")), 0);
  assert.ok(value(pool, m("connections", { nodes: ["db"] })) <= 6);
  assert.ok(value(pool, m("sendWait")) > 0, "requests wait briefly for a pooled connection");
  // A pool too small for the load: requests that wait past its limit fail fast, at the server.
  const tiny = scene([client("u", 150, "app", { timeoutMs: 2000 }), server("app", { slots: 64, serviceMs: 2, to: ["db"], blocking: true, connect: { handshakeRtts: 1, keepAliveMs: Infinity, max: 1, waitMs: 100 } }), db("db", { slots: 8, serviceMs: 30 })], { links: { "app>db": 8 } });
  const small = run(tiny, 4000);
  assert.ok(value(small, m("errors")) > 0.3 && value(small, m("p95")) < 600, "a pool of one turns most away within its 100 ms wait");
});

test("restarting a server drops every connection to it: each client shakes hands again at once", () => {
  const spec = scene(
    Array.from({ length: 6 }, (_, i): NodeSpec => ({ ...client(`u${i}`, 5, "s", {}, [0, i * 15]), connect: { handshakeRtts: 2, keepAliveMs: 1e9, max: 2 } })).concat([server("s", { serviceMs: 10 })]),
    { links: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`u${i}>s`, 40])) },
  );
  const sim = run(spec, 3000);
  assert.equal(value(sim, m("handshakes")), 0, "settled: no new connections");
  sim.setUp("s", false);
  sim.step(50);
  assert.equal(value(sim, m("connections", { nodes: ["s"] })), 0);
  sim.setUp("s", true);
  sim.step(800);
  assert.ok(value(sim, m("handshakes")) >= 6, "every client opened a connection again");
  assert.deepEqual(leakedHolds(sim), []);
});

test("a connection that resends what it loses delivers everything, once, without the client retrying", () => {
  const spec = (rtoMs?: number) =>
    scene(
      [{ ...client("u", 30, "s", { timeoutMs: 1500, retry: { mode: "now", max: 3 } }), connect: { handshakeRtts: 0, keepAliveMs: 1e9, max: 1, streams: "independent", rtoMs } }, server("s", { slots: 16, serviceMs: 5 })],
      { links: { "u>s": { ms: 30, loss: 0.2 } }, windowMs: 1e9 },
    );
  const resent = run(spec(200), 5000);
  assert.ok(value(resent, m("answered")) > 0.99);
  assert.ok(Math.abs(value(resent, m("amplify")) - 1) < 1e-9, "no request sent twice by the client");
  assert.ok(resent.fx.some((f) => f.kind === "lost"), "losses still show where they happened");
  assert.ok(value(run(spec(), 5000), m("amplify")) > 1.2, "without it, the client's timeout resends");
});

test("head-of-line blocking: on a multiplexed connection one loss holds up the answers behind it; independent streams don't wait", () => {
  const spec = (streams: "multiplex" | "independent") =>
    scene(
      [{ ...client("u", 2, "s", { page: 12 }), connect: { handshakeRtts: 0, keepAliveMs: 1e9, max: 1, streams, rtoMs: 300 } }, server("s", { slots: 16, serviceMs: 5 })],
      { links: { "u>s": { ms: 30, loss: 0.08, perCostMs: 12, parallel: 1 } }, windowMs: 1e9 },
    );
  const mux = run(spec("multiplex"), 12_000);
  const ind = run(spec("independent"), 12_000);
  assert.ok(mean(mux.pageLog.map((p) => p.lat)) > mean(ind.pageLog.map((p) => p.lat)) + 40, `multiplex ${mean(mux.pageLog.map((p) => p.lat))} vs independent ${mean(ind.pageLog.map((p) => p.lat))}`);
  assert.ok(mean(mux.done.map((d) => d.lat)) > mean(ind.done.map((d) => d.lat)), "every answer waits behind a loss, not only the lost one");
});

test("stop-and-wait sends one per round trip; a window of eight sends eight", () => {
  const spec = (size: number) => scene([client("u", 150, "s", { window: { size }, timeoutMs: 1e9 }), server("s", { slots: 64, serviceMs: 6 })], { links: { "u>s": 25 }, timeoutMs: undefined });
  const one = average(spec(1), m("throughput"));
  const eight = average(spec(8), m("throughput"));
  assert.ok(Math.abs(one - 1000 / 56) < 3, `one in flight: ${one}/s ≈ 1 ÷ 56 ms`);
  assert.ok(eight > 7 * one, `eight in flight: ${eight}/s`);
  // A request waiting its turn isn't timed yet: the timer starts when it goes out.
  const backlog = run(scene([client("u", 40, "s", { window: { size: 1 }, timeoutMs: 500 }), server("s", { serviceMs: 6 })], { links: { "u>s": 25 }, timeoutMs: undefined }), 4000);
  assert.equal(value(backlog, m("errors")), 0);
});

test("a receiver that advertises its room never overflows: the sender waits instead of losing messages", () => {
  const spec = (advertise: boolean) =>
    scene(
      [client("u", 60, "s", { window: { size: 40 }, timeoutMs: 4000, retry: { mode: "now", max: 5 } }), server("s", { slots: 1, serviceMs: 25, queueMax: 20, advertise: advertise ? { high: 15, low: 5 } : undefined })],
      { links: { "u>s": 100 }, timeoutMs: undefined, windowMs: 1e9 },
    );
  const blind = run(spec(false), 6000);
  assert.ok(blind.fx.some((f) => f.kind === "drop" && f.node === "s"), "a full receiver drops what doesn't fit");
  const told = new Sim(spec(true));
  for (let t = 0; t < 6000; t += 10) {
    told.step(10);
    const u = told.nodes.get("u")!;
    assert.ok(u.flying <= 40, "never more in flight than the window");
  }
  assert.ok(!told.fx.some((f) => f.kind === "drop"), "nothing dropped");
  assert.ok(value(told, m("sendWait")) > 0, "the sender waits instead");
  assert.ok(told.reqs.length > 0 && told.nodes.get("u")!.peerWindow < 40, "it heard how much room there was");
});

test("AIMD: two senders on one narrow link grow their windows, halve on loss, and share it fairly", () => {
  const sender = (id: string, y: number): NodeSpec => ({ ...client(id, 600, "r", { window: { size: 1, max: 64, mode: "aimd" }, timeoutMs: 400, retry: { mode: "now", max: 8 } }, [0, y]) });
  const spec = scene([sender("a", 20), sender("b", 80), lb("r", ["s"]), server("s", { slots: 256, serviceMs: 2 })], {
    // The buffer holds about one round trip's worth, so halving both windows still keeps the link busy.
    links: { "a>r": 10, "b>r": 10, "r>s": { ms: 20, parallel: 8, buffer: 24 } },
    timeoutMs: undefined,
    windowMs: 1e9,
  });
  const sim = new Sim(spec);
  const seen: number[] = [];
  const ok = { a: 0, b: 0 };
  const record = sim.record.bind(sim);
  sim.record = (r, result) => {
    if (sim.t > 3000 && result === "ok") ok[r.client as "a" | "b"]++;
    record(r, result);
  };
  for (let t = 0; t < 10_000; t += 10) {
    sim.step(10);
    if (sim.t > 3000) seen.push(sim.nodes.get("a")!.cwnd);
  }
  assert.ok(Math.max(...seen) >= 2 * Math.min(...seen), `a sawtooth: ${Math.min(...seen)} to ${Math.max(...seen)}`);
  const goodput = (ok.a + ok.b) / 7;
  assert.ok(goodput > 0.8 * 400, `the link stays busy: ${goodput}/s of 400`);
  assert.ok(Math.abs(ok.a - ok.b) / (ok.a + ok.b) < 0.25, `fair shares: ${ok.a} vs ${ok.b}`);
  assert.ok(value(sim, m("lost")) > 0, "a full buffer drops, and that is the signal");
});

test("a layer 4 balancer pins each connection to one server, so busy users pile up; layer 7 spreads requests", () => {
  const spec = (layer: 4 | 7) =>
    scene([
      client("u", 120, "lb", { keys: 12, skew: 1.4 }),
      lb("lb", ["a", "b", "c"], { layer }),
      server("a", { slots: 2, serviceMs: 20 }),
      server("b", { slots: 2, serviceMs: 20 }),
      server("c", { slots: 2, serviceMs: 20 }),
    ]);
  const l4 = new Sim(spec(4));
  const where = new Map<number, Set<string>>();
  const send = l4.send.bind(l4);
  l4.send = (r: Req, to: string, ms?: number) => {
    if (r.stack[r.stack.length - 1].id === "lb" && r.dir === 1) where.set(r.key, (where.get(r.key) ?? new Set()).add(to));
    send(r, to, ms);
  };
  l4.step(5000);
  assert.ok([...where.values()].every((s) => s.size === 1), "each user's requests all went to one server");
  const peak = (sim: Sim) => value(sim, m("peak", { nodes: ["a", "b", "c"] }));
  assert.ok(peak(l4) > peak(run(spec(7), 5000)) + 0.15, "the server with the busiest users runs hotter");
});

test("at layer 4 a balancer can't route by path; an L7 gateway can, and parsing costs it a worker's time", () => {
  const spec = (layer: 4 | 7, serviceMs?: number) =>
    scene([
      client("u", 60, "gw", { tag: "pay", keys: 30 }),
      lb("gw", ["web"], { layer, byTag: { pay: ["pay"] }, serviceMs, slots: serviceMs ? 2 : undefined }),
      server("web", { serviceMs: 5 }),
      server("pay", { serviceMs: 5 }),
    ]);
  assert.equal(run(spec(4), 3000).nodes.get("pay")!.served, 0, "layer 4 sends everything to the general pool");
  const l7 = run(spec(7, 6), 3000);
  assert.ok(l7.nodes.get("pay")!.served > 100);
  assert.ok(value(l7, m("util", { nodes: ["gw"] })) > 0.05, "the gateway's workers are busy reading requests");
  assert.ok(value(l7, m("p50")) > value(run(spec(7), 3000), m("p50")) + 4, "and each request waits for it");
});

test("push: held connections get every news item within a round trip; polling mostly hears nothing new, late", () => {
  const push = scene(
    [
      client("users", 0, "gw", { keys: 200, subscribe: { holdMs: 1e9 } }),
      client("news", 5, "topic", { news: true, writes: 1 }, [0, 90]),
      { id: "topic", kind: "topic", label: "topic", at: [40, 90], to: ["gw"] },
      server("gw", { slots: 4, serviceMs: 2, hold: { max: 500 } }),
    ],
    { links: { "users>gw": 30, "news>topic": 5, "topic>gw": 5 }, windowMs: 2000 },
  );
  const p = run(push, 5000);
  assert.equal(value(p, m("connections", { nodes: ["gw"] })), 200);
  assert.ok(p.newsLog.length > 200 * 10, "every item reached every user");
  assert.ok(value(p, m("pushLag")) < 2 * 30 + 40, `news in about one trip: ${value(p, m("pushLag"))} ms`);
  assert.ok(value(p, m("reach", { nodes: ["users"] })) > 0.99);
  assert.ok(value(p, m("util", { nodes: ["gw"] })) < 0.2, "the server works once per item, not once per user");
  // Each user polls about once a second; news comes once every ten seconds.
  const poll = scene(
    [client("users", 200, "feed", { keys: 200 }), client("news", 0.1, "feed", { news: true, writes: 1 }, [0, 90]), server("feed", { slots: 4, serviceMs: 2, feed: true })],
    { links: { "users>feed": 30, "news>feed": 5 }, windowMs: 15_000 },
  );
  const q = run(poll, 20_000);
  assert.ok(value(q, m("empty")) > 0.9, `most polls hear nothing new (${value(q, m("empty"))})`);
  assert.ok(value(q, m("pushLag")) > 500, `news waits for the next poll: ${value(q, m("pushLag"))} ms`);
  assert.ok(value(q, m("util", { nodes: ["feed"] })) > 2 * value(p, m("util", { nodes: ["gw"] })), "and the server answers every poll");
});

test("a server holds only so many connections; long polls are opened again as each one ends", () => {
  const spec = (holdMs: number, max: number) =>
    scene([client("users", 0, "gw", { keys: 50, subscribe: { holdMs, reconnectMs: 300 } }), server("gw", { slots: 4, serviceMs: 2, hold: { max } })], { links: { "users>gw": 20 } });
  const capped = run(spec(1e9, 30), 3000);
  assert.equal(value(capped, m("connections", { nodes: ["gw"] })), 30, "the rest are turned away");
  assert.ok(capped.fx.some((f) => f.kind === "reject" && f.node === "gw"));
  const polls = new Sim(spec(400, 100));
  let low = Infinity;
  for (let t = 0; t < 4000; t += 50) {
    polls.step(50);
    if (polls.t > 1000) low = Math.min(low, value(polls, m("connections", { nodes: ["gw"] })));
  }
  assert.ok(low >= 30, `long polls reopen at once: at least ${low} of 50 open at any moment`);
});

test("when a push server crashes, its users reconnect: all at once, or spread over a random wait", () => {
  const spec = (reconnectMs: number) =>
    scene(
      [client("users", 0, "lb", { keys: 120, subscribe: { holdMs: 1e9, reconnectMs } }), lb("lb", ["a", "b"], { health: { everyMs: 50, failAfter: 1, passAfter: 1, timeoutMs: 100 } }), server("a", { hold: { max: 500 } }), server("b", { hold: { max: 500 } })],
      { links: { "users>lb": 20 } },
    );
  const burst = (reconnectMs: number) => {
    const sim = run(spec(reconnectMs), 2000);
    sim.setUp("a", false);
    let peak = 0;
    let before = sim.nodes.get("b")!.arrivals.count(sim.t);
    for (let t = 0; t < 1500; t += 10) {
      sim.step(10);
      const now = sim.nodes.get("b")!.arrivals.count(sim.t);
      peak = Math.max(peak, now - before);
      before = now;
    }
    assert.ok(value(sim, m("connections", { nodes: ["b"] })) > 110, "everyone ends up on the server that's left");
    return peak;
  };
  assert.ok(burst(0) > 3 * burst(1000), "with no wait, the reconnects arrive in one burst (a storm)");
});

test("heartbeats: a hung server's connections are noticed and moved; too eager a heartbeat raises false alarms", () => {
  const spec = (heartbeat?: { everyMs: number; missAfter: number; timeoutMs: number }, link = 20) =>
    scene(
      [
        client("users", 0, "lb", { keys: 60, subscribe: { holdMs: 1e9, reconnectMs: 100, heartbeat } }),
        client("news", 4, "topic", { news: true, writes: 1 }, [0, 90]),
        { id: "topic", kind: "topic", label: "topic", at: [40, 90], to: ["a", "b"] },
        lb("lb", ["a", "b"], { health: { everyMs: 50, failAfter: 2, passAfter: 2, timeoutMs: 100 } }),
        server("a", { hold: { max: 500 }, downMode: "hang" }),
        server("b", { hold: { max: 500 }, downMode: "hang" }),
      ],
      { links: { "users>lb": link, "lb>a": 10, "lb>b": 10 }, windowMs: 2000 },
    );
  const hang = (heartbeat?: { everyMs: number; missAfter: number; timeoutMs: number }) => {
    const sim = run(spec(heartbeat), 2000);
    sim.setUp("a", false);
    sim.step(4000);
    return sim;
  };
  const silent = hang();
  assert.ok(value(silent, m("reach", { nodes: ["users"] })) < 0.7, `without heartbeats, a's users never hear again (${value(silent, m("reach", { nodes: ["users"] }))})`);
  const beating = hang({ everyMs: 100, missAfter: 2, timeoutMs: 150 });
  assert.ok(value(beating, m("reach", { nodes: ["users"] })) > 0.99);
  assert.ok(beating.detects.length > 20 && Math.max(...beating.detects.map((d) => d.ms)) <= 450, `noticed within 450 ms: ${Math.max(...beating.detects.map((d) => d.ms))}`);
  const eager = run(spec({ everyMs: 20, missAfter: 1, timeoutMs: 10 }, 15), 3000);
  assert.ok(eager.falseAlarms.count(eager.t) > 0, "a ping slower than its timeout looks like death");
});

test("failover: a replica is promoted once health checks bench the primary; async loses acknowledged writes, sync doesn't", () => {
  const spec = (replication: "async" | "sync") =>
    scene(
      [
        client("u", 80, "w", { writes: 1, keys: 400, timeoutMs: 1500 }),
        lb("w", ["p", "r1", "r2"], { promote: true, health: { everyMs: 50, failAfter: 3, passAfter: 2, timeoutMs: 100 } }),
        db("p", { replication }),
        db("r1", { replicaOf: "p", lagMs: 150 }),
        db("r2", { replicaOf: "p", lagMs: 150 }),
      ],
      { windowMs: 1e9, links: { "w>p": 10, "w>r1": 10, "w>r2": 10 } },
    );
  const crash = (replication: "async" | "sync") => {
    const sim = run(spec(replication), 2000);
    sim.setUp("p", false);
    sim.step(3000);
    return sim;
  };
  const a = crash("async");
  assert.equal(a.nodes.get("w")!.primary, "r1", "the first healthy replica took over");
  assert.ok(a.notes.some((n) => n.text.includes("promoted")));
  assert.ok(value(a, m("lostAcked")) > 3, `writes acknowledged but never copied are lost (${value(a, m("lostAcked"))})`);
  const late = a.done.filter((d) => d.t > 4000);
  assert.ok(late.length > 50 && late.every((d) => d.result === "ok"), "writes succeed again on the new primary");
  assert.equal(a.replicaOf(a.nodes.get("r2")!), "r1", "the other replica copies from the new primary");
  const s = crash("sync");
  assert.equal(value(s, m("lostAcked")), 0);
  assert.ok(value(run(spec("sync"), 2000), m("p50")) > value(run(spec("async"), 2000), m("p50")) + 140, "but every write waits for its copies (150 ms away)");
});

test("a link's buffer: past it, crossings are dropped where they would have waited", () => {
  const spec = (buffer?: number) => scene([client("u", 300, "s", { timeoutMs: 1e9 }), server("s", { slots: 64, serviceMs: 1 })], { links: { "u>s": { ms: 20, parallel: 2, buffer } }, timeoutMs: undefined });
  assert.equal(value(run(spec(), 3000), m("lost")), 0);
  assert.ok(value(run(spec(4), 3000), m("lost")) > 0.3);
});

test("a cache warmed before it serves comes back hitting; a cold one comes back missing", () => {
  const spec = (prewarm?: number) =>
    scene([client("u", 200, "c", { keys: 500, skew: 1 }), { id: "c", kind: "cache", label: "c", at: [50, 50], to: ["db"], capacity: 200, prewarm }, db("db", { slots: 64, serviceMs: 5 })], { windowMs: 300 });
  const restart = (prewarm?: number) => {
    const sim = run(spec(prewarm), 3000);
    sim.setUp("c", false);
    sim.step(50);
    sim.setUp("c", true);
    sim.step(300);
    return value(sim, m("hit", { nodes: ["c"] }));
  };
  assert.ok(restart(150) > restart() + 0.3, `${restart(150)} warm vs ${restart()} cold`);
});

test("property: every request is accounted for and nothing leaks, with every connection-and-real-time hook at once", () => {
  settles(
    scene(
      [
        { ...client("web", (t: number) => (t < 5000 ? 40 : 0), "lb", { page: 3, timeoutMs: 1200, retry: { mode: "backoff", max: 2, baseMs: 50 } }, [0, 20]), connect: { handshakeRtts: 2, keepAliveMs: 300, max: 2, streams: "multiplex", rtoMs: 150 } },
        client("bulk", (t: number) => (t < 5000 ? 80 : 0), "lb", { window: { size: 2, max: 16, mode: "aimd" }, timeoutMs: 900, retry: { mode: "now", max: 2 } }, [0, 50]),
        client("users", 0, "lb", { keys: 30, subscribe: { holdMs: 600, reconnectMs: 200, heartbeat: { everyMs: 100, missAfter: 2, timeoutMs: 150 } } }, [0, 80]),
        client("news", (t: number) => (t < 5000 ? 5 : 0), "topic", { news: true, writes: 1 }, [0, 95]),
        { id: "topic", kind: "topic", label: "topic", at: [40, 95], to: ["a", "b"] },
        lb("lb", ["a", "b"], { layer: 4, health: { everyMs: 50, failAfter: 2, passAfter: 2, timeoutMs: 100 } }),
        server("a", { slots: 6, serviceMs: 8, hold: { max: 20 }, to: ["w"], blocking: true, callTimeoutMs: 400, connect: { handshakeRtts: 1, keepAliveMs: 1e9, max: 3, waitMs: 300 }, advertise: { high: 10, low: 3 }, queueMax: 30 }),
        server("b", { slots: 6, serviceMs: 8, hold: { max: 20 }, to: ["w"], downMode: "hang" }),
        lb("w", ["p", "r"], { promote: true, health: { everyMs: 50, failAfter: 2, passAfter: 2, timeoutMs: 100 } }),
        db("p", { replication: "sync", maxConns: 4 }),
        db("r", { replicaOf: "p", lagMs: 30 }),
      ],
      {
        links: { "web>lb": { ms: 20, loss: 0.05 }, "bulk>lb": { ms: 15, parallel: 6, buffer: 4 }, "lb>a": 10, "lb>b": 10, "w>p": 10, "w>r": 10 },
        windowMs: 1e9,
        script: {
          loopMs: 1e9,
          events: [
            { at: 1500, label: "b hangs", run: (s: Sim) => s.setUp("b", false) },
            { at: 2500, label: "b is back", run: (s: Sim) => s.setUp("b", true) },
            { at: 3000, label: "p crashes", run: (s: Sim) => s.setUp("p", false) },
          ],
        },
      },
    ),
    "batch 2b",
  );
});

test("polling: each user asks once per interval, on its own schedule, and the polls are not arrivals", () => {
  const spec = scene([client("users", 0, "feed", { keys: 50, poll: 500 }), client("news", 2, "feed", { news: true, writes: 1 }, [0, 90]), server("feed", { slots: 8, serviceMs: 2, feed: true })], {
    links: { "users>feed": 20, "news>feed": 5 },
    windowMs: 1e9,
  });
  const sim = new Sim(spec, { trace: true });
  sim.step(5000);
  const polls = sim.done.filter((d) => d.op === "read").length;
  assert.ok(Math.abs(polls - 50 * (5000 / 500)) < 60, `about ${50 * 10} polls: ${polls}`);
  assert.ok(sim.trace.every((s) => s.client === "news"), "only the news desk's items are traffic");
  assert.ok(value(sim, m("pushLag")) < 600, "news waits at most one interval, and a trip");
});

test("taking a connection in costs a worker: a reconnect storm swamps the server that is left", () => {
  const spec = (serviceMs: number) =>
    scene(
      [client("users", 0, "lb", { keys: 120, subscribe: { holdMs: 1e9, reconnectMs: 0 } }), lb("lb", ["a", "b"], { health: { everyMs: 50, failAfter: 1, passAfter: 1, timeoutMs: 100 } }), server("a", { hold: { max: 500 }, serviceMs }), server("b", { hold: { max: 500 }, serviceMs })],
      { links: { "users>lb": 20, "lb>a": 5, "lb>b": 5 } },
    );
  // Connections server b holds 300 ms after a crash sends a's sixty users to it at once.
  const storm = (serviceMs: number) => {
    const sim = run(spec(serviceMs), 3000);
    sim.setUp("a", false);
    sim.step(300);
    return value(sim, m("connections", { nodes: ["b"] }));
  };
  assert.ok(storm(40) < 100, `taken in one worker at a time, 40 ms each, they wait their turn (${storm(40)} back)`);
  assert.ok(storm(1) >= 115, "taken in cheaply, they are all back at once");
});

test("a client that switches between polling and held connections keeps up the new way, and closes what it no longer uses", () => {
  const spec = (push: boolean, heartbeat?: { everyMs: number; missAfter: number; timeoutMs: number }) =>
    scene(
      [
        client("users", 0, "gw", push ? { keys: 30, subscribe: { holdMs: 1e9, reconnectMs: 100, heartbeat } } : { keys: 30, poll: 250 }),
        client("news", 4, "gw", { news: true, writes: 1 }, [0, 90]),
        server("gw", { slots: 8, serviceMs: 2, hold: { max: 100 }, feed: true, downMode: "hang" }),
      ],
      { links: { "users>gw": 20, "news>gw": 5 }, windowMs: 2000 },
    );
  const sim = run(spec(false), 2000);
  assert.ok(value(sim, m("empty")) > 0, "polling");
  sim.reconfigure(spec(true));
  sim.step(1500);
  assert.equal(value(sim, m("connections", { nodes: ["gw"] })), 30, "every user now holds a connection");
  // Heartbeats switched on with connections already open start with them: a freeze is noticed.
  sim.reconfigure(spec(true, { everyMs: 100, missAfter: 2, timeoutMs: 100 }));
  sim.setUp("gw", false);
  sim.step(600);
  assert.ok(sim.detects.length > 20, `noticed ${sim.detects.length} silent connections`);
  sim.setUp("gw", true);
  sim.reconfigure(spec(false));
  sim.step(1500);
  assert.equal(value(sim, m("connections", { nodes: ["gw"] })), 0, "back to polling: no connection held");
  assert.ok(value(sim, m("missed", { nodes: ["users"] })) < 0.05, "and users still hear the news");
  assert.deepEqual(leakedHolds(sim), []);
});

test("a script's loop plays its events in order of time, whatever order they are listed in", () => {
  const order: string[] = [];
  const spec = scene([client("u", 5, "s"), server("s")], {
    script: { loopMs: 1000, events: ["late", "early"].map((label) => ({ at: label === "late" ? 700 : 200, label, run: () => void order.push(label) })) },
  });
  run(spec, 2100);
  assert.deepEqual(order, ["early", "late", "early", "late"]);
});

test("missed is the share of users who hadn't had each news item a second after it was published", () => {
  const sim = run(
    scene([client("users", 0, "gw", { keys: 40, subscribe: { holdMs: 1e9 } }), client("news", 4, "gw", { news: true, writes: 1 }, [0, 90]), server("gw", { slots: 8, serviceMs: 2, hold: { max: 30 } })], {
      links: { "users>gw": 20, "news>gw": 5 },
      windowMs: 2000,
    }),
    4000,
  );
  // Ten users never got a connection.
  assert.ok(Math.abs(value(sim, m("missed", { nodes: ["users"] })) - 10 / 40) < 0.03);
  assert.ok(Math.abs(value(sim, m("missed", { nodes: ["users"] })) + value(sim, m("reach", { nodes: ["users"] })) - 1) < 1e-9);
});
