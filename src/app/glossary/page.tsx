import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/brand";
import { GLOSSARY } from "@/lib/glossary";
// A server page: reading every lesson here ships none of them to the browser.
import { ALL_LESSONS } from "@/lib/lessons/all";
import { beatsOf } from "@/lib/lessons/types";

export const metadata: Metadata = {
  title: "Glossary",
  description: "Every term the course names, in plain words, with the lesson that shows it.",
};

/** The lesson whose beats name a term first, in course order. */
function firstShown(key: string) {
  return ALL_LESSONS.find((l) => l.figures.some((f) => beatsOf(f).some((b) => b.term === key)));
}

export default function Glossary() {
  const terms = [...GLOSSARY.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <SiteHeader />
      <section className="wrap glossary" aria-labelledby="glossary-h">
        <p className="eyebrow">Glossary</p>
        <h1 id="glossary-h">The words, after the scene.</h1>
        <p className="lede">Each term is named in a lesson only once you have watched it happen. Here they all are, in plain words.</p>
        <dl className="glossary-list">
          {terms.map((t) => {
            const lesson = firstShown(t.key);
            return (
              <div key={t.key} id={t.key}>
                <dt>
                  {t.name}
                  {t.alias && <span className="glossary-alias">also {t.alias}</span>}
                </dt>
                <dd>
                  {t.short}
                  {lesson && (
                    <Link href={`/learn/${lesson.slug}`} className="glossary-where">
                      Shown in {lesson.code} {lesson.title}
                    </Link>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
      <SiteFooter />
    </>
  );
}
