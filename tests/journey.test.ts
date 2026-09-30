import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultJourneyOptions,
  journeyEdges,
  journeyNodes,
  journeyRoute,
  journeyTrace,
} from "../src/lib/journey";
import {
  allowCircuitCall,
  createCircuitState,
  recordCircuitResult,
} from "../src/lib/engine/circuit-policy";

test("journey cache warmth and source availability are independent", () => {
  const warm = journeyTrace(1, "read", {
    ...defaultJourneyOptions,
    cache: "warm",
    source: "unavailable",
  });
  assert.equal(warm.at(-1)!.completed, 1);
  assert.ok(warm.some((f) => f.evidence?.type === "hit"));
  assert.ok(!warm.some((f) => f.path.includes("db")));
  for (const cache of ["cold", "expired"] as const) {
    const failed = journeyTrace(1, "read", {
      ...defaultJourneyOptions,
      cache,
      source: "unavailable",
    });
    assert.equal(failed.at(-1)!.state, "Failed");
    assert.equal(failed.at(-1)!.completed, 0);
    assert.ok(failed.some((f) => f.evidence?.type === "miss"));
    if (cache === "expired")
      assert.ok(failed.some((f) => f.evidence?.type === "expire"));
    const healthy = journeyTrace(1, "read", {
      ...defaultJourneyOptions,
      cache,
    });
    assert.equal(healthy.at(-1)!.completed, 1);
    assert.ok(healthy.some((f) => f.evidence?.type === "fill"));
  }
});

test("journey writer failure prevents order acceptance but not already published notification work", () => {
  const failed = journeyTrace(4, "order", {
    ...defaultJourneyOptions,
    source: "unavailable",
  });
  assert.equal(failed.at(-1)!.accepted, 0);
  assert.equal(failed.at(-1)!.health, "failed");
  assert.ok(!failed.some((f) => f.path.includes("queue")));
  const published = journeyTrace(4, "notification", {
    ...defaultJourneyOptions,
    source: "unavailable",
  });
  assert.equal(published.at(-1)!.completed, 1);
});

test("journey worker stop retains accepted work; restart can complete it", () => {
  const stopped = journeyTrace(4, "notification", {
    ...defaultJourneyOptions,
    worker: "stopped",
  });
  assert.equal(stopped.at(-1)!.accepted, 1);
  assert.equal(stopped.at(-1)!.completed, 0);
  assert.equal(stopped.at(-1)!.pending, 1);
  assert.equal(stopped.at(-1)!.dead, 0);
  assert.equal(stopped.at(-1)!.state, "Pending at horizon");
  const restart = journeyTrace(4, "notification", {
    ...defaultJourneyOptions,
    worker: "recover",
  });
  assert.equal(restart.find((f) => f.evidence?.type === "receive")!.time, 10);
  assert.equal(restart.find((f) => f.evidence?.type === "ack")!.time, 11);
  assert.equal(restart.at(-1)!.completed, 1);
});

test("journey repair never implicitly redrives a DLQ", () => {
  const repaired = journeyTrace(4, "notification", {
    ...defaultJourneyOptions,
    processing: "repair",
  });
  const isolated = repaired.find((f) => f.dead === 1)!;
  assert.equal(isolated.time, 8); // receives at 1, 4, 7; processing outcomes at 2, 5, 8
  assert.equal(repaired.at(-1)!.completed, 0);
  assert.equal(repaired.at(-1)!.dead, 1);
  assert.ok(!repaired.some((f) => f.evidence?.type === "redrive"));
  const redriven = journeyTrace(4, "notification", {
    ...defaultJourneyOptions,
    processing: "repair",
    redriveAt: 20,
  });
  assert.equal(redriven.find((f) => f.evidence?.type === "redrive")!.time, 20);
  assert.equal(redriven.find((f) => f.completed === 1)!.time, 21);
  assert.equal(redriven.at(-1)!.dead, 0);
  const premature = journeyTrace(4, "notification", {
    ...defaultJourneyOptions,
    processing: "failing",
    redriveAt: 10,
  });
  assert.equal(premature.at(-1)!.dead, 1);
  assert.equal(premature.at(-1)!.completed, 0);
});

