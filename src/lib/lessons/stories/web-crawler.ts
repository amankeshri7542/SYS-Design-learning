import type { Sim } from "../../sim/engine";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";
import { M, lane, queue, range, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S1: new links pour into a frontier queue; fetchers take them, fetch the page from the web (holding a worker while the
// site answers), and answer the frontier, which is their ack. The target: a short frontier and no page lost. Stages
// slow the web, crash a fetcher, and add dead sites whose pages fail every time. The scene runs at twice the course's
// usual pace (`timeScale` 0.2): a backlog takes a few simulated seconds to build, so each stage's hold is long enough to
// see the previous design fail. Losses count over 4 s, longer than the crash loop.

const WAITING = 40;
const PRICE = { base: 60, fetcher: 30, ack: 5, dlq: 5 };
const START: Values = { fetchers: 1, ack: 0, dlq: 0 };

function crawler(a: Values, s: StoryStage): SceneSpec {
  const { links, siteMs, crash, dead } = s.params;
  const fetchers = range(a.fetchers).map((i) => `f${i + 1}`);
  const nodes: NodeSpec[] = [
    users("seeds", [6, 44], { rate: links, keys: 500, poison: dead || undefined, tag: "link" }, "frontier", { label: "New links" }),
    queue("frontier", [28, 44], fetchers, {
      label: "Frontier",
      ack: { mode: a.ack ? "finish" : "receive", visibilityMs: 800, maxDeliveries: a.dlq ? 2 : undefined, deadLetter: a.dlq ? "dlq" : undefined },
    }),
    ...fetchers.map((id, i) =>
      server(id, [56, lane(a.fetchers, i)], { label: `Fetcher ${i + 1}`, slots: 8, serviceMs: 20, blocking: true, calls: { read: ["web"], write: ["web"] }, callTimeoutMs: 3000 }),
    ),
    server("web", [86, 44], { label: "The web", slots: 64, serviceMs: siteMs }),
  ];
  if (a.dlq) nodes.push(queue("dlq", [28, 90], [], { label: "Dead letters" }));
  return scene(nodes, {
    msPerUnit: 0.45,
    wideH: 440,
    timeScale: 0.2,
    windowMs: 4000,
    script: crash
      ? {
          loopMs: 3200,
          events: [
            { at: 300, label: "Fetcher 1 crashed", run: (sim: Sim) => sim.setUp("f1", false) },
            { at: 1500, label: "Fetcher 1 is back", run: (sim: Sim) => sim.setUp("f1", true) },
          ],
        }
      : undefined,
  });
}

const waiting = M.queue(["frontier"], "Links waiting");
const lost: MetricSpec = { id: "lostJobs", label: "Pages lost", hint: "Links a fetcher took and then lost, never fetched, in the window." };

/** Crawl the web: four stages, from a quiet start to a flaky, slow web full of dead sites. */
const webCrawler: StoryDef = {
  controls: [
    { kind: "count", id: "fetchers", label: "Fetchers", min: 1, max: 8 },
    { kind: "switch", id: "ack", label: "Ack when fetched" },
    { kind: "switch", id: "dlq", label: "Dead-letter queue" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.fetchers * PRICE.fetcher + a.ack * PRICE.ack + a.dlq * PRICE.dlq,
  scene: crawler,
  targets: [
    { metric: waiting, label: "Links waiting", max: WAITING },
    { metric: lost, label: "Pages lost", max: 0 },
  ],
  metrics: [M.busy(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"], "Fetchers busy"), { id: "redelivered", label: "Handed out again", hint: "Links the frontier handed out again because no ack came in time." }],
  win: (cost) => `Your crawler held through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: (s) => `${s.params.links} a second`,
  stages: [
    {
      name: "First crawl",
      beats: [
        { id: "links", when: { step: "enter" }, text: "New links arrive at 30 a second, and the web answers in 80 ms.", focus: { nodes: ["seeds"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Frontier: the links waiting. Keep it short, and lose no page.", focus: { nodes: ["frontier"] } },
      ],
      brief: "A small crawl: 30 new links a second, from sites that answer quickly. Check that one fetcher keeps up.",
      hint: "Nothing to change yet. Watch the frontier stay short.",
      params: { links: 30, siteMs: 80, crash: 0, dead: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "The web is slow",
      beats: [
        { id: "links", when: { step: "enter" }, text: "Sites now take 0.6 s to answer, and each fetch holds a worker all that time.", focus: { nodes: ["web"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Fetcher 1's sockets: they fill, and Frontier grows.", focus: { nodes: ["f1"], sockets: true } },
      ],
      brief: "The sites you crawl got slow: every page takes 0.6 s, and a fetcher's worker waits for it.",
      hint: "Each fetcher can wait on 8 pages at once. How many does 30 a second need?",
      params: { links: 30, siteMs: 600, crash: 0, dead: 0 },
      hold: 10,
      solution: { ...START, fetchers: 3 },
    },
    {
      name: "Fetchers crash",
      beats: [
        { id: "links", when: { step: "enter" }, text: "Fetcher 1 now crashes every few seconds, holding the pages it took.", focus: { nodes: ["f1"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Pages lost: links acked on receipt die with the fetcher.", focus: { nodes: ["frontier"] } },
      ],
      brief: "A fetcher keeps crashing mid-fetch. The links it had taken must not be lost.",
      hint: "If a fetcher acks only once a page is fetched, the frontier hands out again what a crash took.",
      params: { links: 30, siteMs: 600, crash: 1, dead: 0 },
      hold: 8,
      solution: { ...START, fetchers: 4, ack: 1 },
    },
    {
      name: "Dead sites",
      beats: [
        { id: "links", when: { step: "enter" }, text: "Some links point at dead sites: their fetch fails, every time.", focus: { nodes: ["web"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Frontier: dead links come back again and again, and the line grows.", focus: { nodes: ["frontier"] } },
      ],
      brief: "Half the links now point at dead sites. Their fetches always fail, and they keep coming back.",
      hint: "Give each link two tries, then set it aside so it stops taking fetchers' time. You'll need one more fetcher too.",
      params: { links: 30, siteMs: 600, crash: 1, dead: 0.5 },
      hold: 18,
      solution: { ...START, fetchers: 5, ack: 1, dlq: 1 },
    },
  ],
};

export default webCrawler;
