import { getConcept, groups } from "./catalog";
import { getLesson } from "./lessons";
import {
  makeConfig,
  restoreExperiment,
  validateConfig,
  type Config,
} from "./engine/model";

export const SESSION_KEY = "system-lab-session-v1";
export type WorkspacePage =
  "lesson" | "library" | "journey" | "progress" | "cloud";
export type LessonDraft = {
  config: Config;
  cursor: number;
  mode: "guided" | "experiment";
  speed: number;
  aws: boolean;
  comparison: boolean;
  baselineA: Config | null;
  prediction: number | null;
  predictionSkipped: boolean;
  checked: boolean;
  controlsOpen: boolean;
  scenario: "baseline" | "contrast" | "failure" | "custom";
};
export type DraftUpdate = LessonDraft | ((draft: LessonDraft) => LessonDraft);
export type WorkspaceSession = {
  version: 1;
  page: WorkspacePage;
  lesson: string;
  drafts: Record<string, LessonDraft>;
  query: string;
  filter: string;
};
const pages: WorkspacePage[] = [
  "lesson",
  "library",
  "journey",
  "progress",
  "cloud",
];

export function defaultDraft(
  config: Config = makeConfig("cache-aside"),
): LessonDraft {
  return {
    config: validateConfig(config),
    cursor: 0,
    mode: "guided",
    speed: 1,
    aws: false,
    comparison: false,
    baselineA: null,
    prediction: null,
    predictionSkipped: false,
    checked: false,
    controlsOpen: false,
    scenario:
      JSON.stringify(config) === JSON.stringify(makeConfig(config.lesson))
        ? "baseline"
        : "custom",
  };
}

export function emptySession(): WorkspaceSession {
  return {
    version: 1,
    page: "lesson",
    lesson: "cache-aside",
    drafts: { "cache-aside": defaultDraft() },
    query: "",
    filter: "all",
  };
}

export function validateDraft(raw: unknown): LessonDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Unrecognized lesson draft.");
  const d = raw as LessonDraft,
    config = validateConfig(d.config);
  const baselineA = d.baselineA === null ? null : validateConfig(d.baselineA);
  if (
    !Number.isInteger(d.cursor) ||
    d.cursor < 0 ||
    d.cursor > 100000 ||
    !["guided", "experiment"].includes(d.mode) ||
    ![0.5, 1, 2, 4].includes(d.speed) ||
    ![d.aws, d.comparison, d.checked, d.controlsOpen].every(
      (value) => typeof value === "boolean",
    ) ||
    (d.predictionSkipped !== undefined &&
      typeof d.predictionSkipped !== "boolean") ||
    !["baseline", "contrast", "failure", "custom"].includes(d.scenario) ||
    (d.prediction !== null &&
      (!Number.isInteger(d.prediction) ||
        d.prediction < 0 ||
        d.prediction >= getLesson(config.lesson).challenge.options.length)) ||
    (baselineA && baselineA.lesson !== config.lesson)
  )
    throw new Error("Unrecognized lesson draft.");
  return {
    config,
    cursor: d.cursor,
    mode: d.mode,
    speed: d.speed,
    aws: d.aws,
    comparison: d.comparison,
    baselineA,
    prediction: d.prediction,
    predictionSkipped: d.predictionSkipped ?? false,
    checked: d.checked,
    controlsOpen: d.controlsOpen,
    scenario: d.scenario,
  };
}

export function parseSession(raw: unknown): WorkspaceSession {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Unrecognized workspace session.");
  const s = raw as WorkspaceSession;
  if (
    s.version !== 1 ||
    !pages.includes(s.page) ||
    !getConcept(s.lesson) ||
    !s.drafts ||
    typeof s.drafts !== "object" ||
    Array.isArray(s.drafts) ||
    Object.keys(s.drafts).length > 56 ||
    typeof s.query !== "string" ||
    s.query.length > 500 ||
    !(s.filter === "all" || groups.some((g) => g.id === s.filter))
  )
    throw new Error("Unrecognized workspace session.");
  const drafts: Record<string, LessonDraft> = {};
  for (const [id, rawDraft] of Object.entries(s.drafts)) {
    const draft = validateDraft(rawDraft);
    if (draft.config.lesson !== id || !getConcept(id))
      throw new Error("Lesson draft does not match its identifier.");
    drafts[id] = draft;
  }
  drafts[s.lesson] ||= defaultDraft(makeConfig(s.lesson));
  return {
    version: 1,
    page: s.page,
    lesson: s.lesson,
    drafts,
    query: s.query,
    filter: s.filter,
  };
}

export function readSession(
  storage: Pick<Storage, "getItem">,
): WorkspaceSession {
  const saved = storage.getItem(SESSION_KEY);
  return saved ? parseSession(JSON.parse(saved)) : emptySession();
}

export function saveSession(
  storage: Pick<Storage, "setItem">,
  session: WorkspaceSession,
) {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function visitSession(
  session: WorkspaceSession,
  page: WorkspacePage,
  lesson = session.lesson,
): WorkspaceSession {
  if (!getConcept(lesson) || !pages.includes(page))
    throw new Error("Unknown workspace destination.");
  return {
    ...session,
    page,
    lesson,
    drafts: {
      ...session.drafts,
      [lesson]: session.drafts[lesson] || defaultDraft(makeConfig(lesson)),
    },
  };
}

// Navigation identifies the draft. Shared experiment URLs import a fresh snapshot;
// canonicalizing afterwards lets refresh resume it without replaying that import.
export function restoreSessionRoute(
  session: WorkspaceSession,
  search: string,
): WorkspaceSession {
  const shared = restoreExperiment(search);
  if (shared)
    return {
      ...visitSession(session, "lesson", shared.lesson),
      drafts: { ...session.drafts, [shared.lesson]: defaultDraft(shared) },
    };
  const params = new URLSearchParams(search),
    lesson = params.get("lesson"),
    page = params.get("page");
  if (lesson === null && page === null) return session;
  return visitSession(
    session,
    (page ?? "lesson") as WorkspacePage,
    lesson ?? session.lesson,
  );
}

export function sessionQuery(
  session: Pick<WorkspaceSession, "page" | "lesson">,
) {
  const params = new URLSearchParams({ lesson: session.lesson });
  if (session.page !== "lesson") params.set("page", session.page);
  return `?${params}`;
}
