import { test } from "node:test";
import assert from "node:assert/strict";
import { concepts } from "../src/lib/catalog";
import { lessons, getLesson } from "../src/lib/lessons";
import {
  runExperiment,
  makeConfig,
  validateConfig,
  experimentQuery,
  restoreExperiment,
} from "../src/lib/engine";
import { ring, owner } from "../src/lib/engine/data";
import {
  parseProgress,
  readProgress,
  mergeCloud,
  emptyProgress,
  LEGACY_KEY,
  PROGRESS_KEY,
} from "../src/lib/progress";
import { journeyTrace, journeyNodes } from "../src/lib/journey";

for (const concept of concepts)
  test(`lesson ${concept.id}: controls, scenarios, valid state, deterministic replay`, () => {
    const lesson = getLesson(concept.id),
      base = makeConfig(concept.id),
      run = runExperiment(base);
    assert.equal(lessons.length, 56);
    assert.ok(lesson.code.includes("\n"));
    assert.ok(lesson.reference.startsWith("https://"));
    assert.ok(lesson.challenge.options[lesson.challenge.answer]);
    assert.deepEqual(run, runExperiment(base));
    assert.deepEqual(restoreExperiment(experimentQuery(base)), base);
    assert.ok(run.frames.length > 10);
    assert.equal(run.frames[0].world.time, 0);
    const variants = [
      makeConfig(concept.id, true),
      ...lesson.controls.flatMap((control) =>
        [control.min, control.max].map((value) => ({
          ...base,
          values: { ...base.values, [control.key]: value },
        })),
      ),
      ...(lesson.fault
        ? [
            {
              ...base,
              faults: [
                { at: 4, active: true },
                { at: 12, active: false },
              ],
            },
          ]
        : []),
    ];
    const contrast = runExperiment(variants[0]);
    assert.notDeepEqual(
      contrast.frames,
      run.frames,
      `${concept.id} contrast must affect domain events or state`,
    );
    for (const trial of [run, ...variants.map(runExperiment)])
      for (const [i, frame] of trial.frames.entries()) {
        assert.equal(frame.event.id, i);
        assert.equal(frame.event.time, frame.world.time);
        if (i) assert.ok(frame.event.time >= trial.frames[i - 1].event.time);
        assert.ok(
          frame.metrics.every((m) => Number.isFinite(m.value) && m.value >= 0),
          `${concept.id} finite metrics`,
        );
        assert.ok(
          frame.event.path.every((id) =>
            frame.world.nodes.some((n) => n.id === id),
          ),
          `${concept.id}: invalid path ${frame.event.path}`,
        );
        if (lesson.family === "queue") {
          const count = frame.world.counters;
          // Every accepted delivery has exactly one lifecycle state at every observable event.
          assert.equal(
            count.accepted || 0,
            (count.completed || 0) + (count.pending || 0) + (count.dead || 0),
            `${concept.id} event ${i} accounting`,
          );
          assert.equal(
            count.pending || 0,
            frame.world.entities.filter((e) =>
              ["ready", "in flight"].includes(e.state),
            ).length,
          );
        }
      }
  });
