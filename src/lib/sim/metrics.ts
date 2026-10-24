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
  | "unsynced"
  | "p99"
  | "wasted"
  | "lost"
  | "availability"
  | "budget"
  | "wire"
  | "wait"
  | "work"
  | "filtered"
  | "duplicates"
  | "redelivered"
  | "deadLettered"
  | "lostJobs"
  | "lostEvents"
  | "reordered"
  | "consumed";

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
  /**
   * What the number is judged against, in its own unit (ms for times, 0–1 for shares). Response times default to the
   * scene's latency target; other metrics have none unless a lesson gives one.
   */
  target?: number;
  /** The number read as a sentence, for the row's explainer. Defaults to a sentence for the metric's kind. */
  explain?: (v: number | null, sim: Sim) => string;
}

/** Which direction is good news. Neutral metrics (how many servers are in use) never get a verdict. */
export type Better = "low" | "high" | "neutral";

type Unit = "ms" | "pct" | "rate" | "count" | "ratio" | "nines";

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
  p99: { unit: "ms", better: "low" },
  wasted: { unit: "pct", better: "low" },
  lost: { unit: "pct", better: "low" },
  availability: { unit: "nines", better: "high" },
  budget: { unit: "pct", better: "high" },
  wire: { unit: "ms", better: "low" },
  wait: { unit: "ms", better: "low" },
  work: { unit: "ms", better: "low" },
  filtered: { unit: "pct", better: "high" },
  duplicates: { unit: "count", better: "low" },
  redelivered: { unit: "count", better: "neutral" },
  deadLettered: { unit: "count", better: "neutral" },
  lostJobs: { unit: "count", better: "low" },
  lostEvents: { unit: "pct", better: "low" },
  reordered: { unit: "count", better: "low" },
  consumed: { unit: "rate", better: "high" },
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
    case "p99":
      return percentile(
        recent(sim, m).filter((d) => d.result !== "rejected").map((d) => d.lat),
        m.id === "p50" ? 0.5 : m.id === "p95" ? 0.95 : 0.99,
      );
    case "wire":
    case "wait":
    case "work": {
      // Where an answered request's time went, on average: the three add up to its whole time.
      const d = recent(sim, m).filter((x) => x.result !== "error" && x.result !== "rejected");
      return d.length ? d.reduce((s, x) => s + x[m.id as "wire" | "wait" | "work"], 0) / d.length : null;
    }
    case "wasted": {
      const from = sim.t - sim.windowMs;
      let all = 0;
      let lost = 0;
      for (const w of sim.workLog) {
        if (w.t <= from) continue;
        all += w.ms;
        if (w.wasted) lost += w.ms;
      }
      return all ? lost / all : null;
    }
    case "lost": {
      const all = sim.crossings.count(sim.t);
      return all ? sim.lostCrossings.count(sim.t) / all : null;
    }
    case "availability": {
      const all = sim.sloAll.count(sim.t);
      return all ? sim.sloGood.count(sim.t) / all : null;
    }
    case "budget": {
      // The error budget left: 1 while every answer is good, 0 once the misses reach what the target allows.
      const all = sim.sloAll.count(sim.t);
      if (!all) return null;
      const bad = 1 - sim.sloGood.count(sim.t) / all;
      const allowed = 1 - (sim.spec.sloTarget ?? 0.999);
      return Math.max(0, 1 - bad / allowed);
    }
    case "filtered": {
      let f = 0;
      let all = 0;
      for (const n of nodes(sim, m.nodes)) {
        f += n.filtered.count(sim.t);
        all += n.arrivals.count(sim.t);
      }
      return all ? f / all : null;
    }
    case "duplicates": {
      // Messages done a second time, at the nodes named (or anywhere), over the window.
      const at = m.nodes ? nodes(sim, m.nodes) : sim.list;
      return at.reduce((sum, n) => sum + n.dupes.count(sim.t), 0);
    }
    case "redelivered":
      return sim.redelivered.count(sim.t);
    case "deadLettered":
      return sim.deadLettered.count(sim.t);
    case "lostJobs":
      return sim.lostJobs.count(sim.t);
    case "reordered":
      return sim.reordered.count(sim.t);
    case "consumed": {
      const from = sim.t - sim.windowMs;
      return (sim.jobs.filter((j) => j.t > from).length * 1000) / sim.windowMs;
    }
    case "lostEvents": {
      // Of the writes `nodes[0]` committed a while ago (long enough for their event to arrive), the share whose event
      // `nodes[1]` never finished.
      const [src, dst] = nodes(sim, m.nodes);
      if (!src || !dst) return null;
      const got = new Set([...dst.done.values()].map((d) => d.id));
      const until = sim.t - 2000;
      const from = until - sim.windowMs * 4;
      let all = 0;
      let lost = 0;
      for (const d of src.done.values()) {
        if (d.t <= from || d.t > until) continue;
        all++;
        if (!got.has(d.id)) lost++;
      }
      return all ? lost / all : null;
    }
    case "errors":
      return share(sim, m, (r) => r === "error");
    case "rejected":
      return share(sim, m, (r) => r === "rejected");
    case "fallback":
      return share(sim, m, (r) => r === "fallback");
    case "answered": {
      const s = share(sim, m, (r) => r !== "error" && r !== "rejected");
      // Requests went out for a whole window and none came back: that is no answers at all, not "no data".
      if (s === null && !m.tag && sim.t >= sim.windowMs * 2 && sim.logical.count(sim.t) > 0) return 0;
      return s;
    }
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
    case "nines": {
      // Availability shows its nines: 99.9% is not 100%.
      const p = v * 100;
      if (p >= 100) return "100%";
      return `${p >= 99.99 ? "99.99" : p >= 99.9 ? p.toFixed(2) : p >= 99 ? p.toFixed(1) : Math.round(p)}%`;
    }
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
    case "p99":
      return v <= sloMs ? "good" : v <= sloMs * 2 ? "warn" : "bad";
    case "availability":
      return v >= 0.999 ? "good" : v >= 0.99 ? "warn" : "bad";
    case "budget":
      return v > 0.5 ? "good" : v > 0 ? "warn" : "bad";
    case "wasted":
    case "lost":
    case "lostEvents":
      return v < 0.02 ? "good" : v < 0.1 ? "warn" : "bad";
    case "duplicates":
    case "lostJobs":
    case "reordered":
      return v === 0 ? "good" : v < 3 ? "warn" : "bad";
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
  return m.id === "p50" || m.id === "p95" || m.id === "p99";
}

