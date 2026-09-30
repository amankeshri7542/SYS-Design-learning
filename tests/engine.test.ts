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
  comparisonConfig,
  healthForStatus,
  Timeline,
  node,
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
  assert.deepEqual(
    runExperiment(makeConfig("write-through")).frames.find(
      (f) => f.event.type === "write-through",
    )!.event.path,
    ["app", "origin", "app", "cache"],
  );
  assert.deepEqual(
    runExperiment({
      ...makeConfig("write-through"),
      faults: [{ at: 0, active: true }],
    }).frames.find((f) => f.event.type === "partial-write")!.event.path,
    ["app", "origin", "app", "cache"],
  );
  assert.deepEqual(
    runExperiment(makeConfig("invalidation")).frames.find(
      (f) => f.event.type === "invalidate",
    )!.event.path,
    ["origin", "app", "cache"],
  );
});
test("queue capacity uses the same accounting as accepted and completed counts", () => {
  const run = runExperiment(makeConfig("backpressure", true));
  for (const f of run.frames) assert.ok((f.world.counters.pending || 0) <= 4);
  assert.ok(run.frames.at(-1)!.world.counters.rejected > 0);
  const at = run.frames.find((f) => f.event.type === "enqueue")!;
  assert.ok(at.world.counters.accepted > (at.world.counters.completed || 0));
});
test("DLQ repair preserves quarantine until a separate redrive action", () => {
  const config = makeConfig("dead-letter");
  const run = runExperiment(config);
  const dead = run.frames.find((f) => f.event.type === "dead-letter")!;
  assert.ok(dead);
  assert.deepEqual(dead.event.path, ["worker", "queue0", "dlq"]);
  assert.equal(
    dead.world.entities.find((e) => e.state === "dead letter")!.attempts,
    3,
  );
  assert.equal(
    run.frames.some((f) => f.event.type === "redrive"),
    false,
  );
  assert.equal(run.frames.at(-1)!.world.counters.dead, 1);
  assert.equal(run.frames.at(-1)!.world.counters.completed, 15);
  assert.equal(run.outcome.state, "failed");
  const redriven = runExperiment({
    ...config,
    actions: [{ at: 17, type: "redrive" }],
  });
  const moved = redriven.frames.find((f) => f.event.type === "redrive")!;
  assert.equal(moved.event.time, 17);
  assert.equal(moved.world.entities.find((e) => e.id === "m-1")!.attempts, 0);
  assert.equal(redriven.frames.at(-1)!.world.counters.dead, 0);
  assert.equal(redriven.frames.at(-1)!.world.counters.completed, 16);
  assert.equal(redriven.outcome.state, "recovered");
  const unrepaired = runExperiment({
    ...config,
    faults: [{ at: 0, active: true }],
    actions: [{ at: 12, type: "redrive" }],
  });
  assert.equal(
    unrepaired.frames.filter((f) => f.event.type === "dead-letter").length,
    2,
  );
  assert.equal(unrepaired.frames.at(-1)!.world.counters.dead, 1);
});

test("saga forward actions and compensation each have matched attempts and commits", () => {
  const success = runExperiment(makeConfig("sagas"));
  const failure = runExperiment(makeConfig("sagas", true));
  const count = failure.frames.at(-1)!.world.counters;
  assert.equal(count.attempts, 5);
  assert.equal(count.completed, 4);
  assert.equal(count.errors, 1);
  assert.equal(count.forwardAttempts, 3);
  assert.equal(count.forwardCompleted, 2);
  assert.equal(count.forwardErrors, 1);
  assert.equal(count.compensationAttempts, 2);
  assert.equal(count.compensationCompleted, 2);
  assert.deepEqual(
    failure.frames
      .filter((f) => f.event.type === "compensate")
      .map((f) => [
        f.event.path[0],
        f.world.counters.attempts,
        f.world.counters.completed,
      ]),
    [
      ["payment", 4, 3],
      ["inventory", 5, 4],
    ],
  );
  for (const { world } of failure.frames) {
    const c = world.counters;
    assert.equal(c.attempts || 0, (c.completed || 0) + (c.errors || 0));
    assert.equal(
      c.forwardAttempts || 0,
      (c.forwardCompleted || 0) + (c.forwardErrors || 0),
    );
    assert.equal(c.compensationAttempts || 0, c.compensationCompleted || 0);
  }
  assert.equal(failure.outcome.state, "recovered");
  assert.equal(success.frames.at(-1)!.world.counters.attempts, 3);
  assert.equal(success.frames.at(-1)!.world.counters.completed, 3);
  assert.equal(
    success.frames.at(-1)!.world.counters.compensationAttempts || 0,
    0,
  );
  assert.equal(success.outcome.state, "success");
});

