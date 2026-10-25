import type { Sim } from "../sim/engine";
import type { MetricSpec } from "../sim/metrics";
import type { SceneSpec } from "../sim/types";
import { sequenceOf, type Beat, type Check, type DotKind, type Part, type Prediction, type TraceSpec } from "./beats";

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
  /**
   * The lesson's claim: the label of the metric it is about (defaults to the fix figure's first metric), and the
   * comparison read as one sentence with numbers (`{p95:problem}`), shown on the Recap. They are read as the beat
   * `at` fires (a moment the claim is about, such as a crash), or live when it has no such beat.
   */
  headline?: { metric: string; sentence: string; at?: string };
  build: (v: Values) => SceneSpec;
  /** Build lines: each part introduced in one line before the traffic starts (or, in a later step, as it arrives). */
  parts?: Part[];
  /** What to watch, in order: 3–6 beats. */
  beats?: Beat[];
  /** A guess the learner commits to before the break. */
  predict?: Prediction;
  /** The fault the learner causes: the beat `beat` waits until they press its button (or Next, which presses it). */
  break?: { action: string; beat: string };
  /** Beats after the step's last one, inviting the learner to turn a knob. */
  invite?: Beat[];
  /** The dot kinds this step shows, when they differ from the lesson's. */
  key?: DotKind[];
  /** Whose request "Follow one request" follows. Defaults to the scene's first client. */
  trace?: TraceSpec;
}

export type LineId = "networking" | "foundations" | "caching" | "data" | "async" | "resilience" | "operating" | "stories";

export interface Line {
  id: LineId;
  letter: string;
  name: string;
  blurb: string;
}

export type Level = "beginner" | "intermediate" | "advanced";

/**
 * A catalog entry (`catalog.ts`): what the home page, the route map and a page's metadata need, and none of its scenes.
 * Planned entries are the course still to be built: they hold their final code and their place on the path, but no
 * page exists for them yet.
 */
export interface LessonMeta {
  /** The stable key: URLs and the visited list use it. */
  slug: string;
  /** The display code. Frozen once assigned: `tests/catalog.snapshot.json` shows any change in review. */
  code: string;
  line: LineId;
  title: string;
  level: Level;
  /** Minutes it takes, end to end: 3–12 for a lesson, 15–25 for a story. */
  minutes: number;
  /** Slugs best seen first. A live entry lists only live ones. The map dims a station until they are visited. */
  requires?: string[];
  kind: "lesson" | "story";
  status: "live" | "planned";
  /** Old slugs that redirect here (`next.config.ts`). */
  aliases?: string[];
}

/**
 * What a lesson or story page needs of the catalog, sent by its server page so the page doesn't carry the catalog: its
 * entry, its line and that line's stations (the bar), and the stops before and after it on the path.
 */
export interface PageNav {
  meta: LessonMeta;
  line: Line;
  stations: LessonMeta[];
  prev?: LessonMeta;
  next?: LessonMeta;
  /** The lessons its station cards point to, by slug (`partLessons` in `all.ts`). */
  learn?: Record<string, { code: string; title: string }>;
}

/** An entry's words (`words.ts`): kept apart from its metadata, so a page carries only its own. */
export interface LessonWords {
  /** Why it matters, in one line (under 220 characters). */
  why: string;
  /** What people search for: the concept's other names, and the products in its "Seen in". */
  tags: string[];
}

/** A lesson's scenes and narration: the default export of `scenes/<slug>.ts`. */
export interface LessonScene {
  /** A question the learner has felt, ≤16 words, using no term the lesson teaches. */
  hook: string;
  /** The dot kinds the lesson shows: its local key. */
  dots: DotKind[];
  figures: FigureDef[];
  /** One or two questions on the Recap. */
  checks: Check[];
  /** `rule`: the lesson in ≤8 memorable words. `interview`: one line to say in an interview (advanced lessons). */
  takeaways: { use: string; catch: string; seen: string; rule: string; interview?: string };
}

/** A lesson whole: its catalog entry, its why and its scenes. */
export type Lesson = LessonMeta & LessonScene & { why: string };

export const withScene = (meta: LessonMeta, scene: LessonScene, why: string): Lesson => ({ ...meta, ...scene, why });

export function isChoice(k: Knob): k is ChoiceKnob {
  return "options" in k;
}

/** The metric a lesson's claim is about: the second figure's `headline`, or that figure's first metric. */
export function headlineOf(figures: FigureDef[]): string {
  const f = figures[1] ?? figures[0];
  return f.headline?.metric ?? f.metrics[0].label;
}

/**
 * Whether the lesson holds its traffic while the first step's parts are introduced. A scene with a warm-up opens
 * mid-flow on purpose (warm caches, say), so it doesn't.
 */
export function holdsTraffic(figures: FigureDef[]): boolean {
  const f = figures[0];
  return !!f?.parts?.length && !f.build(defaultsOf(f)).warmMs;
}

/** A step's narration in order: its build lines, its beats, then its invitations. */
export function beatsOf(f: FigureDef): Beat[] {
  return sequenceOf(f.parts, [...(f.beats ?? []), ...(f.invite ?? [])]);
}

export function defaultsOf(f: FigureDef): Values {
  return Object.fromEntries((f.knobs ?? []).map((k) => [k.id, k.value]));
}

/** Build every step's scene. Each step sees the other steps' knob values too (e.g. the same celebrity traffic). */
export function buildSteps(figures: FigureDef[], values: Values[]) {
  const shared = Object.assign({}, ...values) as Values;
  return figures.map((f, i) => f.build({ ...shared, ...values[i] }));
}