/** What a metric is judged against, if anything: its own target, or for a response time the scene's latency target. */
export function targetOf(m: MetricSpec, sloMs: number): number | null {
  return m.target ?? (isLatency(m) ? sloMs : null);
}

/** "target ≤ 400 ms" or "target ≥ 99%", or null for a metric with no target. */
export function formatTarget(m: MetricSpec, sloMs: number): string | null {
  const t = targetOf(m, sloMs);
  if (t === null) return null;
  return `target ${betterIs(m) === "high" ? "≥" : "≤"} ${formatMetric(m, t)}`;
}

const SAYS: Record<MetricId, (v: string) => string> = {
  p50: (v) => `Half of all requests are answered within ${v}.`,
  p95: (v) => `The slowest 1 in 20 requests takes ${v} or longer; the rest are faster.`,
  errors: (v) => `${v} of requests failed or gave up waiting.`,
  rejected: (v) => `${v} of requests were turned away on purpose.`,
  stale: (v) => `${v} of answers were out of date.`,
  fallback: (v) => `${v} were answered at once with a fallback instead of waiting.`,
  throughput: (v) => `${v}: answers coming back each second.`,
  hit: (v) => `${v} of reads were answered by the cache, without asking further.`,
  util: (v) => `${v} of the workers are busy. Past about 70%, a line starts to form.`,
  peak: (v) => `The busiest machine is ${v} busy.`,
  load: (v) => `${v} arriving each second.`,
  inRotation: (v) => `${v} servers are getting traffic.`,
  queue: (v) => `${v} waiting in line right now.`,
  servers: (v) => `${v} servers are running, and costing money.`,
  moved: (v) => `${v} of keys changed owner at the last change of members.`,
  amplify: (v) => `${v} attempts for every real request. ×1.0 means retries add no load.`,
  conflicts: (v) => `${v} keys were written on both sides while the link was down.`,
  answered: (v) => `${v} of requests got a real answer in the end.`,
  jobWait: (v) => `The slowest 1 in 20 jobs takes ${v} or longer to finish.`,
  unsynced: (v) => `${v} writes are waiting to be copied across.`,
  p99: (v) => `The slowest 1 in 100 requests takes ${v} or longer; the rest are faster.`,
  wasted: (v) => `${v} of the workers' time went to requests whose caller had already given up.`,
  lost: (v) => `${v} of the messages sent were lost on the way.`,
  availability: (v) => `${v} of requests were answered, and on time, over the long window.`,
  budget: (v) => `${v} of the error budget is left: the misses the target allows before it is broken.`,
  wire: (v) => `${v} on average spent travelling over links.`,
  wait: (v) => `${v} on average spent waiting in line.`,
  work: (v) => `${v} on average spent being worked on.`,
  filtered: (v) => `${v} of lookups were for keys that don't exist, answered by the existence check.`,
  duplicates: (v) => `${v} messages were done a second time in the window.`,
  redelivered: (v) => `${v} jobs were handed out again because no ack came back in time.`,
  deadLettered: (v) => `${v} jobs were given up on and moved to the dead-letter queue.`,
  lostJobs: (v) => `${v} jobs were accepted and then lost, never done.`,
  lostEvents: (v) => `${v} of saved orders never reached the service that needed to hear about them.`,
  reordered: (v) => `${v} jobs finished before an earlier job for the same key.`,
  consumed: (v) => `${v}: jobs finished each second.`,
};

