import assert from "node:assert/strict";
import { test } from "node:test";
import { LESSONS, getLesson, neighbours } from "../src/lib/lessons";
import { STAGES, START, TARGET, capstoneScene, type Arch } from "../src/lib/lessons/capstone";
import { HERO } from "../src/lib/lessons/hero";
import { buildSteps, defaultsOf, headlineOf, type FigureDef } from "../src/lib/lessons/types";
import { Sim } from "../src/lib/sim/engine";
import { betterIs, measure, type MetricSpec } from "../src/lib/sim/metrics";
import type { SceneSpec } from "../src/lib/sim/types";

/** Average a metric over a run, after the scene's warm-up. */
function average(spec: SceneSpec, metric: MetricSpec, ms = 7000) {
  const sim = new Sim(spec);
  const values: number[] = [];
  for (let t = 0; t < ms; t += 100) {
    sim.step(100);
    if (t < 800) continue;
    const v = measure(sim, metric);
    if (v !== null) values.push(v);
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const lessons = LESSONS.filter((l) => l.line !== "capstone");
const TONES = ["problem,fix", "problem,explore", "tradeoff,tradeoff", "problem,fix,fix", "problem,fix,tradeoff"];

test("slugs and codes are unique, and the course runs from a first lesson to the capstone", () => {
  assert.ok(lessons.length > 0);
  assert.equal(new Set(LESSONS.map((l) => l.slug)).size, LESSONS.length);
  assert.equal(new Set(LESSONS.map((l) => l.code)).size, LESSONS.length);
  assert.equal(neighbours(LESSONS[0].slug).prev, undefined);
  assert.equal(neighbours("capstone").next, undefined);
});

test("every lesson has a one-line why, a problem then a fix (or a trade-off pair), and short takeaways", () => {
  for (const l of lessons) {
    assert.ok(l.why.length < 220, `${l.slug} why is short`);
    assert.ok(l.figures.length >= 2, `${l.slug} has at least two scenes`);
    const tones = l.figures.map((f) => f.tone).join(",");
    assert.ok(TONES.includes(tones), `${l.slug}: ${tones}`);
    assert.ok(l.figures.every((f) => f.short.length <= 16), `${l.slug} step names fit a tab`);
    for (const f of l.figures) {
      assert.ok((f.knobs ?? []).length <= 2, `${l.slug} keeps knobs to two`);
      assert.ok(f.metrics.length <= 4, `${l.slug} keeps metrics to four`);
      assert.ok(f.caption.split(/\s+/).length < 60, `${l.slug} caption is brief`);
    }
  }
});

test("every scene builds and runs at every knob extreme without throwing", () => {
  const figures: FigureDef[] = [HERO, ...LESSONS.flatMap((l) => l.figures)];
  for (const f of figures) {
    const corners = [defaultsOf(f)];
    for (const k of f.knobs ?? []) {
      const values = "options" in k ? k.options.map((o) => o.value) : [k.min, k.max];
      for (const v of values) corners.push({ ...defaultsOf(f), [k.id]: v });
    }
    for (const v of corners) {
      const sim = new Sim(f.build(v));
      sim.step(1500);
      for (const a of f.actions ?? []) {
        a.run(sim, true);
        sim.step(200);
        assert.equal(a.isOn(sim), true, `${f.title}: ${a.label} reports its state`);
        a.run(sim, false);
      }
      sim.step(500);
    }
  }
});

test("a fault offered in several steps is one fault: the same label always has the same id", () => {
  for (const l of lessons) {
    const ids = new Map<string, string>();
    for (const f of l.figures) {
      const own = (f.actions ?? []).map((a) => a.id);
      assert.equal(new Set(own).size, own.length, `${l.slug}: action ids are unique within “${f.short}”`);
      for (const a of f.actions ?? []) {
        const id = ids.get(a.label) ?? a.id;
        ids.set(a.label, id);
        assert.equal(a.id, id, `${l.slug}: “${a.label}” has one id in every step`);
      }
    }
  }
});

// Lockstep fairness: the problem and the fix (or both sides of a trade-off) share the clock and the targets,
// and their clients send exactly the same requests at the same moments. Explore figures change the traffic
// on purpose, so they are exempt.
for (const lesson of lessons) {
  const compared = lesson.figures.flatMap((f, i) => (i > 0 && f.tone !== "explore" ? [i] : []));
  if (!compared.length) continue;
  test(`${lesson.code} ${lesson.title}: every step sees the same clock, targets and traffic`, () => {
    const specs = buildSteps(lesson.figures, lesson.figures.map(defaultsOf));
    const trace = (spec: SceneSpec) => {
      const sim = new Sim(spec, { trace: true });
      sim.step(5000);
      return sim.trace;
    };
    const first = trace(specs[0]);
    assert.ok(first.length > 50, `${lesson.slug}: the first step has traffic`);
    for (const i of compared) {
      for (const k of ["sloMs", "timeoutMs", "timeScale", "windowMs"] as const)
        assert.equal(specs[i][k], specs[0][k], `${lesson.slug}: “${lesson.figures[i].short}” has the same ${k}`);
      assert.deepEqual(trace(specs[i]), first, `${lesson.slug}: “${lesson.figures[i].short}” sees the same arrivals`);
    }
  });
}

// The teaching claim of each lesson: the second step measurably beats the first on its headline metric.
for (const lesson of LESSONS) {
  const [problem, fix] = lesson.figures;
  if (!fix || fix.tone === "explore") continue;
  test(`${lesson.code} ${lesson.title}: the fix beats the problem`, () => {
    const label = headlineOf(lesson.figures);
    const metric = fix.metrics.find((m) => m.label === label);
    assert.ok(metric, `${lesson.slug}: the headline “${label}” is one of the fix's metrics`);
    assert.notEqual(betterIs(metric), "neutral", `${lesson.slug}: the headline has a better direction`);
    const [without, withFix] = buildSteps([problem, fix], [defaultsOf(problem), defaultsOf(fix)]);
    const ms = lesson.slug === "consistent-hashing" || lesson.slug === "consistency-vs-availability" ? 9000 : 7000;
    const a = average(withFix, metric, ms);
    const b = average(without, metric, ms);
    const gain = betterIs(metric) === "low" ? (b - a) / Math.max(b, 1e-9) : (a - b) / Math.max(a, 1e-9);
    assert.ok(gain > 0.08, `${metric.label}: fix ${a.toFixed(3)} vs without ${b.toFixed(3)}`);
  });
}

test("D3: a hash ring moves far fewer keys than hash % N", () => {
  const l = getLesson("consistent-hashing")!;
  const moved = (f: FigureDef) => {
    const sim = new Sim(f.build(defaultsOf(f)));
    sim.step(2400);
    return measure(sim, f.metrics[2])!;
  };
  assert.ok(moved(l.figures[0]) > 0.6);
  assert.ok(moved(l.figures[1]) < 0.35);
});

/** Longest run of simulated ms where the capstone target holds. */
function bestStreak(a: Arch, stage: number) {
  const sim = new Sim(capstoneScene(a, STAGES[stage]));
  let streak = 0;
  let best = 0;
  for (let t = 0; t < 8000; t += 50) {
    sim.step(50);
    if (t < 600) continue;
    const p = measure(sim, { id: "p95", label: "", tag: "user" });
    const e = measure(sim, { id: "errors", label: "", tag: "user" }) ?? 0;
    if (p !== null && p <= TARGET.p95 && e <= TARGET.errors) best = Math.max(best, (streak += 50));
    else streak = 0;
  }
  return best;
}

test("capstone: each stage needs the next idea, and the intended design clears it", () => {
  const need = (stage: number) => STAGES[stage].hold * 1000 * 0.1;
  const designs: Arch[] = [
    START,
    { ...START, cache: true },
    { ...START, cache: true, servers: 2 },
    { ...START, cache: true, servers: 3, limiter: true },
  ];
  designs.forEach((d, stage) => {
    assert.ok(bestStreak(d, stage) >= need(stage), `stage ${stage + 1} is clearable`);
    if (stage > 0) assert.ok(bestStreak(designs[stage - 1], stage) < need(stage), `stage ${stage + 1} needs a change`);
  });
});
