// Beats: a lesson's narration as data, and the runner that fires it. A beat says what to look at, points at it, and
// fires when the simulation reaches the moment it describes. Triggers read only simulated time and simulated events, so
// the same beats fire at the same moments on every machine and at every speed.

import type { Sim } from "../sim/engine";
import { formatMetric, measure, type MetricId, type MetricSpec } from "../sim/metrics";
import type { FxKind } from "../sim/types";

/** The dot kinds a scene shows: its local key. Shapes and colours are fixed (CLAUDE.md). */
export type DotKind = "req" | "late" | "ok" | "stale" | "turned" | "failed" | "gaveup" | "copy" | "job" | "probe" | "lost" | "ack" | "push" | "hand";

/** What a beat points at. What it names stays bright; the rest of the stage steps back. */
export interface Focus {
  /** Stations, by id. The first is where the callout points. */
  nodes?: string[];
  /** A rail, by the two stations it joins. */
  link?: [string, string];
  /** Which requests stay bright: the line waiting at the focused stations, or every dot of one kind. */
  dots?: "waiting" | "late" | "gaveup" | "stale" | "turned" | "failed";
  /** The focused stations' sockets (their workers) get an outline. */
  sockets?: boolean;
  /** A row of the comparison table, by label. */
  metric?: string;
  /** A knob, by id. */
  knob?: string;
  /** A fault button, by action id. */
  action?: string;
}

/** When a beat fires. Every trigger reads the simulation only. */
export type BeatTrigger =
  /** Simulated ms after the step's traffic began (after its parts were introduced). */
  | { at: number }
  /** Simulated ms after the previous beat. */
  | { wait: number }
  /** The `nth` time (default 1) this effect happens, at a station or anywhere, since the previous beat. */
  | { fx: FxKind; node?: string; nth?: number }
  /**
   * A script event with this label happened since the step began (or, with `since: "lesson"`, at any time), and no
   * earlier beat of the step has used it.
   */
  | { note: string; since?: "lesson" }
  /**
   * A metric crosses a value (and stays across it for `forMs` simulated ms), in this step's world or, with `world`, in
   * another step's (the moment the problem world stampedes, say).
   */
  | { metric: MetricSpec; is: ">" | "<"; value: number; forMs?: number; world?: number }
  /** As soon as the step is shown. */
  | { step: "enter" };

export interface Beat {
  /** Unique within the lesson: predictions, the break and tests refer to beats by id. */
  id: string;
  when: BeatTrigger;
  /**
   * ≤16 words, verb first. `[[term|plain words]]` marks a glossary term; `{p95:fix}`, `{util:db:problem}`, `{queue:app}`
   * read a number from the simulation at the moment the beat fires.
   */
  text: string;
  focus?: Focus;
  /** Hold both worlds still until the learner moves on. */
  pause?: boolean;
  /** The glossary term this beat names (its first use in the lesson). */
  term?: string;
  /** Start following one request as this beat fires (the step's `trace` client's next one). */
  follow?: true;
  /** A build line: introduces a part before (or as) the traffic runs. Set by the runner, not by lessons. */
  part?: true;
}

/** A build line: a part of the scene and what it does, with a number. "Server: 4 workers, 120 ms each." */
export interface Part {
  node: string | string[];
  text: string;
  /** Point at the part's sockets (its workers) rather than the whole station. */
  sockets?: boolean;
}

/** Commit to an outcome before seeing it. */
export interface Prediction {
  prompt: string;
  /** Two or three; the wrong ones are the common misconceptions. */
  options: string[];
  answer: number;
  /** The beat the question comes before (or "end": after the step's last beat). The scene waits there until it is answered or skipped. */
  before: string;
  /** The beat that settles it (in any step of the lesson), and the line it adds under the card. */
  reveal: { beat: string; text: string };
  /**
   * A number noted when the question is asked (in `world`, default the asking step's) and again at the reveal (in
   * `afterWorld`, default the same): `{before}` and `{after}` in the line. With `same`, both are read at the reveal: a
   * comparison of two worlds at one moment.
   */
  track?: { metric: MetricSpec; world?: number; afterWorld?: number; same?: boolean };
  /** The engine agrees with the answer. The tests check it at the moment the reveal beat fires. */
  holds: (before: number | null, after: number | null) => boolean;
}

