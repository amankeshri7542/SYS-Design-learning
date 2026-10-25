import assert from "node:assert/strict";
import { test } from "node:test";
import { Sim, ownerOf } from "../src/lib/sim/engine";
import { measure } from "../src/lib/sim/metrics";
import type { NodeSpec, SceneSpec } from "../src/lib/sim/types";

const scene = (nodes: NodeSpec[], extra: Partial<SceneSpec> = {}): SceneSpec => ({ nodes, sloMs: 400, timeoutMs: 1600, seed: 3, ...extra });
const client = (id: string, rate: number, to: string, extra: Partial<NodeSpec["client"]> = {}): NodeSpec => ({
  id,
  kind: "client",
  label: id,
  at: [0, 50],
  client: { rate, keys: 50, ...extra },
  to: [to],
});
const server = (id: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ id, kind: "server", label: id, at: [50, 50], slots: 4, serviceMs: 50, ...extra });

const run = (spec: SceneSpec, ms: number) => {
  const sim = new Sim(spec);
  sim.step(ms);
  return sim;
};

test("same scene and seed produce the same run", () => {
  const spec = scene([client("u", 40, "s"), server("s")]);
  const a = run(spec, 3000);
  const b = run(spec, 3000);
  assert.deepEqual(a.done, b.done);
  assert.ok(a.done.length > 50);
});

test("a server below capacity answers everything; above capacity it queues and times out", () => {
  const calm = run(scene([client("u", 30, "s"), server("s")]), 4000);
  assert.equal(measure(calm, { id: "errors", label: "" }), 0);
  const swamped = run(scene([client("u", 200, "s"), server("s")]), 6000);
  assert.ok(swamped.nodes.get("s")!.queue.length > 50, "a long queue forms");
  assert.ok((measure(swamped, { id: "errors", label: "" }) ?? 0) > 0.5, "most requests time out");
});

test("every logical request is accounted for: answered, failed, or still in flight", () => {
  const sim = run(scene([client("u", 60, "s"), server("s", { queueMax: 5 })], { windowMs: 1e9 }), 2000);
  const live = sim.reqs.filter((r) => r.phase !== "gone" && !r.abandoned && !r.detached && r.op !== "probe").length;
  assert.equal(sim.done.length + live, sim.logical.count(sim.t));
});

test("a cache answers repeat reads and spares the database", () => {
  const build = (capacity: number) =>
    scene([
      client("u", 50, "app", { keys: 20, skew: 1 }),
      server("app", { to: ["c"], slots: 16, serviceMs: 5 }),
      { id: "c", kind: "cache", label: "c", at: [70, 50], to: ["db"], capacity },
      { id: "db", kind: "db", label: "db", at: [90, 50], slots: 4, serviceMs: 60 },
    ]);
  const cold = run(build(0), 3000);
  const warm = run(build(20), 3000);
  assert.equal(measure(cold, { id: "hit", label: "", nodes: ["c"] }), 0);
  assert.ok((measure(warm, { id: "hit", label: "", nodes: ["c"] }) ?? 0) > 0.8);
  assert.ok(warm.nodes.get("db")!.served < cold.nodes.get("db")!.served / 3);
});

test("health checks take a dead server out of rotation", () => {
  const build = (checks: boolean) =>
    scene([
      client("u", 40, "lb"),
      {
        id: "lb",
        kind: "lb",
        label: "lb",
        at: [30, 50],
        to: ["a", "b"],
        algo: "round-robin",
        health: checks ? { everyMs: 50, failAfter: 2, passAfter: 2, timeoutMs: 100 } : undefined,
      },
      server("a"),
      server("b"),
    ]);
  for (const checks of [false, true]) {
    const sim = new Sim(build(checks));
    sim.step(500);
    sim.setUp("b", false);
    sim.step(1500);
    const errors = measure(sim, { id: "errors", label: "" }) ?? 0;
    if (checks) assert.equal(errors, 0, "no errors once the dead server is benched");
    else assert.ok(errors > 0.3, "half the traffic keeps failing");
  }
});

