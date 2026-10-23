import assert from "node:assert/strict";
import { test } from "node:test";
import { getLesson } from "../src/lib/lessons";
import { defaultsOf } from "../src/lib/lessons/types";
import { Sim } from "../src/lib/sim/engine";
import { flowOf, measure } from "../src/lib/sim/metrics";
import type { FxKind, NodeSpec, SceneSpec } from "../src/lib/sim/types";

// What the stage draws comes from the engine's output: effects (`fx`) and per-link traffic (`links`). These tests check
// that output fires when it should, and that it is only output: reading or clearing it never changes a run.

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

/** Step a scene in 10 ms slices, collecting every effect as it appears (the way the stage reads them). */
function watch(spec: SceneSpec, ms: number, each?: (sim: Sim) => void) {
  const sim = new Sim(spec);
  const seen: { t: number; kind: FxKind; node: string; slot?: number }[] = [];
  let last = -1;
  for (let t = 0; t < ms; t += 10) {
    sim.step(10);
    for (const f of sim.fx) if (f.t > last) seen.push(f);
    if (sim.fx.length) last = sim.fx[sim.fx.length - 1].t;
    each?.(sim);
  }
  return { sim, seen };
}

const figure = (slug: string, i: number) => {
  const f = getLesson(slug)!.figures[i];
  return f.build(defaultsOf(f));
};

test("effects and link counts are output only: clearing them as the stage reads never changes a run", () => {
  for (const spec of [figure("caching", 1), figure("circuit-breakers", 1), figure("rate-limiting", 1)]) {
    const left = new Sim(spec);
    const right = new Sim(spec);
    // The breaker's fault is armed: fire it where its script says, in both runs, as a learner would.
    const fault = spec.script?.events.find((e) => e.armed);
    for (let t = 0; t < 4000; t += 10) {
      if (fault && t === fault.at) for (const s of [left, right]) s.fire(fault.label);
      left.step(10);
      right.step(10);
      right.fx.length = 0;
      right.links.clear();
    }
    assert.deepEqual(right.done, left.done);
    assert.ok(left.done.length > 50);
  }
});

test("C1: misses fill the cache and a full cache evicts, so the stage can show both", () => {
  const { seen } = watch(figure("caching", 1), 4000);
  const at = (kind: FxKind) => seen.filter((f) => f.kind === kind && f.node === "cache").length;
  assert.ok(at("fill") > 20, `fills: ${at("fill")}`);
  assert.ok(at("evict") > 5, `evictions: ${at("evict")}`);
  // Never more evictions than fills: something has to come in for something to be pushed out.
  assert.ok(at("evict") <= at("fill"));
});

test("a drop at a full waiting line carries the line's tail slot; other drops carry none", () => {
  const { seen } = watch(scene([client("u", 300, "s"), server("s", { queueMax: 12 })]), 2500);
  const drops = seen.filter((f) => f.kind === "drop");
  assert.ok(drops.length > 10);
  assert.ok(drops.every((f) => f.slot === 12));
  const down = watch(scene([client("u", 40, "s"), server("s")]), 800, (sim) => sim.t === 300 && sim.setUp("s", false));
  assert.ok(down.seen.some((f) => f.kind === "drop" && f.slot === undefined));
});

test("running hot is entered once, not every tick: one ring per rise of the line", () => {
  const { sim, seen } = watch(scene([client("u", 120, "s"), server("s", { serviceMs: 60 })]), 3000);
  const hot = seen.filter((f) => f.kind === "hot");
  assert.ok(sim.nodes.get("s")!.hot, "the swamped server is hot");
  assert.equal(hot.length, 1, "it entered the state once");
  const calm = watch(scene([client("u", 20, "s"), server("s")]), 3000);
  assert.equal(calm.seen.filter((f) => f.kind === "hot").length, 0);
});

