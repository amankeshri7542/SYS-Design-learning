import { M, armed, balancer, fault, knob, lane, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// O1: version 2 has a bug that fails 6 requests in 10. Deployed to every server at once, it fails 6 in 10 of everyone's
// requests until someone rolls it back by hand. As a canary it runs on one server that gets a tenth of the traffic,
// and the balancer stops sending to it once its errors pass 30%: a few failures, then none.

const DEPLOY = "Version 2 goes out";
const UNDO = "Version 1 is back";
const deploy = fault("deploy", "Deploy v2", "Roll back to v1", DEPLOY, UNDO, (s) => s.list.some((n) => n.spec.version === "v2"));
const BUG = 0.6;

const version = (v2: boolean): Partial<NodeSpec> => ({ version: v2 ? "v2" : "v1", failRate: v2 ? BUG : undefined });

/** Every server flips to v2 at once. */
const everyone = (v2 = false): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 60, keys: 50 }, "lb"),
      balancer("lb", [38, 50], ["s1", "s2", "s3", "s4"], { label: "Balancer" }),
      ...[1, 2, 3, 4].map((i) => server(`s${i}`, [78, lane(4, i - 1)], { label: `Server ${i}`, slots: 4, serviceMs: 50, ...version(v2) })),
    ],
    {
      windowMs: 1500,
      seed: 19,
      script: armed({ node: "lb", at: 1200, lastsMs: 3000, start: DEPLOY, end: UNDO }, { start: (s) => s.reconfigure(everyone(true)), end: (s) => s.reconfigure(everyone()) }),
    },
  );

/** v2 on the canary only: it gets `share` percent of the traffic, and is rolled back past `limit` errors. */
const canary = (share: number, limit: number, v2 = false): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 60, keys: 50 }, "lb"),
      balancer("lb", [38, 50], ["s1", "s2", "s3", "c"], {
        label: "Balancer",
        algo: "weighted",
        weights: { s1: (100 - share) / 3, s2: (100 - share) / 3, s3: (100 - share) / 3, c: share },
        rollback: { target: "c", errorsAbove: limit / 100 },
      }),
      ...[1, 2, 3].map((i) => server(`s${i}`, [78, lane(4, i - 1)], { label: `Server ${i}`, slots: 4, serviceMs: 50, ...version(false) })),
      server("c", [78, lane(4, 3)], { label: "Canary", slots: 4, serviceMs: 50, ...version(v2) }),
    ],
    {
      windowMs: 1500,
      seed: 19,
      script: armed({ node: "lb", at: 1200, lastsMs: 3000, start: DEPLOY, end: UNDO }, { start: (s) => s.reconfigure(canary(share, limit, true)), end: (s) => s.reconfigure(canary(share, limit)) }),
    },
  );

const metrics = [M.errors(), M.p95()];

const canaries: LessonScene = {
  hook: "How do you ship a new version without betting every user on it?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Everyone",
      title: "Deploy to every server at once",
      caption: "Four servers run version 1. Version 2 has a bug that fails 6 requests in 10.",
      actions: [deploy],
      metrics,
      parts: [
        { node: "u", text: "Users: 60 requests a second." },
        { node: "lb", text: "Balancer: spreads them over 4 servers." },
        { node: ["s1", "s2", "s3", "s4"], text: "Servers: all running version 1 (v1).", sockets: true },
      ],
      beats: [
        { id: "v1", when: { at: 300 }, text: "Each server wears its version: v1. A new one, v2, is ready to ship.", focus: { nodes: ["s1", "s2", "s3", "s4"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Deploy v2.", focus: { action: "deploy" }, pause: true },
        { id: "all", when: { note: DEPLOY }, text: "Every server switches to v2 at the same moment.", focus: { nodes: ["s1", "s2", "s3", "s4"] } },
        { id: "bug", when: { metric: M.errors(), is: ">", value: 0.4 }, text: "v2's bug fails {errors} of all requests, for every user at once.", focus: { dots: "failed" } },
        { id: "hand", when: { wait: 0 }, text: "Someone has to notice, decide and roll back by hand. Every second counts.", focus: { metric: "Failed" } },
      ],
      predict: {
        prompt: "Next, v2 goes to one server that gets a tenth of the traffic. The bug will fail…",
        options: ["6 in 10 requests, as here", "Far fewer, and only briefly"],
        answer: 1,
        before: "end",
        reveal: { beat: "compare", text: "Failed: {before} with v2 everywhere, {after} with v2 as a canary." },
        track: { metric: M.errors(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before / 3,
      },
      break: { action: "deploy", beat: "press" },
      build: () => everyone(),
    },
    {
      tone: "fix",
      short: "Canary",
      title: "A small slice first",
      caption: "Version 2 goes to one server that gets 10% of traffic. If its errors pass 30%, the balancer stops using it.",
      actions: [deploy],
      knobs: [knob("share", "Canary share", 5, 50, 5, 10, (v) => `${v}%`), knob("limit", "Roll back above", 10, 90, 10, 30, (v) => `${v}% errors`)],
      metrics,
      beats: [
        { id: "canary", when: { step: "enter" }, text: "Now v2 runs on one server with a tenth of the traffic: a [[canary]].", focus: { nodes: ["c"] }, term: "canary" },
        { id: "compare", when: { wait: 0 }, text: "Compare Failed: {errors:fix} here, {errors:problem} with v2 everywhere.", focus: { metric: "Failed" } },
        {
          id: "rolled",
          when: { note: "Canary rolled back", since: "lesson" },
          text: "The balancer saw the canary failing and stopped using it: an automatic [[rollback]].",
          focus: { nodes: ["lb", "c"] },
          term: "rollback",
        },
        { id: "bigger", when: { wait: 600 }, text: "Drag Canary share to 50%: a bigger canary hurts more users before it's pulled.", focus: { knob: "share" } },
      ],
      headline: { metric: "Failed", sentence: "Buggy v2 deployed: {errors:problem} failed with v2 everywhere, {errors:fix} with a canary.", at: "bug" },
      build: (v: Values) => canary(v.share, v.limit),
    },
  ],
  checks: [
    {
      prompt: "Why send only a few percent of traffic to a new version first?",
      options: ["A bug then hurts only those few", "New versions are slower"],
      answer: 0,
      why: "The canary limits the blast: if v2 is broken, only its small share of users see it, and only briefly.",
      focus: { nodes: ["c"] },
    },
    {
      prompt: "When should a canary be rolled back automatically?",
      options: ["When its errors clearly pass the old version's", "Only after a full day"],
      answer: 0,
      why: "Compare it to the version it replaces, and pull it as soon as it is clearly worse.",
      focus: { knob: "limit" },
    },
  ],
  takeaways: {
    use: "Every deploy: ship to a small slice first, watch its errors and latency against the old version, then widen.",
    catch: "A canary only catches what it sees. Rare paths and slow leaks can pass a short canary.",
    seen: "Argo Rollouts and Flagger, AWS CodeDeploy, feature flags with gradual rollouts.",
    rule: "Bet a few users, not all of them.",
  },
};

export default canaries;
