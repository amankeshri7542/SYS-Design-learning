import type { Sim } from "./engine";

export type MetricId =
  | "p50"
  | "p95"
  | "errors"
  | "rejected"
  | "stale"
  | "fallback"
  | "throughput"
  | "hit"
  | "util"
  | "peak"
  | "load"
  | "inRotation"
  | "queue"
  | "servers"
  | "moved"
  | "amplify"
  | "conflicts"
  | "answered"
  | "jobWait"
  | "unsynced";

export interface MetricSpec {
  id: MetricId;
  label: string;
  /** Only count requests from clients with this tag. */
  tag?: string;
  /** Only count reads or only writes. */
  op?: "read" | "write";
  /** Node ids for node-level metrics (hit ratio, utilisation, queue depth…). */
  nodes?: string[];
  /** Explains the number in plain words (shown as a tooltip and to screen readers). */
  hint?: string;
  /** Override which direction is good news (e.g. more of the bot's requests turned away). */
  better?: Better;
}

/** Which direction is good news. Neutral metrics (how many servers are in use) never get a verdict. */
export type Better = "low" | "high" | "neutral";

type Unit = "ms" | "pct" | "rate" | "count" | "ratio";

const META: Record<MetricId, { unit: Unit; better: Better }> = {
  p50: { unit: "ms", better: "low" },
  p95: { unit: "ms", better: "low" },
  errors: { unit: "pct", better: "low" },
  rejected: { unit: "pct", better: "low" },
  stale: { unit: "pct", better: "low" },
  fallback: { unit: "pct", better: "low" },
  throughput: { unit: "rate", better: "high" },
  hit: { unit: "pct", better: "high" },
  util: { unit: "pct", better: "low" },
  peak: { unit: "pct", better: "low" },
  load: { unit: "rate", better: "low" },
  inRotation: { unit: "count", better: "neutral" },
  queue: { unit: "count", better: "low" },
  servers: { unit: "count", better: "neutral" },
  moved: { unit: "pct", better: "low" },
  amplify: { unit: "ratio", better: "low" },
  conflicts: { unit: "count", better: "low" },
  answered: { unit: "pct", better: "high" },
  jobWait: { unit: "ms", better: "low" },
  unsynced: { unit: "count", better: "low" },
};

function recent(sim: Sim, m: MetricSpec) {
  const from = sim.t - sim.windowMs;
  return sim.done.filter((d) => d.t > from && (!m.tag || d.tag === m.tag) && (!m.op || d.op === m.op));
}