/** A question on the Recap. Its line of feedback is the same for right and wrong answers. */
export interface Check {
  prompt: string;
  options: string[];
  answer: number;
  /** ≤25 words. */
  why: string;
  /** Spotlit on the stage after a wrong answer. */
  focus?: Focus;
}

/** "Follow one request": which client's next request to follow. */
export interface TraceSpec {
  client: string;
}

/**
 * How long things stay on screen, in real ms at 1×. The runner turns them into simulated ms with the scene's time
 * scale, so they stretch and shrink with the speed like everything else.
 */
export const PACE = {
  /** Before the first build line: the scene's intro lands first. */
  first: 600,
  /** Between build lines. */
  part: 1800,
  /** The least a beat stays before the next one may replace it. */
  read: 3000,
} as const;

/** A beat that has fired: where it is in the step, when it fired, and its text with every number filled in then. */
export interface Fired {
  beat: Beat;
  index: number;
  t: number;
  text: string;
}

export interface RunnerOptions {
  /** The scene's simulated ms per real ms at 1×. */
  timeScale: number;
  /** Fill in a beat's numbers at the moment it fires. */
  fill?: (text: string) => string;
  /** The id of the beat the prediction comes before: the runner waits there until `answer()`. */
  askBefore?: string;
  /** Called once, when the build lines are done and the traffic should begin. */
  onStart?: () => void;
}

/** A step's sequence: its build lines (as beats), then its beats. */
export function sequenceOf(parts: Part[] = [], beats: Beat[] = []): Beat[] {
  const built: Beat[] = parts.map((p, i) => {
    const nodes = Array.isArray(p.node) ? p.node : [p.node];
    return { id: `part-${i}`, when: i === 0 ? { at: 0 } : { wait: 0 }, text: p.text, focus: { nodes, sockets: p.sockets }, part: true };
  });
  return [...built, ...beats];
}

/**
 * Fires a step's beats in order. Call `tick(sim)` on a fixed grid of simulated time: a beat fires at the first grid
 * point where its trigger holds, once the beat before it has had its moment (`PACE.read`) or the learner moved on.
 * Nothing here reads a clock or the screen.
 */
export class BeatRunner {
  readonly beats: Beat[];
  readonly fired: Fired[] = [];
  /** Waiting for the learner: on a beat that pauses, or at the prediction. */
  waiting: "beat" | "ask" | null = null;
  private entry: number | null = null;
  /** When the step's traffic began: `at` triggers count from here. */
  private origin: number | null = null;
  private lastT = 0;
  /** When the current beat has had its moment and the next may replace it. */
  private readAt = 0;
  /** The effect that fired the previous beat, so it can't fire the next one too. */
  private lastEvent: unknown = null;
  /** Script events earlier beats of this step have used. */
  private usedNotes = new Set<unknown>();
  private holdSince: number | null = null;
  private answered = false;

  constructor(
    beats: Beat[],
    private opts: RunnerOptions,
  ) {
    this.beats = beats;
  }

  get next(): Beat | undefined {
    return this.beats[this.fired.length];
  }

  get current(): Fired | undefined {
    return this.fired[this.fired.length - 1];
  }

  /** Every beat has fired, nothing waits for the learner, and no question is still to come. */
  get done() {
    return this.fired.length >= this.beats.length && !this.waiting && (this.opts.askBefore !== "end" || this.answered);
  }

  /** The prediction has been answered or skipped. */
  get asked() {
    return this.answered;
  }

  get started() {
    return this.origin !== null;
  }

  /** Simulated ms in real ms at 1×. */
  private sim(ms: number) {
    return ms * this.opts.timeScale;
  }

  /**
   * Look at the world once. `rushed` means the learner asked for the next beat: it fires as soon as its trigger holds,
   * without waiting for the previous one's moment. Returns the beat that fired, if one did.
   */
  tick(sim: Sim, rushed = false, worlds: Sim[] = [sim]): Fired | null {
    if (this.entry === null) this.entry = this.lastT = sim.t;
    if (this.waiting) return null;
    const beat = this.next;
    const settled = rushed || !this.fired.length || sim.t >= this.readAt;
    if (this.origin === null && !beat?.part) {
      // Every part has been introduced: the traffic begins once the last one has had its moment.
      if (!settled) return null;
      this.origin = sim.t;
      this.opts.onStart?.();
    }
    if ((beat?.id ?? "end") === this.opts.askBefore && !this.answered) {
      if (settled) this.waiting = "ask";
      return null;
    }
    if (!beat) return null;
    if (!settled || !this.ready(beat, sim, worlds)) return null;
    return this.fire(beat, sim);
  }

