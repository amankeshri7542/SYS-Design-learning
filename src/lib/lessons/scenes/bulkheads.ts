import { M, armed, fault, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { SceneSpec } from "../../sim/types";

// R5: a shop server with 10 workers, each waiting on the call its request makes: checkout calls Payments, browsing
// calls Recommendations. When Recommendations slows to 1.2 s, browsing's calls hold every worker and checkout, which
// never calls Recommendations, has none left. A bulkhead keeps 4 workers for checkout; browsing can use the other 6.

const SLOW = "Recommendations slow down";
const OK = "Recommendations recover";
const slowRecs = fault("slow-recs", "Slow recommendations", "Speed them up", SLOW, OK, (s) => (s.nodes.get("recs")?.spec.serviceMs ?? 0) > 200);

/** `kept`: workers kept for checkout (0: one pool for everything). */
const shop = (kept: number, slow = false): SceneSpec =>
  scene(
    [
      users("buy", [8, 24], { rate: 12, keys: 50, tag: "checkout", writes: 1 }, "app", { label: "Checkout" }),
      users("look", [8, 76], { rate: 30, keys: 50, tag: "browse" }, "app", { label: "Browsing" }),
      server("app", [46, 50], {
        label: "Shop server",
        slots: 10,
        serviceMs: 10,
        blocking: true,
        calls: { write: ["pay"], read: ["recs"] },
        callTimeoutMs: 1500,
        bulkheads: kept ? { checkout: kept } : undefined,
      }),
      server("pay", [86, 24], { label: "Payments", slots: 8, serviceMs: 40 }),
      server("recs", [86, 76], { label: "Recommendations", slots: 32, serviceMs: slow ? 1200 : 40 }),
    ],
    {
      timeoutMs: 2000,
      windowMs: 1500,
      seed: 17,
      script: armed({ node: "recs", at: 1200, lastsMs: 3500, start: SLOW, end: OK }, { start: (s) => s.reconfigure(shop(kept, true)), end: (s) => s.reconfigure(shop(kept)) }),
    },
  );

const checkout = M.p95({ tag: "checkout", label: "Checkout response time", hint: "95% of checkouts are answered faster than this (the p95)." });
const metrics = [checkout, M.errors({ tag: "checkout", label: "Checkouts failed" }), M.busy(["app"], "Shop server busy")];

const bulkheads: LessonScene = {
  hook: "Recommendations get slow. Why can't anyone check out?",
  dots: ["req", "late", "ok", "gaveup", "failed"],
  figures: [
    {
      tone: "problem",
      short: "One pool",
      title: "One pool of workers for everything",
      caption: "Each of Shop server's 10 workers waits for its call: Payments for buyers, Recommendations for browsers.",
      actions: [slowRecs],
      metrics,
      parts: [
        { node: "buy", text: "Checkout: 12 a second, each calls Payments." },
        { node: "look", text: "Browsing: 30 a second, each calls Recommendations." },
        { node: "app", text: "Shop server: 10 workers, each waits on its call.", sockets: true },
        { node: ["pay", "recs"], text: "Payments and Recommendations: 40 ms each, for now." },
      ],
      beats: [
        { id: "calls", when: { at: 300 }, text: "Watch a worker wait for its call, then answer. Most of its time is waiting.", focus: { nodes: ["app"], sockets: true } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Slow recommendations.", focus: { action: "slow-recs" }, pause: true },
        { id: "fill", when: { metric: M.busy(["app"]), is: ">", value: 0.85 }, text: "Browsers' calls hang on Recommendations, and take every worker.", focus: { nodes: ["app"], sockets: true } },
        { id: "starve", when: { metric: checkout, is: ">", value: 600 }, text: "Checkout has no worker left: its slowest 1 in 20 take {p95:checkout}.", focus: { metric: "Checkout response time" } },
      ],
      predict: {
        prompt: "Recommendations get slow. Checkout, which never calls them, will…",
        options: ["Stay fast", "Slow down too"],
        answer: 1,
        before: "press",
        reveal: { beat: "starve", text: "Checkout response time: {before} before, {after} once Recommendations slowed." },
        track: { metric: checkout },
        holds: (before, after) => before !== null && after !== null && after > 2 * before,
      },
      break: { action: "slow-recs", beat: "press" },
      build: () => shop(0),
    },
    {
      tone: "fix",
      short: "Bulkheads",
      title: "A pool for each kind of work",
      caption: "4 of the 10 workers are kept for checkout. Browsing may use the other 6, and no more.",
      actions: [slowRecs],
      knobs: [knob("kept", "Checkout workers", 2, 6, 1, 4)],
      metrics,
      beats: [
        {
          id: "pools",
          when: { step: "enter" },
          text: "Now checkout has 4 workers of its own: a [[bulkhead]], like a ship's sealed compartments.",
          focus: { nodes: ["app"], sockets: true },
          term: "bulkhead",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Checkout response time: {p95:checkout:fix} here, {p95:checkout:problem} with one pool.", focus: { metric: "Checkout response time" } },
        { id: "still", when: { wait: 0 }, text: "Browsing still suffers: its 6 workers wait on slow Recommendations.", focus: { link: ["app", "recs"] } },
        { id: "fewer", when: { wait: 600 }, text: "Drag Checkout workers to 2: fewer kept back, and buyers start to queue.", focus: { knob: "kept" } },
      ],
      headline: {
        metric: "Checkout response time",
        sentence: "Recommendations slow: checkout's slowest 1 in 20 take {p95:checkout:problem} with one pool, {p95:checkout:fix} with a bulkhead.",
        at: "starve",
      },
      build: (v: Values) => shop(v.kept),
    },
  ],
  checks: [
    {
      prompt: "A slow dependency used only by browsing is breaking checkout. What's happening?",
      options: ["Its calls hold all the shared workers", "Checkout secretly calls it"],
      answer: 0,
      why: "Workers waiting on the slow calls aren't free for anything else. Shared pools let one problem spread.",
      focus: { nodes: ["app"], sockets: true },
    },
    {
      prompt: "What does a bulkhead give up?",
      options: ["Some flexibility: idle kept workers can't help the rest", "Nothing at all"],
      answer: 0,
      why: "Workers kept for checkout sit idle when checkout is quiet. You trade some capacity for isolation.",
      focus: { knob: "kept" },
    },
  ],
  takeaways: {
    use: "Give each dependency, or each kind of customer, its own pool of workers or connections.",
    catch: "Kept workers can sit idle while others queue; size each pool from real traffic.",
    seen: "Hystrix and Resilience4j thread pools, separate connection pools per service, Kubernetes resource quotas.",
    rule: "One slow part shouldn't sink the ship.",
  },
};

export default bulkheads;
