// Prints each figure's metrics over a simulated run. Usage: npx tsx scripts/tune.ts [slug]
import { LESSONS } from "../src/lib/lessons";
import { defaultsOf } from "../src/lib/lessons/types";
import { Sim } from "../src/lib/sim/engine";
import { formatMetric, measure } from "../src/lib/sim/metrics";

const only = process.argv[2];
const RUN = Number(process.argv[3] ?? 6000);
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
}