test("recovery measures actual unavailability through blocked validation and freezes readiness", () => {
  const config = makeConfig("disaster-recovery");
  config.values.restore = 5;
  config.faults = [
    { at: 4, active: true },
    { at: 20, active: false },
  ];
  const run = runExperiment(config);
  const restored = run.frames.filter((f) => f.event.type === "restored");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].event.time, 20);
  assert.equal(restored[0].world.counters.rto, 18);
  assert.equal(restored[0].world.counters.planned, 5);
  for (const frame of run.frames.filter(
    (f) => f.world.fields.restoreStarted !== undefined,
  )) {
    assert.equal(frame.world.counters.rto, Math.min(frame.event.time - 2, 18));
    if (frame.event.time < 20)
      assert.notEqual(frame.outcome.state, "recovered");
  }
  assert.equal(run.frames.at(-1)!.world.counters.rto, 18);
  assert.equal(run.outcome.state, "recovered");
  const blocked = runExperiment({
    ...config,
    faults: [{ at: 4, active: true }],
  });
  assert.equal(blocked.frames.at(-1)!.world.counters.rto, 30);
  assert.equal(blocked.frames.at(-1)!.world.counters.completed || 0, 0);
  assert.equal(blocked.outcome.state, "pending");
  const blockedFromStart = runExperiment({
    ...config,
    faults: [{ at: 0, active: true }],
  });
  assert.equal(
    blockedFromStart.frames.find((f) => f.event.type === "disaster")!.event
      .time,
    2,
  );
  assert.equal(blockedFromStart.frames.at(-1)!.world.counters.rto, 30);
  const normal = runExperiment({ ...config, faults: [] });
  assert.equal(normal.frames.at(-1)!.world.counters.rto, 5);
  const laterOutage = runExperiment({
    ...config,
    faults: [{ at: 10, active: true }],
  });
  assert.equal(laterOutage.frames.at(-1)!.world.counters.rto, 5);
  assert.equal(laterOutage.outcome.state, "failed");
});

test("CloudFront requests S3 on a miss and returns hits without origin contact", () => {
  const config = makeConfig("cdn-cache");
  config.values.cacheable = 100;
  config.values.ttl = 20;
  const run = runExperiment(config);
  assert.deepEqual(run.frames[0].world.edges, [
    ["app", "cache"],
    ["cache", "origin"],
  ]);
  assert.deepEqual(
    run.frames.slice(1, 5).map((f) => [f.event.type, f.event.path]),
    [
      ["miss", ["app", "cache"]],
      ["fetch", ["cache", "origin"]],
      ["fill", ["origin", "cache"]],
      ["response", ["cache", "app"]],
    ],
  );
  const hits = run.frames.filter((f) => f.event.type === "hit");
  assert.ok(hits.length > 0);
  for (const hit of hits) {
    assert.deepEqual(hit.event.path, ["app", "cache", "app"]);
    assert.equal(
      hit.world.counters.origin,
      run.frames[hit.event.id - 1].world.counters.origin,
    );
    assert.equal(
      run.frames.some(
        (f) =>
          f.event.time === hit.event.time && f.event.path.includes("origin"),
      ),
      false,
    );
  }
  const uncacheable = runExperiment({
    ...config,
    values: { ...config.values, cacheable: 0 },
  });
  assert.equal(uncacheable.frames.at(-1)!.world.counters.origin, 24);
  assert.equal(uncacheable.frames.at(-1)!.world.counters.hits || 0, 0);
  assert.equal(uncacheable.frames.at(-1)!.world.entities.length, 0);
  assert.ok(
    uncacheable.frames
      .filter((f) => f.event.type === "response")
      .every((f) => f.event.path.join(",") === "cache,app"),
  );
});

