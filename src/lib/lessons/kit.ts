import type { MetricSpec } from "../sim/metrics";
import type { Call, ClientSpec, NodeSpec, SceneSpec } from "../sim/types";
import type { Action, ChoiceKnob, RangeKnob } from "./types";

type At = [number, number];
type Opts = Partial<NodeSpec>;

/** Scene defaults: slowed 10×, latency target 400 ms, clients give up after 1.6 s. */
export function scene(nodes: NodeSpec[], extra: Partial<SceneSpec> = {}): SceneSpec {
  return {
    nodes,
    sloMs: 400,
    timeoutMs: 1600,
    timeScale: 0.1,
    msPerUnit: 0.9,
    windowMs: 700,
    seed: 11,
    ...extra,
  };
}

export const users = (id: string, at: At, client: ClientSpec, to: Call, o: Opts = {}): NodeSpec => ({
  id,
  kind: "client",
  label: "Users",
  at,
  client,
  to: [to],
  ...o,
});

export const server = (id: string, at: At, o: Opts = {}): NodeSpec => ({
  id,
  kind: "server",
  label: "App server",
  at,
  slots: 4,
  serviceMs: 100,
  ...o,
});

export const worker = (id: string, at: At, o: Opts = {}): NodeSpec => ({
  id,
  kind: "server",
  glyph: "worker",
  label: "Worker",
  at,
  slots: 1,
  serviceMs: 200,
  sink: true,
  ...o,
});

export const database = (id: string, at: At, o: Opts = {}): NodeSpec => ({
  id,
  kind: "db",
  label: "Database",
  at,
  slots: 4,
  serviceMs: 100,
  ...o,
});

export const cache = (id: string, at: At, origin: Call, o: Opts = {}): NodeSpec => ({
  id,
  kind: "cache",
  label: "Cache",
  at,
  to: [origin],
  capacity: 20,
  ...o,
});

export const balancer = (id: string, at: At, targets: Call[], o: Opts = {}): NodeSpec => ({
  id,
  kind: "lb",
  label: "Load balancer",
  at,
  to: targets,
  algo: "round-robin",
  ...o,
});

/** Spread n nodes across the flow, 12–88. */
export function lane(n: number, i: number) {
  return n === 1 ? 50 : 14 + (72 * i) / (n - 1);
}

export function range(n: number) {
  return Array.from({ length: n }, (_, i) => i);
}

/** Smooth rise and fall between lo and hi requests/s. */
export const wave = (lo: number, hi: number, period: number) => (t: number) =>
  lo + (hi - lo) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period));

/**
 * Steady traffic with a rush every `period` ms: starting `from` ms into each period, it swells smoothly to `peak` and
 * back over `length` ms, then holds at `base`.
 */
export const rush = (base: number, peak: number, from: number, length: number, period: number) => (t: number) => {
  const u = (((t - from) % period) + period) % period;
  return u < length ? base + (peak - base) * Math.sin((Math.PI * u) / length) ** 2 : base;
};

/** Quiet traffic with a short burst every `every` ms. */
export const bursts = (base: number, peak: number, every: number, length: number) => (t: number) =>
  t % every < length ? peak : base;

export const M = {
  p95: (o: Partial<MetricSpec> = {}): MetricSpec => ({
    id: "p95",
    label: "Response time",
    hint: "95% of requests are answered faster than this (the p95).",
    ...o,
  }),
  errors: (o: Partial<MetricSpec> = {}): MetricSpec => ({
    id: "errors",
    label: "Failed",
    hint: "Share of requests that got an error or gave up waiting.",
    ...o,
  }),
  busy: (nodes: string[], label = "Server busy", o: Partial<MetricSpec> = {}): MetricSpec => ({
    id: "util",
    label,
    nodes,
    hint: "Share of the workers that are occupied right now.",
    ...o,
  }),
  peak: (nodes: string[], label = "Busiest server"): MetricSpec => ({
    id: "peak",
    label,
    nodes,
    hint: "How occupied the most loaded machine is.",
  }),
  hit: (nodes: string[], label = "Cache hits"): MetricSpec => ({
    id: "hit",
    label,
    nodes,
    hint: "Share of reads answered straight from the cache.",
  }),
  load: (nodes: string[], label: string): MetricSpec => ({
    id: "load",
    label,
    nodes,
    hint: "Requests arriving per second (simulated time).",
  }),
  throughput: (o: Partial<MetricSpec> = {}): MetricSpec => ({
    id: "throughput",
    label: "Answered",
    hint: "Successful answers per second (simulated time).",
    ...o,
  }),
  stale: (o: Partial<MetricSpec> = {}): MetricSpec => ({
    id: "stale",
    label: "Stale reads",
    hint: "Reads that returned an out-of-date value.",
    ...o,
  }),
  queue: (nodes: string[], label = "Waiting"): MetricSpec => ({
    id: "queue",
    label,
    nodes,
    hint: "Items waiting in line right now.",
  }),
};

export const knob = (
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format?: (v: number) => string,
): RangeKnob => ({ id, label, min, max, step, value, format });

export const choice = (id: string, label: string, options: string[], value = 0): ChoiceKnob => ({
  id,
  label,
  options: options.map((o, i) => ({ value: i, label: o })),
  value,
});

export const perSecond = (v: number) => `${v}/s`;
export const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

export const crash = (id: string, name: string): Action => ({
  id: `crash-${id}`,
  label: `Crash ${name}`,
  undo: `Restore ${name}`,
  run: (sim, on) => sim.setUp(id, !on),
  isOn: (sim) => sim.nodes.get(id)?.up === false,
});
