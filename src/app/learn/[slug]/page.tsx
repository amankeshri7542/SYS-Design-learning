import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LessonPage } from "@/components/lesson-page";
import { COURSE, getLesson } from "@/lib/lessons";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

/** Every live lesson and story. Planned ones have no page until they are built. */
export function generateStaticParams() {
  return COURSE.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = getLesson((await params).slug);
  if (!lesson) return {};
  return { title: `${lesson.code} ${lesson.title}`, description: lesson.why };
}

/** A lesson or a story: the page picks its player by the catalog entry's kind, and loads only that one's code. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  if (!getLesson(slug)) notFound();
  return <LessonPage slug={slug} />;
}
