// A story (a journey on the map): one architecture the learner grows stage by stage, until it holds a target under each
// stage's traffic and failures, for as little money as possible. One player runs them all (`story-player.tsx`); a story
// is data: its controls, its prices, its scene builder, its stages and its target. The lessons it rides are its catalog
// entry's `requires`, in the order it rides them.

import type { MetricSpec } from "../sim/metrics";
import type { SceneSpec } from "../sim/types";
import type { Beat } from "./beats";
import type { Values } from "./types";

/** A part of the architecture: how many of something (servers), or one thing on or off (a cache). */
export type Control =
  | { kind: "count"; id: string; label: string; min: number; max: number }
  | { kind: "switch"; id: string; label: string };

/** One half of the target: a live number that must stay at or under `max`. */
export interface Target {
  metric: MetricSpec;
  /** Its name in the target row. */
  label: string;
  max: number;
}

export interface StoryStage {
  name: string;
  /** Two beats as the stage opens: what changed, and the box to watch. */
  beats: Beat[];
  brief: string;
  hint: string;
  /** What the stage throws at the system (traffic, a bot, a crash), for the story's scene builder. */
  params: Values;
  /** Seconds (real time at 1×) the target must hold without a break. */
  hold: number;
  /** The design the stage was made for. The tests prove it clears this stage and the previous stage's doesn't. */
  solution: Values;
}

export interface StoryDef {
  controls: Control[];
  start: Values;
  /** What a design costs to run, in dollars a month: the cheapest design that holds wins. */
  cost: (v: Values) => number;
  scene: (v: Values, stage: StoryStage) => SceneSpec;
  targets: Target[];
  /** Readouts under the controls: how busy each tier is. */
  metrics: MetricSpec[];
  stages: StoryStage[];
  /** Said once every stage is cleared. */
  win: (cost: number) => string;
  /** What the beat strip says about a stage after its number ("40 a second"). */
  lead?: (stage: StoryStage) => string;
}

/** Whether a design holds the target right now: every number known and within its line. */
export function holds(targets: Target[], read: (m: MetricSpec) => number | null): boolean {
  return targets.every((t) => {
    const v = read(t.metric);
    return v !== null && v <= t.max;
  });
}
