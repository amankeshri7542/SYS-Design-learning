// Prints each figure's metrics over a simulated run.
//
//   npm run tune -- [slug] [ms] [--line=<id>] [--level=<level>] [--beats] [--json]
//
// --line and --level keep only the lessons on one line or at one level. --beats also walks each lesson's beats as a
// learner would and prints when each one fires (on screen at 1×). --json prints one object instead: every figure's
// averages and maxes and each lesson's claim, for comparing a run before and after an engine change.
import { ALL_LESSONS } from "../src/lib/lessons/all";
import { defaultsOf } from "../src/lib/lessons/types";
import { claimOf, walk, warmOf } from "../src/lib/lessons/walk";
import { Sim } from "../src/lib/sim/engine";
import { formatMetric, measure } from "../src/lib/sim/metrics";

const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const beats = process.argv.includes("--beats");
const json = process.argv.includes("--json");
const only = args[0];
const RUN = Number(args[1] ?? 6000);
const line = flag("line");
const level = flag("level");

type Stats = Record<string, { avg: number; max: number }>;
const out: Record<string, { figures: Record<string, Stats>; claim?: { metric: string; gain: number } }> = {};

for (const lesson of ALL_LESSONS) {
  if (only && lesson.slug !== only) continue;
  if (line && lesson.line !== line) continue;
  if (level && lesson.level !== level) continue;
  const entry: (typeof out)[string] = { figures: {} };
  for (const f of lesson.figures) {
    const v = defaultsOf(f);
    const sim = new Sim(f.build(v));
    const t0 = performance.now();
    const samples: Record<string, number[]> = {};
    for (let t = 0; t < RUN; t += 100) {
      sim.step(100);
      if (t < 800) continue;
      for (const m of f.metrics) {
        const x = measure(sim, m);
        if (x !== null) (samples[m.label] ??= []).push(x);
      }
    }
    const took = performance.now() - t0;
    const stats = f.metrics.map((m) => {
      const s = samples[m.label] ?? [];
      return { m, avg: s.reduce((a, b) => a + b, 0) / (s.length || 1), max: Math.max(...s) };
    });
    entry.figures[`${f.tone}:${f.short}`] = Object.fromEntries(stats.map(({ m, avg, max }) => [m.label, { avg, max }]));
    if (json) continue;
    const text = stats.map(({ m, avg, max }) => `${m.label}: avg ${formatMetric(m, avg)} max ${formatMetric(m, max)}`).join(" | ");
    console.log(`${lesson.code} ${f.tone.padEnd(8)} ${text}  [reqs ${sim.reqs.length}, ${took.toFixed(0)}ms]`);
  }
  if (json) {
    const claim = claimOf(lesson);
    if (claim) entry.claim = { metric: claim.metric.label, gain: claim.gain };
    out[lesson.slug] = entry;
    continue;
  }
  if (!beats || !lesson.figures.some((f) => f.beats?.length)) continue;
  const w = walk(lesson);
  const scale = lesson.figures[0].build(defaultsOf(lesson.figures[0])).timeScale ?? 0.1;
  const warm = warmOf(lesson);
  for (const b of w.fired) {
    const screen = ((b.t - warm) / scale / 1000).toFixed(1).padStart(5);
    console.log(`   ${b.step + 1}  t=${String(Math.round(b.t)).padStart(5)} (${screen} s)  ${b.part ? "part " : "beat "} ${b.id.padEnd(9)} ${b.text}`);
  }
  if (w.missing.length) console.log(`   MISSING: ${w.missing.map((m) => `${m.step + 1}:${m.id}`).join(", ")}`);
  if (w.prediction) console.log(`   prediction: before ${w.prediction.before} after ${w.prediction.after} → ${w.prediction.holds ? "holds" : "DOES NOT HOLD"}`);
}

if (json) console.log(JSON.stringify(out, null, 2));