test("cache TTL boundary, actual eviction, and single-flight behavior", () => {
  const config = makeConfig("ttl");
  config.values.ttl = 1;
  const run = runExperiment(config);
  for (const f of run.frames)
    if (f.event.type === "hit") {
      const entry = f.world.entities.find((e) => e.id === f.event.entity)!;
      assert.ok(entry.expires! > f.world.time);
    }
  assert.ok(run.frames.some((f) => f.event.type === "expire"));
  const eviction = runExperiment(makeConfig("eviction", true));
  assert.ok(eviction.frames.some((f) => f.event.type === "evict"));
  for (const frame of eviction.frames)
    assert.ok(frame.world.entities.length <= 1);
  const protectedRun = runExperiment(makeConfig("stampede")),
    unprotected = runExperiment(makeConfig("stampede", true));
  assert.ok(
    protectedRun.frames.at(-1)!.world.counters.origin <
      unprotected.frames.at(-1)!.world.counters.origin,
  );
});
test("queue capacity uses the same accounting as accepted and completed counts", () => {
  const run = runExperiment(makeConfig("backpressure", true));
  for (const f of run.frames) assert.ok((f.world.counters.pending || 0) <= 4);
  assert.ok(run.frames.at(-1)!.world.counters.rejected > 0);
  const at = run.frames.find((f) => f.event.type === "enqueue")!;
  assert.ok(at.world.counters.accepted > (at.world.counters.completed || 0));
});
test("DLQ requires failed receives, isolates poison, and redrives only after repair", () => {
  const run = runExperiment(makeConfig("dead-letter"));
  const dead = run.frames.find((f) => f.event.type === "dead-letter")!;
  assert.ok(dead);
  assert.equal(
    dead.world.entities.find((e) => e.state === "dead letter")!.attempts,
    3,
  );
  assert.ok(run.frames.some((f) => f.event.type === "redrive"));
  const last = run.frames.at(-1)!.world.counters;
  assert.equal(last.dead, 0);
  assert.equal(last.accepted, last.completed);
});
test("idempotency, FIFO groups, and retained stream records are distinct", () => {
  const idempotent = runExperiment(makeConfig("idempotency")).frames.at(-1)!
    .world.counters;
  assert.equal(idempotent.effects, 8);
  assert.ok(idempotent.completed > idempotent.effects);
  const fifo = runExperiment(makeConfig("ordering"));
  for (const frame of fifo.frames) {
    const active = frame.world.entities.filter((e) => e.state === "in flight");
    assert.equal(new Set(active.map((e) => e.group)).size, active.length);
  }
  const stream = runExperiment(makeConfig("event-streams")).frames.at(
    -1,
  )!.world;
  assert.equal(stream.entities.length, stream.counters.accepted);
  assert.ok(stream.counters.replayed > 0);
});
test("circuit breaker transitions through half-open on both failed and successful probes", () => {
  const run = runExperiment(makeConfig("circuit-breaker"));
  const types = run.frames.map((f) => f.event.type);
  assert.ok(types.includes("open"));
  assert.ok(types.includes("half-open"));
  assert.ok(types.includes("close"));
  assert.ok(types.includes("fail-fast"));
  const open = run.frames.find((f) => f.event.type === "open")!;
  const next = run.frames[open.event.id + 1];
  assert.equal(next.world.counters.attempts, open.world.counters.attempts);
  assert.equal(run.frames.at(-1)!.world.fields.circuit, "closed");
});
test("finite ring moves only keys owned by the added node and recovers without fabricated remapping", () => {
  const points = ring(3, 3, 42);
  assert.equal(
    owner(359, points),
    points.find((p) => p.position >= 359)?.owner || points[0].owner,
  );
  const run = runExperiment(makeConfig("consistent-hashing")),
    before = run.frames[0].world.entities,
    after = run.frames.at(-1)!.world.entities;
  const changed = after.filter((e, i) => e.owner !== before[i].owner);
  assert.ok(changed.length > 0);
  assert.ok(changed.every((e) => e.owner === "node-4"));
  assert.equal(run.frames.at(-1)!.world.counters.moved, changed.length);
  for (const { world, metrics } of run.frames) {
    const busiest = Math.max(
      ...world.nodes.map(
        (n) => world.entities.filter((e) => e.owner === n.id).length,
      ),
    );
    assert.equal(world.counters.maxload, busiest);
    assert.equal(metrics.find((m) => m.key === "maxload")!.value, busiest);
  }
});
test("replicas converge, strong reads stay current, transactions preserve balances, snapshots preserve fold", () => {
  const eventual = runExperiment(makeConfig("eventual-consistency", true));
  assert.ok(eventual.frames.at(-1)!.world.counters.stale > 0);
  assert.equal(
    new Set(eventual.frames.at(-1)!.world.entities.map((e) => e.version)).size,
    1,
  );
  assert.equal(
    runExperiment(makeConfig("strong-consistency")).frames.at(-1)!.world
      .counters.stale || 0,
    0,
  );
  for (const f of runExperiment(makeConfig("transactions", true)).frames)
    assert.equal(
      f.world.entities.reduce((s, e) => s + Number(e.value), 0),
      150,
    );
  const full = runExperiment(makeConfig("event-sourcing")),
    snap = runExperiment(makeConfig("event-sourcing", true));
  assert.equal(
    full.frames.at(-1)!.world.counters.balance,
    snap.frames.at(-1)!.world.counters.balance,
  );
  assert.ok(
    snap.frames.at(-1)!.world.counters.replayed <
      full.frames.at(-1)!.world.counters.replayed,
  );
});
test("timeouts do not cancel remote effects, sagas compensate in reverse, fences reject stale holders", () => {
  const timeout = runExperiment(makeConfig("timeouts"));
  assert.ok(timeout.frames.some((f) => f.event.type === "timeout"));
  assert.equal(timeout.frames.at(-1)!.world.counters.completed, 1);
  const saga = runExperiment(makeConfig("sagas", true));
  assert.deepEqual(
    saga.frames
      .filter((f) => f.event.type === "compensate")
      .map((f) => f.event.path[0]),
    ["payment", "inventory"],
  );
  assert.equal(
    runExperiment(makeConfig("distributed-locks")).frames.at(-1)!.world.counters
      .denied,
    1,
  );
});
test("canary summaries depend on weight and error probability", () => {
  const c = makeConfig("canary");
  c.values.weight = 70;
  c.values.errors = 40;
  const r = runExperiment(c);
  assert.ok(r.summary.includes("70% × 40% = 28%"));
  assert.equal(r.frames.at(-1)!.world.counters.expected, 28);
});