test("the circuit breaker opens, fails fast, then closes when the dependency recovers", () => {
  const sim = new Sim(
    scene([
      client("u", 30, "s", { writes: 1 }),
      server("s", { slots: 8, calls: { write: ["dep"] }, blocking: true, callTimeoutMs: 300, breaker: { threshold: 3, cooldownMs: 400 } }),
      { ...server("dep"), at: [90, 50], downMode: "hang" },
    ]),
  );
  sim.step(500);
  sim.setUp("dep", false);
  sim.step(1200);
  assert.equal(sim.nodes.get("s")!.breaker.state === "closed", false, "breaker tripped");
  assert.ok((measure(sim, { id: "fallback", label: "" }) ?? 0) > 0.5, "most calls fail fast");
  sim.setUp("dep", true);
  sim.step(1500);
  assert.equal(sim.nodes.get("s")!.breaker.state, "closed");
});

test("a per-client rate limiter only turns away the greedy client", () => {
  const sim = run(
    scene([
      client("user", 10, "lim", { tag: "user" }),
      client("bot", 60, "lim", { tag: "bot" }),
      { id: "lim", kind: "limiter", label: "lim", at: [30, 50], limit: { rps: 15, burst: 5 }, to: ["s"] },
      server("s", { slots: 8 }),
    ]),
    3000,
  );
  assert.equal(measure(sim, { id: "rejected", label: "", tag: "user" }), 0);
  assert.ok((measure(sim, { id: "rejected", label: "", tag: "bot" }) ?? 0) > 0.6);
});

test("a shared rate limiter lets in its rate for everyone together", () => {
  const build = (shared: boolean) =>
    scene([
      client("a", 20, "lim", { tag: "a" }),
      client("b", 20, "lim", { tag: "b" }),
      { id: "lim", kind: "limiter", label: "lim", at: [30, 50], limit: { rps: 20, burst: 5, shared }, to: ["s"] },
      server("s", { slots: 8 }),
    ]);
  const turned = (shared: boolean) => measure(run(build(shared), 3000), { id: "rejected", label: "" }) ?? 0;
  assert.ok(turned(false) < 0.05, "each client keeps under its own 20/s");
  assert.ok(turned(true) > 0.35, "together they pass the shared 20/s");
});

test("a retry budget caps the load multiplier", () => {
  const build = (budget?: number) =>
    scene([client("u", 60, "s", { timeoutMs: 200, retry: { mode: "now", max: 3, budget } }), server("s", { slots: 2, serviceMs: 60 })]);
  const free = run(build(), 3000);
  const capped = run(build(0.1), 3000);
  assert.ok((measure(free, { id: "amplify", label: "" }) ?? 0) > 2);
  assert.ok((measure(capped, { id: "amplify", label: "" }) ?? 0) <= 1.15);
});

test("a partition: consistent followers refuse, available ones answer stale and conflict", () => {
  const build = (mode: "cp" | "ap") =>
    scene([
      client("us", 20, "A", { tag: "us", writes: 0.4, keys: 5 }),
      client("eu", 20, "B", { tag: "eu", writes: 0.4, keys: 5 }),
      { id: "A", kind: "db", label: "A", at: [80, 20], slots: 4, serviceMs: 20, region: "us", peer: "B", lagMs: 50 },
      {
        id: "B",
        kind: "db",
        label: "B",
        at: [80, 80],
        slots: 4,
        serviceMs: 20,
        region: "eu",
        lagMs: 50,
        leader: mode === "cp" ? "A" : undefined,
        peer: mode === "ap" ? "A" : undefined,
      },
    ]);
  for (const mode of ["cp", "ap"] as const) {
    const sim = new Sim(build(mode));
    sim.step(800);
    sim.setPartition(true);
    sim.step(1200);
    const answered = measure(sim, { id: "answered", label: "", tag: "eu" }) ?? 0;
    const stale = measure(sim, { id: "stale", label: "", tag: "eu" }) ?? 0;
    sim.setPartition(false);
    if (mode === "cp") {
      assert.equal(answered, 0);
      assert.equal(sim.conflicts, 0);
    } else {
      assert.equal(answered, 1);
      assert.ok(stale > 0.1);
      assert.ok(sim.conflicts > 0);
    }
  }
});

