"use client";

// What the home page's hero and the journeys use and lessons don't: a plain list of live numbers. Apart, so a lesson
// page (or My System) doesn't carry it.

import type { Sim } from "@/lib/sim/engine";
import { formatMetric, measure, toneOf, type MetricSpec } from "@/lib/sim/metrics";
import { Spark, Target, useHistory, useSmoothed } from "./live";

/** Compact list of live metrics with sparklines (hero and capstone). */
export function MetricList({ metrics, sim }: { metrics: MetricSpec[]; sim: Sim }) {
  const smooth = useSmoothed();
  const values = metrics.map((m) => smooth(m.label, measure(sim, m), m));
  const history = useHistory(sim, metrics, values);
  return (
    <dl className="mlist">
      {metrics.map((m, i) => (
        <div key={m.label} className={`mrow tone-${toneOf(m, values[i], sim.spec.sloMs)}`}>
          <dt title={m.hint}>
            {m.label}
            <Target m={m} sloMs={sim.spec.sloMs} />
          </dt>
          <dd className="num">{formatMetric(m, values[i])}</dd>
          <dd className="mspark">
            <Spark data={history[m.label] ?? []} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