  /** The learner moved on from a paused beat: they have read it, so the next may follow at once. */
  release() {
    if (this.waiting !== "beat") return;
    this.waiting = null;
    this.readAt = -Infinity;
  }

  /** Fire the next beat now, whether or not its moment has come (the learner pressed Next and it never came). */
  skip(sim: Sim): Fired | null {
    if (this.waiting || !this.next) return null;
    if (this.origin === null) {
      this.origin = sim.t;
      this.opts.onStart?.();
    }
    return this.fire(this.next, sim);
  }

  /** The prediction was answered (or skipped): the beats carry on. */
  answer() {
    this.answered = true;
    if (this.waiting === "ask") this.waiting = null;
  }

  private ready(b: Beat, sim: Sim, worlds: Sim[]): boolean {
    const w = b.when;
    if ("step" in w) return true;
    if ("at" in w) return sim.t >= (b.part ? this.entry! + this.sim(PACE.first) : this.origin!) + w.at;
    if ("wait" in w) return sim.t >= this.lastT + w.wait;
    if ("note" in w) {
      // Since the step began, not since the previous beat: the event may happen while that beat is still on screen.
      const n = sim.notes.find((x) => (w.since === "lesson" || x.t >= this.entry!) && !this.usedNotes.has(x) && x.text === w.note);
      if (n) this.usedNotes.add(n);
      return !!n;
    }
    if ("fx" in w) {
      const seen = sim.fx.filter((f) => f.t >= this.lastT && f !== this.lastEvent && f.kind === w.fx && (!w.node || f.node === w.node));
      const n = seen[(w.nth ?? 1) - 1];
      if (n) this.lastEvent = n;
      return !!n;
    }
    const v = measure(w.world === undefined ? sim : (worlds[w.world] ?? sim), w.metric);
    if (v === null || !(w.is === ">" ? v > w.value : v < w.value)) {
      this.holdSince = null;
      return false;
    }
    this.holdSince ??= sim.t;
    return sim.t - this.holdSince >= (w.forMs ?? 0);
  }

  private fire(beat: Beat, sim: Sim): Fired {
    const f: Fired = { beat, index: this.fired.length, t: sim.t, text: this.opts.fill ? this.opts.fill(beat.text) : beat.text };
    this.fired.push(f);
    this.lastT = sim.t;
    this.readAt = sim.t + this.sim(beat.part ? PACE.part : PACE.read);
    this.holdSince = null;
    if (!("fx" in beat.when)) this.lastEvent = null;
    if (beat.pause) this.waiting = "beat";
    return f;
  }
}

/** Beats are looked for every this many simulated ms: the same moments at every speed and frame rate. */
export const GRID = 10;

/**
 * Step every world by `ms` in lockstep. With `at`, stop at each multiple of `GRID` simulated ms on the way and call it;
 * when it returns true, stop there. Returns true when it stopped early.
 */
export function stepGrid(list: Sim[], ms: number, at?: (sims: Sim[]) => boolean): boolean {
  if (!at || !list.length) {
    for (const s of list) s.step(ms);
    return false;
  }
  const end = list[0].now + ms;
  for (;;) {
    const grid = (Math.floor(list[0].t / GRID) + 1) * GRID;
    if (grid > end) {
      const rest = end - list[0].now;
      if (rest > 0) for (const s of list) s.step(rest);
      return false;
    }
    // A hair past the grid point, so float rounding never leaves the last tick undone.
    const d = grid - list[0].now + 1e-6;
    for (const s of list) s.step(d);
    if (at(list)) return true;
  }
}

// ------------------------------------------------------------------------------------------------ text

/** World names a number can be read from: the first step of that tone, or a step by its number. */
const WORLDS = ["problem", "fix", "explore", "tradeoff", "1", "2", "3"] as const;

export interface FillContext {
  sims: Sim[];
  /** Each step's tone, to find "problem" and "fix". */
  tones: string[];
  /** The lesson's metrics: `{p95}` uses the lesson's own response-time row (with its tag, if any). */
  metrics: MetricSpec[];
  /** The world a number with no world named is read from. */
  current: number;
  /** `{before}` and `{after}`: a prediction's noted numbers, already formatted. */
  marks?: Record<string, string>;
}