test("a hash ring moves about 1/(n+1) of keys when a node joins; modulo moves most of them", () => {
  const keys = Array.from({ length: 2000 }, (_, k) => k);
  const moved = (algo: "hash" | "ring") =>
    keys.filter((k) => ownerOf(k, ["a", "b", "c"], algo) !== ownerOf(k, ["a", "b", "c", "d"], algo)).length / keys.length;
  assert.ok(moved("hash") > 0.65);
  assert.ok(moved("ring") < 0.35);
});

test("the autoscaler adds servers under load and drains them when it's quiet", () => {
  let rate = 120;
  const pool = ["s1", "s2", "s3", "s4", "s5"];
  const sim = new Sim(
    scene([
      { ...client("u", 0, "lb"), client: { rate: () => rate, keys: 50 } },
      { id: "lb", kind: "lb", label: "lb", at: [30, 50], to: pool, autoscale: { min: 1, max: 5, target: 0.6, everyMs: 100, warmupMs: 200 } },
      ...pool.map((id) => server(id, { slots: 3, serviceMs: 50 })),
    ]),
  );
  const running = () => pool.filter((id) => sim.nodes.get(id)!.on).length;
  assert.equal(running(), 1);
  sim.step(3000);
  assert.ok(running() >= 4, `scaled out to ${running()}`);
  rate = 5;
  sim.step(4000);
  assert.ok(running() <= 2, `scaled in to ${running()}`);
});

test("removing a node mid-flight fails its requests instead of leaking workers", () => {
  const base = [client("u", 80, "app"), server("app", { slots: 6, blocking: true, to: ["c"] })];
  const withCache = scene([...base, { id: "c", kind: "cache", label: "c", at: [70, 50], to: ["db"], capacity: 10 }, { id: "db", kind: "db", label: "db", at: [90, 50], slots: 2, serviceMs: 80 }]);
  const sim = new Sim(withCache);
  sim.step(600);
  sim.reconfigure(scene([...base.slice(0, 1), server("app", { slots: 6, blocking: true, to: ["db"] }), { id: "db", kind: "db", label: "db", at: [90, 50], slots: 2, serviceMs: 80 }]));
  sim.step(3000);
  const app = sim.nodes.get("app")!;
  assert.ok(app.held.length <= 6);
  assert.ok(app.held.every((r) => r.phase !== "gone"), "no worker is held by a request that no longer exists");
});

test("the trace is off by default and, when on, records first attempts only", () => {
  const spec = scene([client("u", 60, "s", { timeoutMs: 150, retry: { mode: "now", max: 2 } }), server("s", { slots: 1, serviceMs: 100 })]);
  assert.equal(run(spec, 2000).trace.length, 0);
  const sim = new Sim(spec, { trace: true });
  sim.step(2000);
  assert.ok(sim.retries.count(sim.t) > 0, "the overloaded server makes clients retry");
  const t = sim.trace;
  assert.ok(t.length > 60);
  assert.ok(t.every((s, i) => s.client === "u" && (i === 0 || s.t >= t[i - 1].t)));
  assert.deepEqual(new Sim(spec, { trace: true }).trace, [], "nothing is recorded before the first step");
});

test("arrivals do not depend on what happens downstream", () => {
  const traced = (spec: SceneSpec) => {
    const sim = new Sim(spec, { trace: true });
    sim.step(3000);
    return sim.trace;
  };
  const fast = traced(scene([client("u", 50, "s"), server("s", { slots: 8, serviceMs: 20 })]));
  const swamped = traced(scene([client("u", 50, "s", { retry: { mode: "now", max: 3 } }), server("s", { slots: 1, serviceMs: 400, queueMax: 2 })]));
  assert.deepEqual(swamped, fast);
});
