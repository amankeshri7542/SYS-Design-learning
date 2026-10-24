"use client";

import { Suspense, lazy, use, useEffect, useMemo } from "react";
import { getLesson, neighbours } from "@/lib/lessons";
import { loadScene } from "@/lib/lessons/scenes";
import { loadStory } from "@/lib/lessons/stories";
import { withScene, type LessonMeta } from "@/lib/lessons/types";
import { Brand } from "./brand";
import { LessonPlayer } from "./player";
import { MarkVisited } from "./visited";

// Only story pages need the story player.
const StoryPlayer = lazy(() => import("./story-player").then((m) => ({ default: m.StoryPlayer })));

/**
 * A lesson page: its scenes arrive in a chunk of their own, so a page carries one lesson's code, not the course's.
 * Until they do (a client navigation that wasn't fetched ahead), the page shows the shell with an empty stage.
 */
export function LessonPage({ slug }: { slug: string }) {
  const meta = getLesson(slug)!;
  return (
    <>
      {/* The visit counts from the moment the page opens, not once its scenes arrive. */}
      <MarkVisited slug={slug} />
      <Suspense fallback={<ShellSkeleton meta={meta} />}>
        {meta.kind === "story" ? <LoadedStory meta={meta} /> : <LoadedLesson meta={meta} />}
      </Suspense>
    </>
  );
}

function LoadedLesson({ meta }: { meta: LessonMeta }) {
  const scene = use(loadScene(meta.slug));
  const lesson = useMemo(() => withScene(meta, scene), [meta, scene]);
  useFetchNext(meta.slug);
  return <LessonPlayer lesson={lesson} />;
}

function LoadedStory({ meta }: { meta: LessonMeta }) {
  const def = use(loadStory(meta.slug));
  useFetchNext(meta.slug);
  return <StoryPlayer meta={meta} def={def} />;
}

/** Once the page is idle, fetch the next stop's code, so "Next stop" opens at once. */
function useFetchNext(slug: string) {
  useEffect(() => {
    const next = neighbours(slug).next;
    if (!next) return;
    const fetchIt = () => void (next.kind === "story" ? loadStory(next.slug) : loadScene(next.slug));
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(fetchIt, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(fetchIt, 1500);
    return () => clearTimeout(t);
  }, [slug]);
}

/**
 * The player's frame, before its scenes have arrived: the bar with the lesson's name, an empty sheet and an empty dock.
 * Its parts have names of their own, so nothing that looks for the player's stage or heading finds this instead.
 */
function ShellSkeleton({ meta }: { meta: LessonMeta }) {
  return (
    <div className={`shell line-${meta.line} shell-skeleton`} aria-busy="true" inert>
      <div className="sk-bar">
        <Brand compact />
        <p className="bar-title">
          <span className="bar-code">{meta.code}</span>
          <span className="bar-name">{meta.title}</span>
        </p>
      </div>
      <div className="sk-theatre">
        <div className="sk-sheet" />
      </div>
      <div className="sk-panel">
        <p className="step-text">{meta.why}</p>
      </div>
      <div className="sk-dock" />
    </div>
  );
}
