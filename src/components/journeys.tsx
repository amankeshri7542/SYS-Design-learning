"use client";

import Link from "next/link";
import { Suspense, use } from "react";
import { STORIES, lineOf, prerequisitesOf } from "@/lib/lessons";
import { loadStory } from "@/lib/lessons/stories";
import type { LessonMeta } from "@/lib/lessons/types";
import { ArrowIcon } from "./live";
import { StoryScene } from "./station-preview";
import { useVisited } from "./visited";

/**
 * Real systems as journeys: what the story asks, the lessons it rides (as their line roundels), how many stages, and
 * its finished architecture running. A card's scene runs only while it is on screen.
 */
export function Journeys() {
  const { visited } = useVisited();
  return (
    <ul className="journey-cards">
      {STORIES.map((meta) => (
        <JourneyCard key={meta.slug} meta={meta} visited={visited} />
      ))}
    </ul>
  );
}

function JourneyCard({ meta, visited }: { meta: LessonMeta; visited: Set<string> }) {
  const stops = prerequisitesOf(meta.slug);
  return (
    <li className={`journey-card line-${meta.line}`}>
      <div className="journey-copy">
        <h3 className="journey-title">
          <span className="code-chip">{meta.code}</span> {meta.title}
        </h3>
        <p className="journey-why">{meta.why}</p>
        <h4 className="journey-sub">The lessons it rides</h4>
        <ol className="journey-stops">
          {stops.map((s) => (
            <li key={s.slug} className={`line-${s.line}${visited.has(s.slug) ? " seen" : ""}`}>
              <Link href={`/learn/${s.slug}`} title={s.title}>
                <span className="roundel-xs" aria-hidden="true">
                  {lineOf(s.line).letter}
                </span>
                <span className="journey-stop-code">{s.code}</span>
                <span className="journey-stop-name">{s.title}</span>
                {visited.has(s.slug) && <span className="sr-only"> (visited)</span>}
              </Link>
            </li>
          ))}
        </ol>
        <div className="journey-go">
          <Link className="btn-primary" href={`/learn/${meta.slug}`}>
            Ride it <ArrowIcon />
          </Link>
          <Suspense fallback={<span className="journey-facts">{meta.minutes} min</span>}>
            <Facts meta={meta} />
          </Suspense>
        </div>
      </div>
      <figure className="journey-scene">
        <div className="sheet">
          <Suspense fallback={<div className="mini-scene" />}>
            <StoryScene meta={meta} />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <SceneCaption meta={meta} />
        </Suspense>
      </figure>
    </li>
  );
}

function Facts({ meta }: { meta: LessonMeta }) {
  const def = use(loadStory(meta.slug));
  return (
    <span className="journey-facts">
      {def.stages.length} stages · about {meta.minutes} min
    </span>
  );
}

function SceneCaption({ meta }: { meta: LessonMeta }) {
  const def = use(loadStory(meta.slug));
  const last = def.stages[def.stages.length - 1];
  return (
    <figcaption>
      A design that holds stage {def.stages.length}, “{last.name}”.
    </figcaption>
  );
}
