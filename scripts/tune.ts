// Prints each figure's metrics over a simulated run. Usage: npx tsx scripts/tune.ts [slug] [ms] [--beats]
// With --beats it also walks the lesson's beats as a learner would and prints when each one fires (on screen at 1×).
import { LESSONS } from "../src/lib/lessons";
import { defaultsOf } from "../src/lib/lessons/types";
import { walk, warmOf } from "../src/lib/lessons/walk";
import { Sim } from "../src/lib/sim/engine";
import { formatMetric, measure } from "../src/lib/sim/metrics";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const beats = process.argv.includes("--beats");
const only = args[0];
const RUN = Number(args[1] ?? 6000);
for (const lesson of LESSONS) {
  if (only && lesson.slug !== only) continue;
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
    const line = f.metrics
      .map((m) => {
        const s = samples[m.label] ?? [];
        const avg = s.reduce((a, b) => a + b, 0) / (s.length || 1);
        const max = Math.max(...s);
        return `${m.label}: avg ${formatMetric(m, avg)} max ${formatMetric(m, max)}`;
      })
      .join(" | ");
    console.log(`${lesson.code} ${f.tone.padEnd(8)} ${line}  [reqs ${sim.reqs.length}, ${took.toFixed(0)}ms]`);
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
