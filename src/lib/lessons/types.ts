import type { Sim } from "../sim/engine";
import type { MetricSpec } from "../sim/metrics";
import type { SceneSpec } from "../sim/types";

export type Values = Record<string, number>;

export interface RangeKnob {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
}

export interface ChoiceKnob {
  id: string;
  label: string;
  options: { value: number; label: string }[];
  value: number;
}

export type Knob = RangeKnob | ChoiceKnob;

/** A fault the viewer can trigger, then undo. */
export interface Action {
  id: string;
  label: string;
  undo: string;
  run: (sim: Sim, on: boolean) => void;
  /** Read the fault's current state from the simulation (scripts can toggle it too). */
  isOn: (sim: Sim) => boolean;
}

export interface FigureDef {
  tone: "problem" | "fix" | "tradeoff" | "explore";
  /** Tab and column name, two words at most ("No cache", "With cache"). */
  short: string;
  title: string;
  caption: string;
  knobs?: Knob[];
  actions?: Action[];
  metrics: MetricSpec[];
  /** Label of the metric the lesson's claim is about. Defaults to the fix figure's first metric. */
  headline?: string;
  build: (v: Values) => SceneSpec;
}

export type LineId = "foundations" | "caching" | "data" | "async" | "resilience" | "capstone";

export interface Line {
  id: LineId;
  letter: string;
  name: string;
  blurb: string;
}

export interface Lesson {
  slug: string;
  code: string;
  line: LineId;
  title: string;
  why: string;
  figures: FigureDef[];
  takeaways: { use: string; catch: string; seen: string };
}

export function isChoice(k: Knob): k is ChoiceKnob {
  return "options" in k;
}

export function defaultsOf(f: FigureDef): Values {
  return Object.fromEntries((f.knobs ?? []).map((k) => [k.id, k.value]));
}

/** Build every step's scene. Each step sees the other steps' knob values too (e.g. the same celebrity traffic). */
export function buildSteps(figures: FigureDef[], values: Values[]) {
  const shared = Object.assign({}, ...values) as Values;
  return figures.map((f, i) => f.build({ ...shared, ...values[i] }));
}
