// Each live story, loaded with its page (and by its journey card on the home page). As with the lesson scenes, every
// path is written out so each story gets a chunk of its own; tests/lessons.test.ts checks the map covers every live story.

import { settled } from "../scenes";
import type { StoryDef } from "../story";

type Load = () => Promise<{ default: StoryDef }>;

export const STORY_MODULES: Record<string, Load> = {
  capstone: () => import("./capstone"),
};

const loaded = new Map<string, Promise<StoryDef>>();

/** A story, fetched once and kept. */
export function loadStory(slug: string): Promise<StoryDef> {
  let p = loaded.get(slug);
  if (!p) {
    p = settled(STORY_MODULES[slug]().then((m) => m.default));
    loaded.set(slug, p);
  }
  return p;
}
