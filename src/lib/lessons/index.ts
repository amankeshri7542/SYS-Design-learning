// The registry: the live course, read from the catalog. Metadata only, so the home page, the map and every page's bar
// can use it without loading a single scene. A lesson's scenes come from `scenes/` (`loadScene`), a story from
// `stories/` (`loadStory`); tests and scripts that want everything at once use `all.ts`.

import { CATALOG, FAST_LANE, LINES, PATH } from "./catalog";
import type { LessonMeta, Level, Line, LineId } from "./types";

export { CATALOG, FAST_LANE, LINES, PATH };

const bySlug = new Map(CATALOG.map((e) => [e.slug, e]));

/** Everything live, lessons and stories, in the order of the recommended path. */
export const COURSE: LessonMeta[] = PATH.map((s) => bySlug.get(s)).filter((e): e is LessonMeta => e?.status === "live");

/** The live lessons, in path order. */
export const LESSONS: LessonMeta[] = COURSE.filter((e) => e.kind === "lesson");

/** The live stories (journeys), in path order. */
export const STORIES: LessonMeta[] = COURSE.filter((e) => e.kind === "story");

/** Any catalog entry, live or planned. */
export function entryOf(slug: string): LessonMeta | undefined {
  return bySlug.get(slug);
}

/** A live lesson or story. */
export function getLesson(slug: string): LessonMeta | undefined {
  const e = bySlug.get(slug);
  return e?.status === "live" ? e : undefined;
}

export function lineOf(id: LineId): Line {
  return LINES.find((l) => l.id === id)!;
}

/** A line's live stations, in code order. */
export function lessonsOn(line: LineId): LessonMeta[] {
  return CATALOG.filter((e) => e.line === line && e.status === "live");
}

/** The lines with something live on them, in the map's order (journeys aside). */
export function liveLines(): Line[] {
  return LINES.filter((l) => l.id !== "stories" && lessonsOn(l.id).length);
}

/** The stops before and after a lesson on the recommended path. */
export function neighbours(slug: string): { prev?: LessonMeta; next?: LessonMeta } {
  const i = COURSE.findIndex((e) => e.slug === slug);
  return i < 0 ? {} : { prev: COURSE[i - 1], next: COURSE[i + 1] };
}

/** Where to go next: the first live stop after `slug` (or from the start) that hasn't been visited. */
export function nextFor(slug: string | null, visited: ReadonlySet<string>): LessonMeta | undefined {
  const from = slug ? COURSE.findIndex((e) => e.slug === slug) + 1 : 0;
  return COURSE.slice(from).find((e) => !visited.has(e.slug));
}

export function lessonsAt(level: Level): LessonMeta[] {
  return COURSE.filter((e) => e.level === level);
}

export function storyList(): LessonMeta[] {
  return STORIES;
}

/** What a lesson is best seen after. */
export function prerequisitesOf(slug: string): LessonMeta[] {
  return (bySlug.get(slug)?.requires ?? []).map((s) => bySlug.get(s)!).filter(Boolean);
}

/** Whether a lesson's prerequisites have all been visited (the map dims it until they have). Nothing is ever locked. */
export function isReady(slug: string, visited: ReadonlySet<string>): boolean {
  return prerequisitesOf(slug).every((p) => visited.has(p.slug));
}

/** The live entries of the interview fast lane, in order. */
export function fastLane(): LessonMeta[] {
  return FAST_LANE.map((s) => getLesson(s)).filter((e): e is LessonMeta => !!e);
}

export const LEVELS: { id: Level; name: string; zone: string }[] = [
  { id: "beginner", name: "Beginner", zone: "Zone 1" },
  { id: "intermediate", name: "Intermediate", zone: "Zone 2" },
  { id: "advanced", name: "Advanced", zone: "Zone 3" },
];