test("fleet request inspection and health probes agree with completed work", () => {
  for (const id of ["canary", "blue-green", "health-checks"]) {
    const run = runExperiment(makeConfig(id));
    let prior = 0;
    for (const f of run.frames.filter((f) => f.event.type === "dispatch")) {
      const completed = f.world.entities.filter(
        (e) => e.state === "completed",
      ).length;
      assert.equal((f.world.counters.completed || 0) - prior, completed);
      prior = f.world.counters.completed || 0;
      assert.ok(
        f.world.entities.every((e) =>
          f.world.nodes.some((n) => n.id === e.location),
        ),
      );
    }
  }
  const health = runExperiment(makeConfig("health-checks"));
  assert.ok(
    health.frames.some((f) =>
      f.world.nodes.some((n) => n.status === "failing checks, still routed"),
    ),
  );
  assert.ok(
    health.frames.some((f) =>
      f.world.nodes.some((n) => n.status === "probing"),
    ),
  );
  assert.ok(
    health.frames.at(-1)!.world.nodes.every((n) => n.status === "ready"),
  );
});

test("controls change state when their mechanism is exercised", () => {
  for (const lesson of lessons)
    for (const knob of lesson.controls) {
      const baseline = makeConfig(lesson.id);
      if (lesson.id === "data-lifecycle") baseline.values.age = 95;
      if (lesson.id === "batching") {
        baseline.values.arrivals = 1;
        baseline.values.batch = 5;
      }
      if (lesson.id === "backpressure") {
        baseline.values.arrivals = 5;
        baseline.values.workers = 1;
      }
      if (lesson.id === "sagas") baseline.values.fail = 1;
      // Health/failover delay only has an effect in the presence of a fault.
      if (["health-checks", "multi-az"].includes(lesson.id))
        baseline.faults = [
          { at: 4, active: true },
          { at: 12, active: false },
        ];
      const low = runExperiment({
        ...baseline,
        values: { ...baseline.values, [knob.key]: knob.min },
      });
      const high = runExperiment({
        ...baseline,
        values: { ...baseline.values, [knob.key]: knob.max },
      });
      assert.notDeepEqual(
        low.frames,
        high.frames,
        `${lesson.id}: ${knob.key} must affect actual state`,
      );
    }
});
test("injected future failures leave the observed timeline unchanged", () => {
  for (const id of ["cache-aside", "queues", "circuit-breaker"]) {
    const c = makeConfig(id),
      before = runExperiment(c);
    const prefix = before.frames.filter((f) => f.world.time < 7);
    const changed = runExperiment({
      ...c,
      faults: [...c.faults.filter((f) => f.at < 7), { at: 7, active: true }],
    });
    assert.deepEqual(changed.frames.slice(0, prefix.length), prefix);
  }
});
test("URLs validate model version, seed, controls, unknown lessons, and failure schedules", () => {
  const c = makeConfig("cache-aside");
  for (const bad of [
    { ...c, version: 99 },
    { ...c, seed: 0 },
    { ...c, lesson: "missing" },
    { ...c, values: { ttl: Infinity, capacity: 4 } },
    { ...c, values: { ...c.values, extra: 1 } },
    {
      ...c,
      faults: [
        { at: 4, active: true },
        { at: 3, active: false },
      ],
    },
  ])
    assert.throws(() => validateConfig(bad));
  assert.throws(() => restoreExperiment("?experiment=%7Bbroken"));
  assert.throws(() => restoreExperiment("?" + "x".repeat(7001)));
  assert.equal(restoreExperiment("?concept=queues")!.lesson, "queues");
});
test("progress migration preserves legacy IDs without inventing understanding or crossing accounts", () => {
  assert.deepEqual(parseProgress(["queues", "queues", "missing"]), {
    version: 2,
    explored: ["queues"],
    understood: [],
  });
  const data = new Map<string, string>([
    [LEGACY_KEY, JSON.stringify(["cache-aside"])],
  ]);
  const storage = {
    getItem: (k: string) => data.get(k) || null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  assert.deepEqual(readProgress(storage, "account-A"), emptyProgress());
  assert.deepEqual(readProgress(storage).explored, ["cache-aside"]);
  assert.ok(data.has(LEGACY_KEY));
  assert.ok(data.has(PROGRESS_KEY));
  assert.throws(() =>
    parseProgress({ version: 2, explored: null, understood: [] }),
  );
  assert.throws(() =>
    readProgress({
      getItem: () => "{bad",
      setItem: () => assert.fail("must not overwrite malformed storage"),
    }),
  );
  assert.throws(() =>
    readProgress({
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {},
    }),
  );
  assert.throws(() =>
    mergeCloud(emptyProgress(), { items: [{ conceptId: "unknown" }] }),
  );
  assert.deepEqual(
    mergeCloud(emptyProgress(), { items: [{ conceptId: "queues" }] })
      .understood,
    [],
  );
});
test("journey covers each stage, follows only existing components and distinguishes acceptance from completion", () => {
  for (let stage = 0; stage < 6; stage++)
    for (const operation of ["read", "order", "notification"] as const)
      for (const failure of [false, true]) {
        const trace = journeyTrace(stage, operation, failure),
          nodes = journeyNodes(stage);
        for (const f of trace) {
          assert.ok(f.path.every((id) => nodes.some((n) => n.id === id)));
          assert.ok(f.completed <= f.accepted);
        }
        if (stage >= 3 && operation !== "read")
          assert.ok(trace.some((f) => f.accepted === 1 && f.completed === 0));
      }
  assert.equal(journeyTrace(4, "notification", true).at(-1)!.completed, 0);
  assert.equal(journeyTrace(5, "notification", true).at(-1)!.completed, 1);
});
