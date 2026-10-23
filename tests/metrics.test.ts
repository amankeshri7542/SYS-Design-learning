import assert from "node:assert/strict";
import { test } from "node:test";
import { betterIs, changeSize, formatChange, formatClock, formatDiff, isLatency, type MetricSpec } from "../src/lib/sim/metrics";

const m = (id: MetricSpec["id"], extra: Partial<MetricSpec> = {}): MetricSpec => ({ id, label: id, ...extra });

test("how many servers are in use is neutral: never better or worse", () => {
  assert.equal(betterIs(m("inRotation")), "neutral");
  assert.equal(betterIs(m("servers")), "neutral");
  assert.equal(betterIs(m("p95")), "low");
  assert.equal(betterIs(m("hit")), "high");
  assert.equal(betterIs(m("util", { better: "neutral" })), "neutral", "a lesson can make any metric neutral");
});

test("a plain difference is signed and keeps the metric's unit", () => {
  assert.equal(formatDiff(m("inRotation"), -1), "−1");
  assert.equal(formatDiff(m("servers"), 2), "+2");
  assert.equal(formatDiff(m("p95"), 52.4), "+52 ms");
  assert.equal(formatDiff(m("p95"), -1250), "−1.3 s");
  assert.equal(formatDiff(m("util"), 0.64), "+64 pts");
  assert.equal(formatDiff(m("answered"), -0.004), "−<1 pts");
  assert.equal(formatDiff(m("throughput"), -10.2), "−10/s");
  assert.equal(formatDiff(m("amplify"), -2.26), "−2.3");
});

test("a verdict row's change is a signed share of the first step, and its bar never overstates it", () => {
  assert.equal(formatChange(360, 346), "−4%");
  assert.equal(formatChange(100, 138), "+38%");
  assert.equal(formatChange(0.12, 0), "−100%");
  assert.equal(formatChange(2, 40), "×20", "ten times or more reads as a multiple");
  assert.equal(formatChange(6e-30, 1), "new", "a share eased almost to zero counts as zero, not as ×1.5e+29");
  assert.equal(formatChange(0, 0.4), "new");
  assert.equal(formatChange(400, 401), "+<1%", "a visible change never reads as +0%");
  assert.equal(changeSize(360, 346), 14 / 360);
  assert.equal(changeSize(2, 40), 1);
  assert.equal(changeSize(0, 0.4), 1);
});

test("response times are the latency rows that show the target", () => {
  assert.ok(isLatency(m("p95")));
  assert.ok(isLatency(m("p50")));
  assert.ok(!isLatency(m("errors")));
  assert.ok(!isLatency(m("jobWait")));
});

test("the dock states the clock in plain words", () => {
  assert.equal(formatClock(0.1, 1), "1 s on screen = 100 ms");
  assert.equal(formatClock(0.1, 2), "1 s on screen = 200 ms");
  assert.equal(formatClock(0.1, 0.5), "1 s on screen = 50 ms");
  assert.equal(formatClock(0.05, 1), "1 s on screen = 50 ms");
});
