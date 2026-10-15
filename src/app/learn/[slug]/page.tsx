import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Capstone } from "@/components/capstone";
import { LessonFigure } from "@/components/figure";
import { MarkVisited } from "@/components/route-map";
import { LESSONS, getLesson, lessonsOn, lineOf, neighbours } from "@/lib/lessons";

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
  const line = lineOf(lesson.line);
  const stops = lessonsOn(lesson.line);
  const { prev, next } = neighbours(slug);
  const capstone = lesson.line === "capstone";

  return (
    <article className={`lesson line-${line.id}`}>
      <MarkVisited slug={slug} />
      <header className="lesson-head wrap">
        <nav className="lesson-line" aria-label={`${line.name} line`}>
          <span className="roundel-sm" aria-hidden="true">
            {line.letter}
          </span>
          <span className="lesson-line-name">{line.name}</span>
          {!capstone && (
            <ol className="lesson-stops">
              {stops.map((s) => (
                <li key={s.slug}>
                  <Link href={`/learn/${s.slug}`} aria-current={s.slug === slug ? "page" : undefined} title={s.title}>
                    {s.code}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </nav>
        <h1 className="lesson-title">
          <span className="lesson-code">{lesson.code}</span>
          {lesson.title}
        </h1>
        <p className="lesson-why">{lesson.why}</p>
      </header>

      {capstone ? (
        <div className="wrap">
          <Capstone />
        </div>
      ) : (
        <div className="wrap figures">
          {lesson.figures.map((_, i) => (
            <LessonFigure key={i} slug={slug} index={i} />
          ))}
        </div>
      )}

      <section className="wrap takeaways" aria-label="Takeaways">
        <div>
          <h2>Use it when</h2>
          <p>{lesson.takeaways.use}</p>
        </div>
        <div>
          <h2>The catch</h2>
          <p>{lesson.takeaways.catch}</p>
        </div>
        <div>
          <h2>Seen in</h2>
          <p>{lesson.takeaways.seen}</p>
        </div>
      </section>

      <nav className="wrap next-stop" aria-label="Lesson navigation">
        {prev ? (
          <Link href={`/learn/${prev.slug}`} className={`stop-link prev line-${prev.line}`}>
            <span className="stop-dir">Previous stop</span>
            <span className="stop-title">
              <span className="stop-chip">{prev.code}</span>
              {prev.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/learn/${next.slug}`} className={`stop-link next line-${next.line}`}>
            <span className="stop-dir">Next stop</span>
            <span className="stop-title">
              <span className="stop-chip">{next.code}</span>
              {next.title}
            </span>
          </Link>
        ) : (
          <Link href="/#route" className="stop-link next line-capstone">
            <span className="stop-dir">End of the line</span>
            <span className="stop-title">Back to the route map</span>
          </Link>
        )}
      </nav>
    </article>
  );
}
