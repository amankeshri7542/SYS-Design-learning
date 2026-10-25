// The learning record (docs/research/pedagogy.md §5): what a learner did, kept in this browser only. No identifiers, no
// network, and times to the second. A ring of the latest events, and a tally per lesson that the ring can't forget.
// Missing or blocked storage just means nothing is recorded.

export type RecordKind =
  | "open"
  | "tab"
  | "beat"
  | "predict"
  | "check"
  | "metric"
  | "term"
  | "part"
  | "trace"
  | "knob"
  | "fault"
  | "recap"
  | "next"
  | "feel"
  | "stage";

export interface RecordEvent {
  /** Seconds since 1970. */
  t: number;
  lesson: string;
  kind: RecordKind;
  data?: Record<string, string | number | boolean>;
}

/** One lesson's running totals. */
export interface Tally {
  opened: number;
  /** The beats seen, by step and id ("0:press"). */
  beats: string[];
  predicted: number;
  predictedRight: number;
  checks: number;
  checksRight: number;
  recap: boolean;
  /** A journey's stages cleared. */
  stages: number[];
  feel?: string;
}

export const EVENTS = "syslab.v1.events";
export const TALLIES = "syslab.v1.progress";
/** The most events kept: the oldest go first. */
export const MAX_EVENTS = 600;

let lesson = "";
let openedAt = 0;

/**
 * The page's lesson: what every event is about until another page sets its own. False when it is the same lesson set
 * again within a second (React runs a page's effects twice in development), so the open isn't counted twice.
 */
export function recordingFor(slug: string): boolean {
  const again = slug === lesson && Date.now() - openedAt < 1000;
  lesson = slug;
  if (!again) openedAt = Date.now();
  return !again;
}

/** Seconds since the page's lesson opened. */
export const secondsOpen = () => Math.round((Date.now() - openedAt) / 1000);

function read<T>(key: string, empty: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : empty;
  } catch {
    return empty;
  }
}

export const readEvents = () => read<RecordEvent[]>(EVENTS, []);
export const readTallies = () => read<Record<string, Tally>>(TALLIES, {});

const blank = (): Tally => ({ opened: 0, beats: [], predicted: 0, predictedRight: 0, checks: 0, checksRight: 0, recap: false, stages: [] });

/** Note what the learner just did, on the page's lesson. */
export function record(kind: RecordKind, data?: RecordEvent["data"]) {
  if (!lesson) return;
  try {
    const events = readEvents();
    events.push({ t: Math.floor(Date.now() / 1000), lesson, kind, ...(data ? { data } : {}) });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    window.localStorage.setItem(EVENTS, JSON.stringify(events));
    const tallies = readTallies();
    const t = { ...blank(), ...tallies[lesson] };
    if (kind === "open") t.opened++;
    if (kind === "beat" && !t.beats.includes(String(data?.at))) t.beats.push(String(data?.at));
    // A prediction counts once answered: a skipped one (no `chosen`) is only an event.
    if (kind === "predict" && typeof data?.chosen === "number") {
      t.predicted++;
      if (data?.correct) t.predictedRight++;
    }
    if (kind === "check") {
      t.checks++;
      if (data?.correct) t.checksRight++;
    }
    if (kind === "recap") t.recap = true;
    if (kind === "stage" && typeof data?.stage === "number" && !t.stages.includes(data.stage)) t.stages.push(data.stage);
    if (kind === "feel") t.feel = String(data?.feel);
    tallies[lesson] = t;
    window.localStorage.setItem(TALLIES, JSON.stringify(tallies));
  } catch {
    // Storage unavailable (private mode, blocked, full): this event simply isn't kept.
  }
}

/** Forget the record: the events and the tallies (the visited list is kept apart, in `progress.ts`). */
export function clearRecord() {
  try {
    window.localStorage.removeItem(EVENTS);
    window.localStorage.removeItem(TALLIES);
  } catch {
    // Nothing to clear.
  }
}