function percentile(values: number[], q: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function share(sim: Sim, m: MetricSpec, pick: (r: string) => boolean, of?: (r: string) => boolean) {
  const d = recent(sim, m).filter((x) => !of || of(x.result));
  if (!d.length) return null;
  return d.filter((x) => pick(x.result)).length / d.length;
}

function nodes(sim: Sim, ids?: string[]) {
  return (ids ?? []).map((id) => sim.nodes.get(id)).filter((n) => !!n);
}

/** Current value of a metric over the simulation's sliding window. Null when there is no data yet. */
export function measure(sim: Sim, m: MetricSpec): number | null {
  switch (m.id) {
    case "p50":
    case "p95":
      return percentile(
        recent(sim, m).filter((d) => d.result !== "rejected").map((d) => d.lat),
        m.id === "p50" ? 0.5 : 0.95,
      );
    case "errors":
      return share(sim, m, (r) => r === "error");
    case "rejected":
      return share(sim, m, (r) => r === "rejected");
    case "fallback":
      return share(sim, m, (r) => r === "fallback");
    case "answered":
      return share(sim, m, (r) => r !== "error" && r !== "rejected");
    case "stale":
      return share(sim, m, (r) => r === "stale", (r) => r === "ok" || r === "stale");
    case "throughput": {
      const ok = recent(sim, m).filter((d) => d.result === "ok" || d.result === "stale" || d.result === "fallback");
      return sim.t < 200 ? null : (ok.length / Math.min(sim.windowMs, sim.t)) * 1000;
    }
    case "hit": {
      let h = 0;
      let x = 0;
      for (const n of nodes(sim, m.nodes)) {
        h += n.hits.count(sim.t);
        x += n.misses.count(sim.t);
      }
      return h + x ? h / (h + x) : null;
    }
    case "util": {
      const on = nodes(sim, m.nodes).filter((n) => n.on);
      return on.length ? on.reduce((s, n) => s + n.load, 0) / on.length : null;
    }
    case "peak": {
      const on = nodes(sim, m.nodes).filter((n) => n.on);
      return on.length ? Math.max(...on.map((n) => n.load)) : null;
    }
    case "load": {
      if (sim.t < 200) return null;
      const span = Math.min(sim.windowMs, sim.t);
      return (nodes(sim, m.nodes).reduce((s, n) => s + n.arrivals.count(sim.t), 0) / span) * 1000;
    }
    case "inRotation": {
      const lb = nodes(sim, m.nodes)[0];
      if (!lb) return null;
      return sim.flat(lb.spec.to).filter((id) => {
        const s = sim.nodes.get(id);
        return s?.on && s.ready && (lb.spec.health ? (lb.health.get(id)?.ok ?? true) : true);
      }).length;
    }
    case "queue":
      return nodes(sim, m.nodes).reduce((s, n) => s + n.queue.length, 0);
    case "servers":
      return nodes(sim, m.nodes).filter((n) => n.on).length;
    case "moved": {
      const ns = nodes(sim, m.nodes);
      return ns.length ? Math.max(...ns.map((n) => n.moved)) : null;
    }
    case "amplify": {
      const l = sim.logical.count(sim.t);
      return l ? sim.attempts.count(sim.t) / l : null;
    }
    case "conflicts":
      return sim.conflicts;
    case "unsynced":
      return sim.blocked.length;
    case "jobWait": {
      const from = sim.t - sim.windowMs;
      return percentile(
        sim.jobs.filter((j) => j.t > from).map((j) => j.lat),
        0.95,
      );
    }
  }
}

export function formatMetric(m: MetricSpec, v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  switch (META[m.id].unit) {
    case "ms":
      return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(v < 10000 ? 1 : 0)} s`;
    case "pct": {
      const p = v * 100;
      if (p > 0 && p < 1) return "<1%";
      if (p < 100 && p > 99) return ">99%";
      return `${Math.round(p)}%`;
    }
    case "rate":
      return `${Math.round(v)}/s`;
    case "ratio":
      return `×${v.toFixed(1)}`;
    default:
      return `${Math.round(v)}`;
  }
}

export type Tone = "good" | "warn" | "bad" | "none";

/** Colour a value by how healthy it is. Latency is judged against the scene's target. */
export function toneOf(m: MetricSpec, v: number | null, sloMs: number): Tone {
  if (v === null) return "none";
  switch (m.id) {
    case "p50":
    case "p95":
      return v <= sloMs ? "good" : v <= sloMs * 2 ? "warn" : "bad";
    case "errors":
    case "stale":
      return v < 0.01 ? "good" : v < 0.05 ? "warn" : "bad";
    case "answered":
      return v > 0.99 ? "good" : v > 0.95 ? "warn" : "bad";
    case "hit":
      return v > 0.7 ? "good" : v > 0.4 ? "warn" : "bad";
    case "util":
    case "peak":
      return v < 0.7 ? "good" : v < 0.9 ? "warn" : "bad";
    case "moved":
      return v < 0.35 ? "good" : v < 0.6 ? "warn" : "bad";
    case "amplify":
      return v < 1.2 ? "good" : v < 1.8 ? "warn" : "bad";
    case "conflicts":
    case "unsynced":
      return v === 0 ? "good" : "warn";
    default:
      return "none";
  }
}

export function betterIs(m: MetricSpec): Better {
  return m.better ?? META[m.id].better;
}

/** Response times, which are judged against the scene's latency target (`sloMs`). */
export function isLatency(m: MetricSpec) {
  return m.id === "p50" || m.id === "p95";
}

/** A plain signed difference in the metric's own unit ("−1", "+52 ms", "+64 pts"), with no verdict. */
export function formatDiff(m: MetricSpec, d: number): string {
  const sign = d < 0 ? "−" : "+";
  const a = Math.abs(d);
  switch (META[m.id].unit) {
    case "ms":
      return `${sign}${formatMetric(m, a)}`;
    case "pct": {
      const p = a * 100;
      return `${sign}${p < 1 ? "<1" : Math.round(p)} pts`;
    }
    case "rate":
      return `${sign}${Math.round(a)}/s`;
    case "ratio":
      return `${sign}${a.toFixed(1)}`;
    default:
      return `${sign}${Math.round(a)}`;
  }
}

/**
 * A verdict row's change, relative to the first step: "−62%", "+38%", "−<1%" under half a percent, "×20" from ten
 * times up, "new" from zero.
 */
export function formatChange(from: number, to: number): string {
  if (from === 0) return "new";
  if (to / from >= 9.95) return `×${Math.round(to / from)}`;
  const pct = Math.round((Math.abs(to - from) / from) * 100);
  return `${to < from ? "−" : "+"}${pct < 1 ? "<1" : pct}%`;
}

/** How big a change is, from 0 to 1 (a doubling or more, or anything from zero, is 1): the length of its bar. */
export function changeSize(from: number, to: number): number {
  return from === 0 ? 1 : Math.min(1, Math.abs(to - from) / Math.abs(from));
}

/** How much simulated time one second of screen time shows: "1 s on screen = 100 ms". */
export function formatClock(timeScale: number, speed: number) {
  return `1 s on screen = ${Math.round(1000 * timeScale * speed)} ms`;
}

/** Simulated ms over which a link's flow settles: short enough that a link visibly empties while a breaker is open. */
const FLOW_TAU = 250;
const flows = new WeakMap<Sim, Map<string, { t: number; sent: number; failed: number; rate: number; errors: number }>>();

/**
 * Traffic on the link between `a` and `b` (either way round): requests a second, smoothed over about a quarter of a
 * simulated second, and the share of them that came back as errors. The stage reads it to light the rails.
 */
export function flowOf(sim: Sim, a: string, b: string): { rate: number; errors: number } {
  const key = a < b ? `${a}~${b}` : `${b}~${a}`;
  const now = sim.links.get(key) ?? { sent: 0, failed: 0 };
  let seen = flows.get(sim);
  if (!seen) flows.set(sim, (seen = new Map()));
  const was = seen.get(key);
  if (!was || sim.t < was.t) {
    // First look (or the scene restarted): start from the average so far rather than from nothing.
    const rate = sim.t > 0 ? (now.sent / sim.t) * 1000 : 0;
    const errors = now.sent ? now.failed / now.sent : 0;
    seen.set(key, { t: sim.t, sent: now.sent, failed: now.failed, rate, errors });
    return { rate, errors };
  }
  const dt = sim.t - was.t;
  if (dt > 0) {
    const w = 1 - Math.exp(-dt / FLOW_TAU);
    const sent = now.sent - was.sent;
    was.rate += ((sent / dt) * 1000 - was.rate) * w;
    if (sent > 0) was.errors += (Math.min(1, (now.failed - was.failed) / sent) - was.errors) * w;
    Object.assign(was, { t: sim.t, sent: now.sent, failed: now.failed });
  }
  return { rate: was.rate, errors: was.errors };
}