test("R2: the breaker goes closed → open → testing → closed, its trial is named, and the payments rail empties while open", () => {
  const spec = scene([
    client("u", 30, "s", { writes: 1 }),
    server("s", { slots: 8, calls: { write: ["dep"] }, blocking: true, callTimeoutMs: 300, breaker: { threshold: 3, cooldownMs: 400 } }),
    { ...server("dep"), at: [90, 50], downMode: "hang" },
  ]);
  const states: string[] = [];
  let trial = 0;
  // Requests sent along the payments rail while the breaker was open (the half-open trial comes after it).
  let crossedWhileOpen = 0;
  let sentBefore = 0;
  const { sim } = watch(spec, 4000, (s) => {
    if (s.t === 500) s.setUp("dep", false);
    if (s.t === 2300) s.setUp("dep", true);
    const b = s.nodes.get("s")!.breaker;
    const sent = s.links.get("dep~s")?.sent ?? 0;
    if (b.state === "open" && states.at(-1) === "open") crossedWhileOpen += sent - sentBefore;
    sentBefore = sent;
    if (states.at(-1) !== b.state) states.push(b.state);
    if (b.state === "half" && b.trialId) trial = b.trialId;
  });
  // Only the state machine's own moves: closed → open, open → testing, testing → open or closed.
  const legal = new Set(["closed>open", "open>half", "half>open", "half>closed"]);
  const moves = states.slice(1).map((st, i) => `${states[i]}>${st}`);
  assert.ok(moves.every((m) => legal.has(m)), states.join(" → "));
  assert.equal(states[0], "closed");
  assert.ok(states.includes("half"));
  assert.equal(states.at(-1), "closed", `ends closed: ${states.join(" → ")}`);
  assert.ok(trial > 0, "the half-open trial request is named");
  assert.equal(crossedWhileOpen, 0, "nothing crosses the payments rail while the breaker is open");
  assert.ok(flowOf(sim, "s", "dep").rate > 10, "traffic returns once it closes");
});

test("D3: when cache 4 joins under hash % N the hit rate dips and the database's rail brightens; a ring barely stirs", () => {
  // Cache 4 joins when the learner adds it (an armed event). Let the caches warm first, then add it.
  const join = (i: number) => {
    const sim = new Sim(figure("consistent-hashing", i));
    const toDb = () => [...sim.links].filter(([key]) => key.split("~").includes("db")).reduce((sum, [, l]) => sum + l.sent, 0);
    const hits = () => measure(sim, { id: "hit", label: "", nodes: ["c1", "c2", "c3", "c4"] }) ?? 0;
    sim.step(5200);
    const a = toDb();
    sim.step(800);
    const before = { db: toDb() - a, hits: hits() };
    sim.fire("Cache 4 joins");
    const b = toDb();
    sim.step(800);
    return { before, after: { db: toDb() - b, hits: hits() } };
  };
  const mod = join(0);
  const ring = join(1);
  assert.ok(mod.after.hits < mod.before.hits - 0.08, `hash % N hits ${mod.before.hits.toFixed(2)} → ${mod.after.hits.toFixed(2)}`);
  assert.ok(mod.after.db > mod.before.db * 1.4, `hash % N database requests per 800 ms: ${mod.before.db} → ${mod.after.db}`);
  assert.ok(mod.after.db - mod.before.db > 2 * (ring.after.db - ring.before.db), `the ring's rise (${ring.before.db} → ${ring.after.db}) is far smaller`);
});

test("link traffic counts requests both ways round and the failures that come back", () => {
  const sim = new Sim(scene([client("u", 50, "s"), server("s")]));
  sim.step(2000);
  const f = flowOf(sim, "s", "u");
  assert.ok(Math.abs(f.rate - 50) < 15, `about 50/s: ${f.rate.toFixed(1)}`);
  assert.equal(f.errors, 0);
  sim.setUp("s", false);
  sim.step(1000);
  assert.ok(flowOf(sim, "u", "s").errors > 0.8, "a dead server's rail is all failures");
});
