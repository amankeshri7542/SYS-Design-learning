"use client";

import { Suspense, use, useMemo } from "react";
import { LEVELS, prerequisitesOf } from "@/lib/lessons";
import { loadScene } from "@/lib/lessons/scenes";
import { loadStory } from "@/lib/lessons/stories";
import { defaultsOf, type LessonMeta } from "@/lib/lessons/types";
import { MiniScene } from "./mini-scene";

/** Where a preview sits, in px inside the map, and which side of its station it is on. */
export interface PreviewSpot {
  x: number;
  y: number;
  side: "above" | "below";
}

/**
 * A station's card on the map, shown while it is hovered or focused: what the lesson is, how long it takes, and its
 * first scene running. One at a time; it loads only that lesson's code. The station's link carries the same words, so
 * the card is a picture of it, hidden from screen readers.
 */
export function StationPreview({ meta, spot, ready }: { meta: LessonMeta; spot: PreviewSpot; ready: boolean }) {
  const level = LEVELS.find((l) => l.id === meta.level)!;
  const after = ready ? [] : prerequisitesOf(meta.slug);
  return (
    <div className={`preview line-${meta.line}`} data-side={spot.side} style={{ left: spot.x, top: spot.y }} aria-hidden="true">
      <p className="preview-meta">
        <span className="code-chip">{meta.code}</span>
        <span>
          {level.name} · {meta.minutes} min
        </span>
      </p>
      <h3 className="preview-title">{meta.title}</h3>
      <div className="preview-scene">
        <Suspense fallback={<div className="mini-scene" />}>
          {meta.kind === "story" ? <StoryScene meta={meta} /> : <LessonScene meta={meta} />}
        </Suspense>
      </div>
      <p className="preview-why">{meta.why}</p>
      {after.length > 0 && <p className="preview-after">Best after {after.map((p) => `${p.code} ${p.title}`).join(", ")}</p>}
    </div>
  );
}

/** The lesson's problem, as it opens. */
export function LessonScene({ meta }: { meta: LessonMeta }) {
  const fig = use(loadScene(meta.slug)).figures[0];
  const spec = useMemo(() => fig.build(defaultsOf(fig)), [fig]);
  return <MiniScene spec={spec} label={`${meta.title}: ${fig.title}`} />;
}

/** The story's finished architecture, holding its last stage. */
export function StoryScene({ meta }: { meta: LessonMeta }) {
  const def = use(loadStory(meta.slug));
  const last = def.stages[def.stages.length - 1];
  const spec = useMemo(() => def.scene(last.solution, last), [def, last]);
  return <MiniScene spec={spec} label={`${meta.title}: ${last.name}`} />;
}
