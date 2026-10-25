"use client";

import Link from "next/link";
import { COURSE, lessonsOn, liveLines, nextFor } from "@/lib/lessons";
import { ArrowIcon } from "./live";
import { useVisited } from "./visited";

/** The masthead's button: start at the first stop, or carry on after the last lesson opened. */
export function StartLink() {
  const { visited } = useVisited();
  const last = [...visited].pop() ?? null;
  const next = visited.size ? (nextFor(last, visited) ?? nextFor(null, visited)) : COURSE[0];
  if (!next)
    return (
      <a className="btn-primary" href="#route">
        Pick one to ride again <ArrowIcon />
      </a>
    );
  return (
    <Link className="btn-primary" href={`/learn/${next.slug}`} title={`${next.code} ${next.title}`}>
      {visited.size ? "Continue at" : "Start at"} {next.code} <ArrowIcon />
    </Link>
  );
}

/**
 * The lines as a short index under the masthead: each one's roundel and name, a pip per lesson (filled once visited),
 * and a link to its first lesson not yet opened.
 */
export function LineIndex() {
  const { visited } = useVisited();
  return (
    <ul className="line-index" aria-label="The lines">
      {liveLines().map((line) => {
        const stops = lessonsOn(line.id);
        const seen = stops.filter((s) => visited.has(s.slug)).length;
        const to = stops.find((s) => !visited.has(s.slug)) ?? stops[0];
        return (
          <li key={line.id} className={`line-${line.id}`}>
            {/* Its name starts with the words it shows, so a voice user can say what they see. */}
            <Link href={`/learn/${to.slug}`}>
              <span className="roundel-sm" aria-hidden="true">
                {line.letter}
              </span>
              <span className="li-name">{line.name}</span>
              <span className="sr-only">
                : {seen} of {stops.length} visited. {seen < stops.length ? "Next" : "First"}: {to.code} {to.title}
              </span>
              <span className="li-pips" aria-hidden="true">
                {stops.map((s) => (
                  <i key={s.slug} className={visited.has(s.slug) ? "on" : undefined} />
                ))}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