/**
 * The number read as plain sentences: what it says right now, what it is judged against, and over how much time it is
 * measured (which is why it lags the scene a little).
 */
export function explainMetric(m: MetricSpec, v: number | null, sim: Sim): string[] {
  const now = v === null ? "Nothing has been measured yet." : (m.explain?.(v, sim) ?? SAYS[m.id](formatMetric(m, v)));
  const target = targetOf(m, sim.spec.sloMs);
  const onScreen = sim.windowMs / (sim.spec.timeScale ?? 0.1) / 1000;
  return [
    now,
    ...(target === null ? [] : [`The target is ${formatMetric(m, target)} or ${betterIs(m) === "high" ? "more" : "less"}.`]),
    `Averaged over the last ${sim.windowMs} ms, which is ${Number.isInteger(onScreen) ? onScreen : onScreen.toFixed(1)} s on screen at 1×.`,
  ];
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
    case "nines":
      return `${sign}${(a * 100).toFixed(a < 0.01 ? 2 : 1)} pts`;
    default:
      return `${sign}${Math.round(a)}`;
  }
}

/**
 * A verdict row's change, relative to the first step: "−62%", "+38%", "−<1%" under half a percent, "×20" from ten
 * times up, "new" from zero.
 */
export function formatChange(from: number, to: number): string {
  // From nothing (or from so little that a ratio would mean nothing): "new".
  if (Math.abs(from) < 1e-6 * Math.max(1, Math.abs(to))) return "new";
  if (to / from >= 9.95) return `×${Math.round(to / from)}`;
  const pct = Math.round((Math.abs(to - from) / from) * 100);
  return `${to < from ? "−" : "+"}${pct < 1 ? "<1" : pct}%`;
}

/** How big a change is, from 0 to 1 (a doubling or more, or anything from zero, is 1): the length of its bar. */
export function changeSize(from: number, to: number): number {
  return Math.abs(from) < 1e-6 * Math.max(1, Math.abs(to)) ? 1 : Math.min(1, Math.abs(to - from) / Math.abs(from));
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
