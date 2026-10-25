import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LessonPage } from "@/components/lesson-page";
import { termOf, type Term } from "@/lib/glossary";
import { COURSE, STORIES, getLesson, lessonsOn, lineOf, neighbours } from "@/lib/lessons";
import type { PageNav } from "@/lib/lessons/types";
import { SCENE_DEFS, STORY_DEFS, engineNeeds, partLessons } from "@/lib/lessons/all";
import { termsIn } from "@/lib/lessons/beats";
import { whyOf } from "@/lib/lessons/words";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

/** Every live lesson and story. Planned ones have no page until they are built. */
export function generateStaticParams() {
  return COURSE.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = getLesson((await params).slug);
  if (!lesson) return {};
  return { title: `${lesson.code} ${lesson.title}`, description: whyOf(lesson.slug) };
}

/** The glossary terms a lesson's text marks, anywhere in it: the page sends only these, not the whole glossary. */
function termsOf(slug: string): Term[] {
  const keys = new Set(termsIn(JSON.stringify(SCENE_DEFS[slug] ?? STORY_DEFS[slug] ?? {})));
  return [...keys].map((k) => termOf(k)).filter((t): t is Term => !!t);
}

/** A lesson or a story: the page picks its player by the catalog entry's kind, and loads only that one's code. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const meta = getLesson(slug);
  if (!meta) notFound();
  const nav: PageNav = {
    meta,
    line: lineOf(meta.line),
    stations: lessonsOn(meta.line),
    ...neighbours(slug),
    learn: partLessons(slug),
    rides: STORIES.filter((s) => s.requires?.includes(slug)),
  };
  return <LessonPage nav={nav} why={whyOf(slug)} terms={termsOf(slug)} needs={engineNeeds(slug)} />;
}
