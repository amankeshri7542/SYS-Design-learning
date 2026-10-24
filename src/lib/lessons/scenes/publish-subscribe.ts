import type { NodeSpec } from "../../sim/types";
import { M, armedCrash, fault, scene, server, users, worker } from "../kit";
import type { LessonScene } from "../types";

const subs = [
  { id: "email", label: "Email", ms: 60, at: 16 },
  { id: "stock", label: "Inventory", ms: 40, at: 50 },
  { id: "stats", label: "Analytics", ms: 120, at: 84 },
];

const A_DOWN = "Analytics crashed";
const A_BACK = "Analytics is back";
const crashStats = fault("crash-stats", "Crash analytics", "Restore analytics", A_DOWN, A_BACK, (sim) => sim.nodes.get("stats")?.up === false);
const ordersFailed = M.errors();

const direct = () =>
  scene(
    [
      users("u", [6, 50], { rate: 10, keys: 50 }, "orders"),
      server("orders", [36, 50], { slots: 8, serviceMs: 30, label: "Order service", to: subs.map((s) => s.id) }),
      ...subs.map((s) => server(s.id, [86, s.at], { slots: 3, serviceMs: s.ms, queueMax: 20, label: s.label })),
    ],
    { script: armedCrash("stats", 1400, 1500, A_DOWN, A_BACK), wideH: 460 },
  );

const pubsub: LessonScene = {
  hook: "Three services care about every order. Why should the customer wait for all three?",
  dots: ["req", "late", "ok", "failed", "job"],
  figures: [
    {
      tone: "problem",
      short: "Direct calls",
      title: "The order service calls everyone",
      caption: "Each order calls email, then inventory, then analytics, one after another, before answering.",
      actions: [crashStats],
      metrics: [M.p95(), ordersFailed],
      parts: [
        { node: "u", text: "Users: 10 orders a second." },
        { node: "orders", text: "Order service: calls three services in turn." },
        { node: ["email", "stock", "stats"], text: "Email, Inventory, Analytics: 60, 40 and 120 ms." },
      ],
      beats: [
        { id: "sum", when: { at: 300 }, text: "Each order waits for all three: 60 + 40 + 120 ms, plus the trips.", focus: { nodes: ["orders"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash analytics.", focus: { action: "crash-stats" }, pause: true },
        { id: "down", when: { note: A_DOWN }, text: "Analytics is down. Its call fails, so the whole order fails.", focus: { nodes: ["stats", "orders"] }, pause: true },
        { id: "failing", when: { metric: ordersFailed, is: ">", value: 0.5 }, text: "Orders failed: {errors:problem}, all for a service the customer never sees.", focus: { metric: "Failed" } },
        { id: "back", when: { note: A_BACK }, text: "Analytics is back. Orders succeed again.", focus: { nodes: ["stats"] } },
      ],
      predict: {
        prompt: "Analytics is about to crash. With direct calls, orders will…",
        options: ["carry on as normal", "slow down", "fail"],
        answer: 2,
        before: "press",
        reveal: { beat: "failing", text: "{after} of orders failed while analytics was down." },
        track: { metric: ordersFailed },
        holds: (_, after) => after !== null && after > 0.5,
      },
      break: { action: "crash-stats", beat: "press" },
      build: direct,
    },
    {
      tone: "fix",
      short: "Pub/sub",
      title: "Publish one event; let subscribers listen",
      caption: "The order service announces “order placed” once and answers. Each listener gets its own copy.",
      actions: [crashStats],
      metrics: [M.p95(), ordersFailed, M.queue(["stats"], "Analytics backlog")],
      parts: [{ node: "topic", text: "Topic: copies each event to every listener." }],
      beats: [
        {
          id: "publish",
          when: { wait: 0 },
          text: "Orders answer as soon as the event is out: [[pub-sub|publish/subscribe]].",
          focus: { nodes: ["topic"] },
          term: "pub-sub",
        },
        { id: "press2", when: { wait: 0 }, text: "Press ⚡ Crash analytics: same crash, both worlds.", focus: { action: "crash-stats" }, pause: true },
        {
          id: "pile",
          when: { metric: M.queue(["stats"]), is: ">", value: 3 },
          text: "Analytics is down. Its copies wait in line for it.",
          focus: { nodes: ["stats"], dots: "waiting" },
          pause: true,
        },
        { id: "fine", when: { wait: 0 }, text: "Orders failed here: {errors:fix}. With direct calls: {errors:problem}.", focus: { metric: "Failed" } },
        { id: "catch", when: { note: A_BACK }, text: "Analytics is back and works through its waiting copies.", focus: { nodes: ["stats"], dots: "waiting" } },
      ],
      break: { action: "crash-stats", beat: "press2" },
      headline: {
        metric: "Response time",
        sentence: "Same orders. Calling everyone, the slowest 1 in 20 waited {p95:problem}; publishing, {p95:fix}. During the crash, {errors:fix} failed.",
        at: "fine",
      },
      build: () =>
        scene(
          [
            users("u", [6, 50], { rate: 10, keys: 50 }, "orders"),
            server("orders", [32, 50], { slots: 8, serviceMs: 30, label: "Order service", to: ["topic"] }),
            { id: "topic", kind: "topic", label: "“Order placed”", at: [58, 50], to: subs.map((s) => s.id) } satisfies NodeSpec,
            ...subs.map((s) => worker(s.id, [88, s.at], { slots: 3, serviceMs: s.ms, label: s.label })),
          ],
          { script: armedCrash("stats", 1400, 1500, A_DOWN, A_BACK), wideH: 460 },
        ),
    },
  ],
  checks: [
    {
      prompt: "Why did orders fail when analytics crashed?",
      options: ["Orders need analytics data", "Each order waited on every call, analytics included", "The topic was down"],
      answer: 1,
      why: "Direct calls make every order depend on every service; one failure fails the order.",
      focus: { nodes: ["orders"] },
    },
    {
      prompt: "With publish/subscribe, what must each listener be ready for?",
      options: ["Nothing", "Getting the same event twice", "Answering the user"],
      answer: 1,
      why: "Deliveries can repeat after failures, so listeners must cope with duplicates.",
      focus: { nodes: ["topic"] },
    },
  ],
  takeaways: {
    use: "Use it when several independent services react to the same event, and the publisher shouldn't care who they are.",
    catch: "Nobody waits for the subscribers, so you lose a single place to see the whole flow. Each subscriber must handle duplicates.",
    seen: "Amazon SNS, Google Pub/Sub, Kafka topics, Redis pub/sub.",
    rule: "Announce once; let listeners keep up.",
  },
};

export default pubsub;
