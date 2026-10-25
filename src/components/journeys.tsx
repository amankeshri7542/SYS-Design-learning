"use client";

import Link from "next/link";
import { Suspense, use, useState, type CSSProperties, type KeyboardEvent } from "react";
import { STORIES, prerequisitesOf } from "@/lib/lessons";
import { loadStory } from "@/lib/lessons/stories";
import type { LessonMeta } from "@/lib/lessons/types";
import { whyOf } from "@/lib/lessons/words";
import { ArrowIcon } from "./live";
import { StoryScene } from "./station-preview";
import { useVisited } from "./visited";

/** The journeys in the order of their codes (S0, S1…): a list to choose from, not the path. */
const LIST = [...STORIES].sort((a, b) => Number(a.code.slice(1)) - Number(b.code.slice(1)));

/**
 * Real systems as journeys: one at a time, its finished architecture running beside what it asks and the lessons it
 * rides, with every journey listed as tabs to switch it. It opens on the first journey not yet ridden.
 */
export function Journeys() {
  const { visited } = useVisited();
  const [pick, setPick] = useState<string | null>(null);
  const meta = STORIES.find((s) => s.slug === pick) ?? STORIES.find((s) => !visited.has(s.slug)) ?? STORIES[0];
  const i = LIST.indexOf(meta);
  // The tabs pattern, down a column: arrow keys (wrapping), Home and End.
  const onKey = (e: KeyboardEvent) => {
    const to = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: LIST.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = LIST[(to + LIST.length) % LIST.length];
    setPick(next.slug);
    document.getElementById(`journey-tab-${next.slug}`)?.focus();
  };
  return (
    <div className="journey-board">
      <div className="journey-list" role="tablist" aria-label="Journeys" aria-orientation="vertical" onKeyDown={onKey}>
        {LIST.map((m) => (
          <button
            key={m.slug}
            id={`journey-tab-${m.slug}`}
            type="button"
            role="tab"
            aria-selected={m === meta}
            aria-controls="journey-panel"
            tabIndex={m === meta ? 0 : -1}
            className="journey-tab"
            onClick={() => setPick(m.slug)}
          >
            <span className="code-chip">{m.code}</span>
            <span className="journey-tab-name">{m.title}</span>
            {visited.has(m.slug) && <span className="journey-tab-seen">ridden</span>}
          </button>
        ))}
      </div>
      <div id="journey-panel" role="tabpanel" aria-labelledby={`journey-tab-${meta.slug}`} className="journey-feature">
        <figure className="journey-scene">
          <div className="sheet">
            <Suspense fallback={<div className="mini-scene" />}>
              <StoryScene key={meta.slug} meta={meta} />
            </Suspense>
          </div>
          <Suspense fallback={<figcaption>&nbsp;</figcaption>}>
            <SceneCaption meta={meta} />
          </Suspense>
        </figure>
        <div className="journey-copy">
          <h3 className="journey-title">
            <span className="code-chip">{meta.code}</span> {meta.title}
          </h3>
          <p className="journey-why">{whyOf(meta.slug)}</p>
          <p className="journey-sub">The lessons it rides</p>
          <ol className="ride-stops journey-rides" style={{ "--n": prerequisitesOf(meta.slug).length } as CSSProperties}>
            {prerequisitesOf(meta.slug).map((s) => (
              <li key={s.slug} className={`line-${s.line}${visited.has(s.slug) ? " seen" : ""}`}>
                <Link href={`/learn/${s.slug}`}>
                  <span className="ride-dot" aria-hidden="true" />
                  <span className="ride-code">{s.code}</span>
                  <span className="ride-name">{s.title}</span>
                  {visited.has(s.slug) && <span className="sr-only">, visited</span>}
                </Link>
              </li>
            ))}
          </ol>
          <div className="journey-go">
            <Link className="btn-primary" href={`/learn/${meta.slug}`}>
              Ride it <ArrowIcon />
            </Link>
            <Suspense fallback={<span className="journey-facts">about {meta.minutes} min</span>}>
              <Facts meta={meta} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
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
