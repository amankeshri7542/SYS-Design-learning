"use client";

import { Suspense, lazy, use, useEffect, useMemo } from "react";
import { loadScene } from "@/lib/lessons/scenes";
import { loadStory } from "@/lib/lessons/stories";
import type { Lesson, LessonMeta, PageNav } from "@/lib/lessons/types";
import type { Term } from "@/lib/glossary";
import { loadModules, type ModuleName } from "@/lib/sim/engine/core";
import { Brand } from "./brand";
import { TermDefs } from "./term-defs";
import { MarkVisited } from "./visited";

// Each page needs only its own player: a lesson's or a story's.
const LessonPlayer = lazy(() => import("./player").then((m) => ({ default: m.LessonPlayer })));
const StoryPlayer = lazy(() => import("./story-player").then((m) => ({ default: m.StoryPlayer })));

/**
 * A lesson page: its scenes arrive in a chunk of their own, so a page carries one lesson's code, not the course's.
 * Until they do (a client navigation that wasn't fetched ahead), the page shows the shell with an empty stage.
 */
export function LessonPage({ nav, why, terms, needs }: { nav: PageNav; why: string; terms: Term[]; needs: ModuleName[] }) {
  const { meta } = nav;
  return (
    <TermDefs terms={terms}>
      {/* The visit counts from the moment the page opens, not once its scenes arrive. */}
      <MarkVisited slug={meta.slug} />
      <Suspense fallback={<ShellSkeleton meta={meta} why={why} />}>
        {meta.kind === "story" ? <LoadedStory nav={nav} why={why} needs={needs} /> : <LoadedLesson nav={nav} why={why} needs={needs} />}
      </Suspense>
    </TermDefs>
  );
}

function LoadedLesson({ nav, why, needs }: { nav: PageNav; why: string; needs: ModuleName[] }) {
  const { meta } = nav;
  // The engine's optional modules this lesson's scenes use, if any, load beside its scenes.
  use(loadModules(needs));
  const scene = use(loadScene(meta.slug));
  // `withScene`, inlined: importing it would bring the beats runtime into the page's own chunk, ahead of the player.
  const lesson = useMemo((): Lesson => ({ ...meta, ...scene, why }), [meta, scene, why]);
  useFetchNext(nav.next);
  return <LessonPlayer lesson={lesson} nav={nav} />;
}

function LoadedStory({ nav, why, needs }: { nav: PageNav; why: string; needs: ModuleName[] }) {
  const { meta } = nav;
  use(loadModules(needs));
  const def = use(loadStory(meta.slug));
  useFetchNext(nav.next);
  return <StoryPlayer meta={meta} nav={nav} why={why} def={def} />;
}

/** Once the page is idle, fetch the next stop's code, so "Next stop" opens at once. */
function useFetchNext(next: LessonMeta | undefined) {
  useEffect(() => {
    if (!next) return;
    const fetchIt = () => void (next.kind === "story" ? loadStory(next.slug) : loadScene(next.slug));
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(fetchIt, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(fetchIt, 1500);
    return () => clearTimeout(t);
  }, [next]);
}

/**
 * The player's frame, before its scenes have arrived: the bar with the lesson's name, an empty sheet and an empty dock.
 * Its parts have names of their own, so nothing that looks for the player's stage or heading finds this instead.
 */
function ShellSkeleton({ meta, why }: { meta: LessonMeta; why: string }) {
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
        <p className="step-text">{why}</p>
      </div>
      <div className="sk-dock" />
    </div>
  );
}
