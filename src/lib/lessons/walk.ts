// Walk a lesson's beats headlessly, as a learner would on the default settings: read each beat, answer the prediction,
// press each break when asked, and move on when a step's beats are done. The tests use it to prove every beat really
// happens and every prediction is true; `npm run tune -- --beats` prints it. `claimOf` measures the lesson's claim, for
// the fix-beats-the-problem test and `npm run tune -- --json`.

import { Sim } from "../sim/engine";
import { betterIs, formatMetric, measure, type MetricSpec } from "../sim/metrics";
import type { SceneSpec } from "../sim/types";
import { BeatRunner, fillIn, stepGrid, type Focus } from "./beats";
import { beatsOf, buildSteps, defaultsOf, headlineOf, holdsTraffic, type Lesson } from "./types";

export interface Walked {
  step: number;
  id: string;
  /** Simulated ms it fired at. */
  t: number;
  text: string;
  focus?: Focus;
  part: boolean;
}

export interface Walk {
  fired: Walked[];
  /** Beats that never fired: their trigger didn't hold within `capMs` of the beat before. */
  missing: { step: number; id: string }[];
  prediction: { before: number | null; after: number | null; holds: boolean } | null;
  sims: Sim[];
}

/** The warm-up the player gives a lesson's worlds before showing them. */
export const warmOf = (lesson: Lesson) => Math.max(400, ...buildSteps(lesson.figures, lesson.figures.map(defaultsOf)).map((s) => s.warmMs ?? 0));

export function walk(lesson: Lesson, { capMs = 20000 }: { capMs?: number } = {}): Walk {
  const figs = lesson.figures;
  const specs = buildSteps(figs, figs.map(defaultsOf));
  const sims = specs.map((s) => new Sim(s));
  if (holdsTraffic(figs)) for (const s of sims) s.hold();
  for (const s of sims) s.step(warmOf(lesson));
  const tones = figs.map((f) => f.tone);
  const metrics = figs.flatMap((f) => f.metrics);
  const ask = figs.findIndex((f) => f.predict);
  const p = ask >= 0 ? figs[ask].predict! : null;
  const marks: Record<string, string> = {};
  const raw = { before: null as number | null, after: null as number | null };
  const fired: Walked[] = [];
  const missing: Walk["missing"] = [];

  figs.forEach((f, i) => {
    const r = new BeatRunner(beatsOf(f), {
      timeScale: specs[i].timeScale ?? 0.1,
      fill: (text) => fillIn(text, { sims, tones, metrics, current: i, marks }),
      askBefore: f.predict?.before,
      onStart: () => sims.forEach((s) => s.start()),
    });
    const note = (key: "before" | "after") => {
      if (!p?.track) return;
      raw[key] = measure(sims[(key === "after" ? p.track.afterWorld : undefined) ?? p.track.world ?? ask], p.track.metric);
      marks[key] = formatMetric(p.track.metric, raw[key]);
    };
    while (!r.done) {
      const moved = stepGrid(sims, capMs, (ss) => {
        const was = r.waiting;
        const b = r.tick(ss[i], false, ss);
        if (b) {
          fired.push({ step: i, id: b.beat.id, t: b.t, text: b.text, focus: b.beat.focus, part: !!b.beat.part });
          if (p && b.beat.id === p.reveal.beat) {
            if (p.track?.same) note("before");
            note("after");
          }
          return true;
        }
        if (r.waiting === "ask" && was !== "ask") {
          note("before");
          return true;
        }
        return false;
      });
      if (!moved) {
        missing.push(...r.beats.slice(r.fired.length).map((b) => ({ step: i, id: b.id })));
        break;
      }
      if (r.waiting === "beat") {
        // The break waits for its fault: press it, in every world at once.
        if (f.break && r.current?.beat.id === f.break.beat) figs.forEach((g, j) => g.actions?.find((a) => a.id === f.break!.action)?.run(sims[j], true));
        r.release();
      }
      if (r.waiting === "ask") r.answer();
    }
  });
  return { fired, missing, prediction: p ? { ...raw, holds: p.holds(raw.before, raw.after) } : null, sims };
}

// ------------------------------------------------------------------------------------------------ the claim

/**
 * Step a scene by `ms`, firing its armed script as a learner's break would: the first armed event at its own `at`
 * (the rest of that run follows by itself).
 */
export function stepFiring(sim: Sim, ms: number) {
  const first = sim.spec.script?.events.find((e) => e.armed);
  const end = sim.t + ms;
  if (first && sim.t < first.at && first.at <= end) {
    sim.step(first.at - sim.t);
    sim.fire(first.label);
  }
  sim.step(end - sim.t);
}

/** Average a metric over a run, after the scene's warm-up (its `warmMs`, as the player runs it, then 800 ms more). */
export function averageOf(spec: SceneSpec, metric: MetricSpec, ms = 7000) {
  const sim = new Sim(spec);
  if (spec.warmMs) sim.step(spec.warmMs);
  const values: number[] = [];
  for (let t = 0; t < ms; t += 100) {
    stepFiring(sim, 100);
    if (t < 800) continue;
    const v = measure(sim, metric);
    if (v !== null) values.push(v);
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Lessons whose fault and recovery need a longer run before the averages say what the lesson claims. */
const CLAIM_MS: Record<string, number> = { "consistent-hashing": 9000, "consistency-vs-availability": 9000 };

/**
 * A lesson's teaching claim: how far its second step beats its first on the headline metric, averaged over a run with
 * the break fired. `gain` is the share by which it is better (above 0.08 is the bar). Null for an explore step, or
 * when the headline is not one of the second step's metrics.
 */
export function claimOf(lesson: Lesson): { metric: MetricSpec; problem: number; fix: number; gain: number } | null {
  const [problem, fix] = lesson.figures;
  if (!fix || fix.tone === "explore") return null;
  const label = headlineOf(lesson.figures);
  const metric = fix.metrics.find((m) => m.label === label);
  if (!metric) return null;
  const [without, withFix] = buildSteps([problem, fix], [defaultsOf(problem), defaultsOf(fix)]);
  const ms = CLAIM_MS[lesson.slug] ?? 7000;
  const a = averageOf(withFix, metric, ms);
  const b = averageOf(without, metric, ms);
  const gain = betterIs(metric) === "low" ? (b - a) / Math.max(b, 1e-9) : (a - b) / Math.max(a, 1e-9);
  return { metric, problem: b, fix: a, gain };
}
