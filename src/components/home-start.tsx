"use client";

import Link from "next/link";
import { COURSE, lessonsOn, liveLines, nextFor } from "@/lib/lessons";
import type { LessonMeta } from "@/lib/lessons/types";
import { ArrowIcon } from "./live";
import { useVisited } from "./visited";

/** The first ride: the path's first five stops, about twenty minutes from a request to finding a server. */
const RIDE = COURSE.slice(0, 5);
const RIDE_NAME = "How the web answers you";

/**
 * Where to start. A first visit (or one still on it) sees the first ride: five named stops on a short line and a
 * button that names the next one and how long it takes. Once the ride is done, the button carries on along the path,
 * and the lines show how far along each one is.
 */
export function Start() {
  const { visited, ready } = useVisited();
  const rideDone = ready && RIDE.every((s) => visited.has(s.slug));
  if (rideDone) {
    const last = [...visited].pop() ?? null;
    const next = nextFor(last, visited) ?? nextFor(null, visited);
    return (
      <>
        <div className="cta">
          {next ? (
            <Link className="btn-primary" href={`/learn/${next.slug}`}>
              Continue: {next.title}
              <span className="cta-min">{next.minutes} min</span>
              <ArrowIcon />
            </Link>
          ) : (
            <a className="btn-primary" href="#route">
              Pick one to ride again <ArrowIcon />
            </a>
          )}
          <a className="cta-alt" href="#route">
            or pick any station
          </a>
        </div>
        <LineIndex />
      </>
    );
  }
  const next = RIDE.find((s) => !visited.has(s.slug)) ?? RIDE[0];
  const started = RIDE.some((s) => visited.has(s.slug));
  const minutes = RIDE.reduce((sum, s) => sum + s.minutes, 0);
  return (
    <section className="ride" aria-labelledby="ride-h">
      <p className="ride-meta">
        <span className="ride-tag">Ride 1</span> Beginner · {RIDE.length} stops · about {minutes} min
      </p>
      <h2 id="ride-h" className="ride-title">
        {RIDE_NAME}
      </h2>
      <ol className="ride-stops">
        {RIDE.map((s) => (
          <RideStop key={s.slug} s={s} seen={visited.has(s.slug)} next={s === next} />
        ))}
      </ol>
      <div className="cta">
        <Link className="btn-primary" href={`/learn/${next.slug}`}>
          {started ? "Continue" : "Start"}: {next.title}
          <span className="cta-min">{next.minutes} min</span>
          <ArrowIcon />
        </Link>
        <a className="cta-alt" href="#route">
          or pick any station
        </a>
      </div>
    </section>
  );
}

function RideStop({ s, seen, next }: { s: LessonMeta; seen: boolean; next: boolean }) {
  return (
    <li className={`line-${s.line}${seen ? " seen" : ""}${next ? " next" : ""}`}>
      <Link href={`/learn/${s.slug}`}>
        <span className="ride-dot" aria-hidden="true" />
        <span className="ride-code">{s.code}</span>
        <span className="ride-name">{s.title}</span>
        <span className="sr-only">
          , {s.minutes} min{seen ? ", visited" : ""}
          {next ? ", next" : ""}
        </span>
      </Link>
    </li>
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