test("journey breaker opens, gates receives, fails a probe, and recovers only on a successful redriven attempt", () => {
  const trace = journeyTrace(5, "notification", {
    ...defaultJourneyOptions,
    processing: "repair",
    redriveAt: 20,
  });
  assert.equal(trace.find((f) => f.evidence?.type === "breaker-open")!.time, 5);
  assert.ok(
    trace.some((f) => f.time === 7 && f.evidence?.type === "breaker-blocked"),
  );
  assert.equal(
    trace.find((f) => f.evidence?.type === "breaker-half-open")!.time,
    9,
  );
  assert.ok(
    trace.some((f) => f.time === 10 && f.evidence?.type === "breaker-open"),
  );
  assert.ok(
    !trace.some(
      (f) => f.time > 5 && f.time < 9 && f.evidence?.type === "receive",
    ),
  );
  assert.equal(
    trace.find((f) => f.evidence?.type === "breaker-closed")!.time,
    21,
  );
  assert.deepEqual(trace.find((f) => f.evidence?.type === "ack")!.path, [
    "worker",
    "breaker",
    "provider",
    "worker",
    "queue",
  ]);
  assert.equal(trace.at(-1)!.circuit, "closed");
  assert.equal(trace.at(-1)!.completed, 1);
  const onlyRepair = journeyTrace(5, "notification", {
    ...defaultJourneyOptions,
    processing: "repair",
  });
  assert.equal(onlyRepair.at(-1)!.completed, 0);
  assert.equal(onlyRepair.at(-1)!.dead, 1);
  assert.equal(onlyRepair.at(-1)!.circuit, "open");
});

test("shared breaker policy enforces cooldown and resets failure count after a successful probe", () => {
  const state = createCircuitState();
  recordCircuitResult(state, 1, 2, false);
  assert.equal(state.phase, "closed");
  recordCircuitResult(state, 2, 2, false);
  assert.equal(allowCircuitCall(state, 5, 4), false);
  assert.equal(allowCircuitCall(state, 6, 4), true);
  assert.equal(state.phase, "half-open");
  recordCircuitResult(state, 7, 2, false);
  assert.equal(state.phase, "open");
  assert.equal(allowCircuitCall(state, 11, 4), true);
  recordCircuitResult(state, 12, 2, true);
  assert.equal(state.phase, "closed");
  assert.equal(state.failures, 0);
});

test("journey accounting, topology, and replay remain valid for combined controls", () => {
  for (let stage = 0; stage < 6; stage++) {
    const ids = new Set(journeyNodes(stage).map((n) => n.id));
    assert.ok(
      journeyEdges(stage).every((edge) => edge.every((id) => ids.has(id))),
    );
    for (const operation of ["read", "order", "notification"] as const) {
      assert.ok(journeyRoute(stage, operation).every((id) => ids.has(id)));
      for (const worker of ["healthy", "stopped", "recover"] as const)
        for (const processing of ["healthy", "failing", "repair"] as const) {
          const config = {
            ...defaultJourneyOptions,
            worker,
            processing,
            redriveAt: 20,
          };
          const trace = journeyTrace(stage, operation, config);
          assert.deepEqual(trace, journeyTrace(stage, operation, config));
          for (const [i, frame] of trace.entries()) {
            assert.equal(
              frame.accepted,
              frame.completed + frame.pending + frame.dead,
            );
            assert.ok(frame.path.every((id) => ids.has(id)));
            assert.ok(!i || trace[i - 1].time <= frame.time);
          }
        }
    }
  }
  assert.throws(() => journeyTrace(8, "read"));
  assert.throws(() =>
    journeyTrace(4, "notification", {
      ...defaultJourneyOptions,
      redriveAt: 33,
    }),
  );
});
