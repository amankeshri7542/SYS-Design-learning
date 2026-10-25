import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/brand";
import { ProgressView, type ProgressEntry } from "@/components/progress-view";
import { COURSE, LINES } from "@/lib/lessons";
// A server page: counting every lesson's beats here ships none of them to the browser.
import { SCENE_DEFS, STORY_DEFS } from "@/lib/lessons/all";
import { beatsOf } from "@/lib/lessons/types";

export const metadata: Metadata = {
  title: "Your progress",
  description: "What you have done in System Lab, kept only in this browser: lessons opened, predictions, checks.",
};

/** How many beats a lesson has (a story's stages open with two each): seeing all of them is watching it end to end. */
function beatsIn(slug: string) {
  const scene = SCENE_DEFS[slug];
  if (scene) return scene.figures.reduce((n, f) => n + beatsOf(f).length, 0);
  return STORY_DEFS[slug]?.stages.reduce((n, s) => n + s.beats.length, 0) ?? 0;
}

export default function Progress() {
  const entries: ProgressEntry[] = COURSE.map((e) => ({ slug: e.slug, code: e.code, title: e.title, line: e.line, kind: e.kind, beats: beatsIn(e.slug), stages: STORY_DEFS[e.slug]?.stages.length ?? 0 }));
  const lines = LINES.map((l) => ({ id: l.id, letter: l.letter, name: l.name }));
  return (
    <>
      <SiteHeader />
      <ProgressView entries={entries} lines={lines} />
      <SiteFooter />
    </>
  );
}
