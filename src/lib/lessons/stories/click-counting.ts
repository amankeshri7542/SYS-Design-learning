import type { Sim } from "../../sim/engine";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";
import { M, balancer, database, lane, range, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S8: ad clicks (one in ten up to a second late) go through a click service that writes a row per click to Counts.
// The target: clicks answered within 0.4 s, and almost every click counted. Stages send more clicks than one table can
// take (shard it by ad), make one ad take half of them (its shard melts: add clicks up per ad per second and write the
// totals), and crash the counter now and then (its open counts die with it: checkpoint them). The click service and
// the counter are one station, and the first shard is Counts, so each stage's beats point at stations every design has.

const PRICE = { base: 100, shard: 60, windows: 30, checkpoint: 10 };
const START: Values = { shard: 0, windows: 0, checkpoint: 0 };
const SHARDS = 3;

function clicks(a: Values, s: StoryStage): SceneSpec {
  const { rate, hot, crash } = s.params;
  const ids = range(a.shard ? SHARDS : 1).map((i) => (i ? `db${i + 1}` : "db"));
  const sink = a.shard ? "router" : "db";
  const nodes: NodeSpec[] = [
    users("u", [6, 50], { rate, keys: 50, hot, writes: 1, lateness: { share: 0.1, maxMs: 1000 }, retry: { mode: "backoff", max: 3, baseMs: 100 } }, "api", { label: "Clicks" }),
    a.windows
      ? server("api", [36, 50], { label: "Counter", slots: 16, serviceMs: 1, window: { sizeMs: 1000, latenessMs: 1500, to: sink, checkpoint: !!a.checkpoint } })
      : server("api", [36, 50], { label: "Click service", slots: 64, serviceMs: 1, blocking: true, calls: { write: [sink] }, callTimeoutMs: 1500 }),
    ...ids.map((id, i) => database(id, [a.shard ? 90 : 86, a.shard ? lane(SHARDS, i) : 50], { label: a.shard ? `Counts ${i + 1}` : "Counts", slots: 4, serviceMs: 13 })),
  ];
  if (a.shard) nodes.push(balancer("router", [62, 50], ids, { label: "By ad", algo: "hash" }));
  return scene(nodes, {
    timeScale: 0.2,
    links: { "api>db": 5, "api>router": 3, ...Object.fromEntries(ids.map((id) => [`router>${id}`, 5])) },
    windowMs: 3000,
    wideH: 440,
    script: crash
      ? {
          loopMs: 4000,
          events: [
            { at: 1000, label: "The counter crashes", run: (sim: Sim) => sim.setUp("api", false) },
            { at: 1300, label: "It's back", run: (sim: Sim) => sim.setUp("api", true) },
          ],
        }
      : undefined,
  });
}

const uncounted: MetricSpec = { id: "uncounted", label: "Clicks not counted", hint: "Share of clicks answered but never added to a total: too late for their window, or lost in a crash." };

/** Count every click: four stages, from a small campaign to a viral ad and a counter that crashes. */
const clickCounting: StoryDef = {
  controls: [
    { kind: "switch", id: "shard", label: "Shard the counts" },
    { kind: "switch", id: "windows", label: "Count in windows" },
    { kind: "switch", id: "checkpoint", label: "Checkpoint the counts" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.shard * PRICE.shard + a.windows * PRICE.windows + a.checkpoint * PRICE.checkpoint,
  scene: clicks,
  targets: [
    { metric: M.p95({ label: "Click time" }), label: "Click time", max: 400 },
    { metric: uncounted, label: "Clicks not counted", max: 0.01 },
  ],
  metrics: [M.busy(["db", "db2", "db3"], "Counts busy"), { id: "windowLag", label: "Totals written after", hint: "How long after a window opens its totals are written." }],
  win: (cost) => `Your pipeline counted every click through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: (s) => `${s.params.rate} a second`,
  stages: [
    {
      name: "A small campaign",
      beats: [
        { id: "row", when: { step: "enter" }, text: "Each click adds one to its ad's row in Counts.", focus: { nodes: ["api"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Counts keep up with 100 clicks a second.", focus: { nodes: ["db"] } },
      ],
      brief: "A small campaign: 100 clicks a second on 50 ads. Check that one table keeps up.",
      hint: "Nothing to change yet.",
      params: { rate: 100, hot: 0, crash: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "Launch day",
      beats: [
        { id: "more", when: { step: "enter" }, text: "Now 600 clicks a second, twice what Counts can write.", focus: { nodes: ["u"] } },
        { id: "full", when: { wait: 0 }, text: "Watch Counts' line grow, and clicks wait in it.", focus: { nodes: ["db"], sockets: true } },
      ],
      brief: "The campaign launches. One table can't take a write per click any more.",
      hint: "Split the counts across several tables, each owning some of the ads.",
      params: { rate: 600, hot: 0, crash: 0 },
      hold: 8,
      solution: { ...START, shard: 1 },
    },
    {
      name: "One ad goes viral",
      beats: [
        { id: "hot", when: { step: "enter" }, text: "Now half of all clicks are on one ad.", focus: { nodes: ["u"] } },
        { id: "melt", when: { wait: 0 }, text: "Watch the table that owns it: every one of those clicks lands there.", focus: { nodes: ["db"] } },
      ],
      brief: "One ad goes viral. Every click on it lands on the same table, however many tables there are.",
      hint: "Add up each ad's clicks in memory, and write the totals once a second.",
      params: { rate: 600, hot: 0.5, crash: 0 },
      hold: 8,
      solution: { ...START, shard: 1, windows: 1 },
    },
    {
      name: "A counter crashes",
      beats: [
        { id: "crash", when: { step: "enter" }, text: "Now the counter crashes for a moment every four seconds.", focus: { nodes: ["api"] } },
        { id: "gone", when: { wait: 0 }, text: "Watch Clicks not counted: what it had added up dies with it.", focus: { nodes: ["api"] } },
      ],
      brief: "The counter crashes now and then. Whatever it had added up but not written is gone.",
      hint: "Save the open counts as they grow, so a restarted counter picks up where it left off.",
      params: { rate: 600, hot: 0.5, crash: 1 },
      hold: 10,
      solution: { ...START, shard: 1, windows: 1, checkpoint: 1 },
    },
  ],
};

export default clickCounting;
