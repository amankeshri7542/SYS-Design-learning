import type { Sim } from "../../sim/engine";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";
import { M, balancer, cache, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S2: viewers in Europe, the Americas and Asia watch a premiere served from one origin in the Americas (80 ms from
// Europe, 150 ms from Asia). The target: 95% of viewers' requests answered within 0.4 s, and almost none failing. Stages
// raise the audience past what the origin can serve (edge caches near the viewers), expire the stream's newest segment
// on every edge at the same moment (coalescing misses), and kill Asia's edge (routing to the nearest healthy edge).

const PRICE = { base: 100, edges: 90, coalesce: 10, failover: 30 };
const START: Values = { edges: 0, coalesce: 0, failover: 0 };
const REGIONS = [
  { id: "eu", label: "Europe", y: 16, origin: 80, backup: "us", away: 80 },
  { id: "us", label: "Americas", y: 50, origin: 15, backup: "eu", away: 80 },
  { id: "as", label: "Asia", y: 84, origin: 150, backup: "us", away: 150 },
];

function premiere(a: Values, s: StoryStage): SceneSpec {
  const { viewers, expire, asiaDown } = s.params;
  const nodes: NodeSpec[] = [];
  const links: Record<string, number> = {};
  for (const r of REGIONS) {
    // The stream's newest segment (key 0) is what everyone asks for; older ones follow a long tail.
    const to = a.edges ? (a.failover ? `${r.id}-r` : `${r.id}-e`) : "origin";
    // A player that misses a segment tries again shortly after.
    nodes.push(users(`${r.id}-v`, [6, r.y], { rate: viewers, keys: 400, hot: 0.6, skew: 0.9, retry: { mode: "backoff", max: 3, baseMs: 100 } }, to, { label: r.label }));
    if (!a.edges) {
      links[`${r.id}-v>origin`] = r.origin + 10;
      continue;
    }
    if (a.failover) {
      nodes.push(balancer(`${r.id}-r`, [20, r.y], [`${r.id}-e`, `${r.backup}-e`], { glyph: "router", label: "Router", algo: "nearest", health: { everyMs: 50, failAfter: 1, passAfter: 2, timeoutMs: 400 } }));
      links[`${r.id}-v>${r.id}-r`] = 2;
      links[`${r.id}-r>${r.id}-e`] = 10;
      links[`${r.id}-r>${r.backup}-e`] = r.away;
    } else links[`${r.id}-v>${r.id}-e`] = 10;
    nodes.push(cache(`${r.id}-e`, [38, r.y], "origin", { label: `${r.label} edge`, capacity: 150, ttlMs: 30_000, coalesce: !!a.coalesce }));
    links[`${r.id}-e>origin`] = r.origin;
  }
  nodes.push(server("origin", [86, 50], { label: "Origin", slots: 8, serviceMs: 60 }));
  return scene(nodes, {
    links,
    windowMs: 2000,
    wideH: 440,
    timeoutMs: 1500,
    script:
      expire || asiaDown
        ? {
            loopMs: 3000,
            events: [
              // A new segment every 1.5 s: the last one expires on every edge at once.
              ...(expire
                ? [500, 2000].map((at) => ({ at, label: "A new segment replaced the last everywhere", run: (sim: Sim) => sim.expire(0) }))
                : []),
              ...(asiaDown
                ? [
                    { at: 300, label: "Asia's edge went down", run: (sim: Sim) => sim.setUp("as-e", false) },
                    { at: 2700, label: "Asia's edge is back", run: (sim: Sim) => sim.setUp("as-e", true) },
                  ]
                : []),
            ],
          }
        : undefined,
  });
}

const failed = M.errors({ label: "Failed", hint: "Share of viewers' requests that failed or gave up." });
const ALL = ["eu-e", "us-e", "as-e"];

/** Serve a premiere to the world: four stages, from a quiet preview to a global audience with an edge that dies. */
const videoPremiere: StoryDef = {
  controls: [
    { kind: "switch", id: "edges", label: "Edge caches" },
    { kind: "switch", id: "coalesce", label: "Coalesce misses" },
    { kind: "switch", id: "failover", label: "Nearest healthy edge" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.edges * PRICE.edges + a.coalesce * PRICE.coalesce + a.failover * PRICE.failover,
  scene: premiere,
  targets: [
    { metric: M.p95(), label: "Response time", max: 400 },
    { metric: failed, label: "Failed", max: 0.02 },
  ],
  metrics: [M.busy(["origin"], "Origin busy"), M.hit(ALL, "Edge hits")],
  win: (cost) => `Your premiere played for the whole world through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: (s) => `${s.params.viewers * 3} a second`,
  stages: [
    {
      name: "A quiet preview",
      beats: [
        { id: "watch", when: { step: "enter" }, text: "A few viewers on three continents watch a preview from one origin.", focus: { nodes: ["origin"] } },
        { id: "far", when: { wait: 0 }, text: "Watch Asia's requests: 150 ms each way, but still inside the target.", focus: { nodes: ["as-v"] } },
      ],
      brief: "A preview for a few viewers worldwide, all served from one origin in the Americas.",
      hint: "Nothing to change yet. Watch the far-away requests take longer.",
      params: { viewers: 15, expire: 0, asiaDown: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "The premiere",
      beats: [
        { id: "watch", when: { step: "enter" }, text: "The premiere starts: 100 requests a second from each continent.", focus: { nodes: ["origin"] } },
        { id: "busy", when: { wait: 0 }, text: "Watch Origin: 300 a second, more than its workers can serve.", focus: { nodes: ["origin"], sockets: true } },
      ],
      brief: "The premiere: viewers everywhere ask for the same few video segments, all at the far-away origin.",
      hint: "Everyone wants the same segments. Keep copies close to the viewers.",
      params: { viewers: 100, expire: 0, asiaDown: 0 },
      hold: 8,
      solution: { ...START, edges: 1 },
    },
    {
      name: "The same second",
      beats: [
        { id: "watch", when: { step: "enter" }, text: "Now the newest segment expires on every edge in the same instant.", focus: { nodes: ["origin"] } },
        { id: "herd", when: { wait: 0 }, text: "Watch Origin: every viewer's miss arrives at once.", focus: { nodes: ["origin"] } },
      ],
      brief: "Each new segment replaces the last on every edge at once. Every viewer misses together.",
      hint: "When many viewers miss the same segment, one fetch per edge is enough.",
      params: { viewers: 100, expire: 1, asiaDown: 0 },
      hold: 8,
      solution: { ...START, edges: 1, coalesce: 1 },
    },
    {
      name: "Asia's edge dies",
      beats: [
        { id: "watch", when: { step: "enter" }, text: "Now Asia's edge goes down every few seconds.", focus: { nodes: ["as-v"] } },
        { id: "fail", when: { wait: 0 }, text: "Watch Failed: Asia's viewers have nowhere else to go.", focus: { nodes: ["as-v"] } },
      ],
      brief: "Asia's edge keeps failing. Its viewers need another edge to go to, even a farther one.",
      hint: "Send each region to its own edge while it is healthy, and to the nearest other one when it isn't.",
      params: { viewers: 100, expire: 1, asiaDown: 1 },
      hold: 10,
      solution: { ...START, edges: 1, coalesce: 1, failover: 1 },
    },
  ],
};

export default videoPremiere;
