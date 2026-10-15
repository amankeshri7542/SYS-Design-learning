import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CapstonePlayer } from "@/components/capstone";
import { LessonPlayer } from "@/components/player";
import { LESSONS, getLesson } from "@/lib/lessons";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return LESSONS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = getLesson((await params).slug);
  if (!lesson) return {};
  return { title: `${lesson.code} ${lesson.title}`, description: lesson.why };
}

export default async function LessonPage({ params }: Props) {
  const { slug } = await params;
  const lesson = getLesson(slug);
  if (!lesson) notFound();
  return slug === "capstone" ? <CapstonePlayer /> : <LessonPlayer slug={slug} />;
}
