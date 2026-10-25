"use client";

import type { Sim } from "@/lib/sim/engine/core";
import { measure, type MetricSpec } from "@/lib/sim/metrics";
import { explainMetric } from "@/lib/sim/metric-words";

/** A metric's number read as plain sentences, for its popover. Loaded the first time a metric is opened. */
export default function MetricExplanation({ m, sim }: { m: MetricSpec; sim: Sim }) {
  return explainMetric(m, measure(sim, m), sim).map((l) => (
    <p key={l} className="metric-line">
      {l}
    </p>
  ));
}