const PLACEHOLDER = /\{(\w+)(?::([\w-]+))?(?::([\w-]+))?\}/g;

/** Which world a placeholder names, by tone or by step number. -1 when it names none that exists. */
function worldOf(name: string | undefined, ctx: Pick<FillContext, "tones" | "current">) {
  if (!name) return ctx.current;
  if (/^\d$/.test(name)) return Number(name) - 1 < ctx.tones.length ? Number(name) - 1 : -1;
  return ctx.tones.indexOf(name);
}

/**
 * The metric a placeholder reads: the lesson's own when it has one of that kind, for the node or the group of users
 * (a tag) if one is named.
 */
export function metricFor(id: string, node: string | undefined, metrics: MetricSpec[]): MetricSpec {
  const own = metrics.find((m) => m.id === id && (!node ? !m.tag : (m.nodes?.length === 1 && m.nodes[0] === node) || m.tag === node));
  return own ?? { id: id as MetricId, label: id, ...(node ? { nodes: [node] } : {}) };
}

/** Split a placeholder into the metric it reads, the node it names and the world it reads from. */
export function parsePlaceholder(id: string, a: string | undefined, b: string | undefined) {
  const world = b ?? (a && (WORLDS as readonly string[]).includes(a) ? a : undefined);
  const node = a && a !== world ? a : undefined;
  return { id, node, world };
}

/** Every `{…}` in a text, parsed. */
export function placeholdersIn(text: string) {
  return [...text.matchAll(PLACEHOLDER)].map((m) => ({ raw: m[0], ...parsePlaceholder(m[1], m[2], m[3]) }));
}

/** Fill in a text's numbers from the simulations, now. */
export function fillIn(text: string, ctx: FillContext): string {
  return text.replace(PLACEHOLDER, (raw, id: string, a?: string, b?: string) => {
    if (id === "before" || id === "after") return ctx.marks?.[id] ?? "—";
    const p = parsePlaceholder(id, a, b);
    const i = worldOf(p.world, ctx);
    const sim = ctx.sims[i];
    if (!sim) return "—";
    const m = metricFor(p.id, p.node, ctx.metrics);
    return formatMetric(m, measure(sim, m));
  });
}

/** Can every placeholder in the text be read in this lesson? Returns the ones that can't. */
export function unresolved(text: string, ctx: Pick<FillContext, "tones" | "current"> & { nodes: Set<string>[]; tags?: Set<string> }): string[] {
  const ids = new Set<string>(["p50", "p95", "errors", "rejected", "stale", "fallback", "throughput", "hit", "util", "peak", "load", "inRotation", "queue", "servers", "moved", "amplify", "conflicts", "answered", "jobWait", "unsynced", "p99", "wasted", "lost", "availability", "budget", "wire", "wait", "work", "filtered", "duplicates", "redelivered", "deadLettered", "lostJobs", "lostEvents", "reordered", "consumed", "connections", "handshakes", "sendWait", "window", "pageMs", "pushLag", "reach", "empty", "detectMs", "falseAlarms", "lostAcked"] satisfies MetricId[]);
  return placeholdersIn(text)
    .filter((p) => {
      if (p.id === "before" || p.id === "after") return false;
      const i = worldOf(p.world, ctx);
      return !ids.has(p.id) || i < 0 || (!!p.node && !ctx.nodes[i]?.has(p.node) && !ctx.tags?.has(p.node));
    })
    .map((p) => p.raw);
}

/** `[[key|plain words]]` and `[[key]]`: glossary terms in a text. */
export const TERM = /\[\[([\w-]+)(?:\|([^\]]+))?\]\]/g;

/** Every glossary term a text marks, in order. */
export function termsIn(text: string): string[] {
  return [...text.matchAll(TERM)].map((m) => m[1]);
}

/** A text as a reader sees it: terms as their plain words, placeholders as one word each. */
export function plainText(text: string, name: (key: string) => string = (k) => k.replace(/-/g, " ")): string {
  return text.replace(TERM, (_, key: string, plain?: string) => plain ?? name(key)).replace(PLACEHOLDER, "#");
}

/** Words in a text as a reader sees it. */
export function wordCount(text: string) {
  return plainText(text).trim().split(/\s+/).filter(Boolean).length;
}