test("semantic health is normalized in every frame with a safe unknown fallback", () => {
  assert.equal(healthForStatus("lost"), "failed");
  assert.equal(healthForStatus("open"), "degraded");
  assert.equal(healthForStatus("half-open"), "recovering");
  assert.equal(healthForStatus("booting"), "waiting");
  assert.equal(healthForStatus("unrecognized adverse state"), "degraded");
  assert.equal(healthForStatus("toString"), "degraded");
  const timeline = new Timeline(makeConfig("cache-aside"));
  timeline.world.nodes = [node("unknown", "Unknown", "Application")];
  timeline.world.nodes[0].status = "unexpected failure";
  timeline.emit(1, "observation", "Unknown", "New state", "Inspect");
  assert.equal(timeline.frames[0].world.nodes[0].health, "degraded");
  for (const lesson of lessons)
    for (const frame of runExperiment(makeConfig(lesson.id, true)).frames) {
      for (const n of frame.world.nodes)
        assert.equal(n.health, healthForStatus(n.status));
      assert.ok(
        ["observing", "pending", "success", "failed", "recovered"].includes(
          frame.outcome.state,
        ),
      );
    }
  const pending = runExperiment({
    ...makeConfig("queues"),
    faults: [{ at: 0, active: true }],
  });
  assert.equal(pending.frames.at(-1)!.event.time, 32);
  assert.equal(pending.outcome.state, "pending");
  assert.equal(
    runExperiment(makeConfig("consistent-hashing")).outcome.state,
    "observing",
  );
});

test("comparison forks preserve every input and redrive URLs remain model-v2 compatible", () => {
  const config = makeConfig("dead-letter", true);
  config.seed = 937;
  config.values.arrivals = 4;
  config.actions = [{ at: 21, type: "redrive" }];
  const fork = comparisonConfig(config);
  assert.deepEqual(fork, config);
  fork.values.workers = 4;
  assert.equal(config.values.workers, 2);
  assert.deepEqual(restoreExperiment(experimentQuery(config)), config);
  assert.deepEqual(
    restoreExperiment(experimentQuery(makeConfig("cache-aside"))),
    makeConfig("cache-aside"),
  );
  for (const actions of [
    [{ at: 33, type: "redrive" }],
    [{ at: 2, type: "repair" }],
    [
      { at: 2, type: "redrive" },
      { at: 2, type: "redrive" },
    ],
    [{ at: -1, type: "redrive" }],
  ])
    assert.throws(() => validateConfig({ ...config, actions }));
  assert.throws(() =>
    validateConfig({
      ...makeConfig("cache-aside"),
      actions: [{ at: 1, type: "redrive" }],
    }),
  );
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
test("a below-threshold failure recovers without claiming a breaker probe", () => {
  const config = makeConfig("circuit-breaker");
  config.values.threshold = 5;
  config.faults = [
    { at: 4, active: true },
    { at: 5, active: false },
  ];
  const run = runExperiment(config);
  assert.deepEqual(
    run.frames.filter((frame) =>
      ["open", "half-open", "close"].includes(frame.event.type),
    ),
    [],
  );
  assert.equal(run.frames.at(-1)!.world.counters.errors, 1);
  assert.equal(run.outcome.state, "recovered");
  assert.equal(
    run.outcome.detail,
    "The dependency is responding and the breaker is closed. Earlier dependency errors remain in the totals.",
  );
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
        if (
          stage >= 3 &&
          operation !== "read" &&
          !(failure && operation === "order")
        )
          assert.ok(trace.some((f) => f.accepted === 1 && f.completed === 0));
        if (failure && operation === "order") {
          assert.equal(trace.at(-1)!.accepted, 0);
          assert.equal(trace.at(-1)!.completed, 0);
        }
      }
  assert.equal(journeyTrace(4, "notification", true).at(-1)!.completed, 0);
  assert.equal(journeyTrace(5, "notification", true).at(-1)!.completed, 1);
});
