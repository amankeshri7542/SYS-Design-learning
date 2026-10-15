import { asyncLessons } from "./async";
import { cachingLessons } from "./caching";
import { dataLessons } from "./data";
import { foundations } from "./foundations";
import { resilienceLessons } from "./resilience";
import type { Lesson, Line, LineId } from "./types";

export const LINES: Line[] = [
  { id: "foundations", letter: "F", name: "Foundations", blurb: "How a request is served, and what happens when there are too many." },
  { id: "caching", letter: "C", name: "Caching", blurb: "Answer from a nearby copy instead of doing the work again." },
  { id: "data", letter: "D", name: "Data", blurb: "Copying and splitting data across machines, and what that costs." },
  { id: "async", letter: "A", name: "Async", blurb: "Do the work later, elsewhere, and survive the hiccups." },
  { id: "resilience", letter: "R", name: "Resilience", blurb: "Stay up when clients misbehave, dependencies hang and traffic swings." },
  { id: "capstone", letter: "★", name: "Capstone", blurb: "Put it all together under growing traffic and failures." },
];

export const CAPSTONE: Lesson = {
  slug: "capstone",
  code: "★",
  line: "capstone",
  title: "Keep a URL shortener alive",
  why: "Your link shortener is about to go from a side project to the front page. Grow the architecture one stage at a time and keep it fast through traffic surges, a viral link, a bot attack and a crash.",
  figures: [],
  takeaways: {
    use: "Add components when a real number tells you to: latency, errors, or a machine at 100%.",
    catch: "Every box you add can fail and costs money. The cheapest design that holds the target wins.",
    seen: "Bitly, TinyURL and every link-in-bio service run some version of this architecture.",
  },
};

export const LESSONS: Lesson[] = [...foundations, ...cachingLessons, ...dataLessons, ...asyncLessons, ...resilienceLessons, CAPSTONE];

export function getLesson(slug: string): Lesson | undefined {
  return LESSONS.find((l) => l.slug === slug);
}

export function lineOf(id: LineId): Line {
  return LINES.find((l) => l.id === id)!;
}

export function lessonsOn(line: LineId) {
  return LESSONS.filter((l) => l.line === line);
}

export function neighbours(slug: string) {
  const i = LESSONS.findIndex((l) => l.slug === slug);
  return { prev: LESSONS[i - 1], next: LESSONS[i + 1] };
}
