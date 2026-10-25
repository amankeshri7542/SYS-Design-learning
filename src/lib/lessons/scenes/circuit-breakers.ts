import { M, armed, fault, knob, ms, scene, server, users } from "../kit";
import type { LessonScene } from "../types";

const HANG = "Payments starts hanging";
const RECOVER = "Payments recovers";
const hang = fault("hang", "Make payments hang", "Restore payments", HANG, RECOVER, (s) => s.nodes.get("pay")?.up === false);

const shop = (breaker: { threshold: number; cooldownMs: number } | undefined) =>
  scene(
    [
      users("u", [6, 50], { rate: 30, keys: 50, writes: 0.35 }, "shop", { label: "Shoppers" }),
      server("shop", [42, 50], {
        label: "Shop server",
        slots: 8,
        serviceMs: 30,
        queueMax: 40,
        calls: { read: [], write: ["pay"] },
        blocking: true,
        callTimeoutMs: 900,
        breaker,
      }),
      server("pay", [86, 50], { slots: 4, serviceMs: 60, downMode: "hang", label: "Payments" }),
    ],
    {
      timeoutMs: 2000,
      // Armed: the learner makes payments hang; it recovers 2.4 s later.
      script: armed({ node: "pay", at: 1200, lastsMs: 2400, start: HANG, end: RECOVER }, { start: (s) => s.setUp("pay", false), end: (s) => s.setUp("pay", true) }),
    },
  );

const browse = M.p95({ op: "read", label: "Browsing response time" });

const breakers: LessonScene = {
  hook: "Payments stops answering. Why can't customers even browse the shop?",
  dots: ["req", "late", "ok", "gaveup", "turned", "failed"],
  figures: [
    {
      tone: "problem",
      short: "No breaker",
      title: "Waiting on payments that hang",
      caption: "Checkouts call payments and wait up to 0.9 s for it. Browsing doesn't call it at all.",
      actions: [hang],
      metrics: [browse, M.errors({ op: "write", label: "Checkouts failed" }), M.busy(["shop"], "Shop server busy")],
      parts: [
        { node: "u", text: "Shoppers: 30 a second, a third checking out." },
        { node: "shop", text: "Shop server: 8 workers; checkouts wait on payments.", sockets: true },
        { node: "pay", text: "Payments: 4 workers, 60 ms each." },
      ],
      beats: [
        { id: "calm", when: { at: 300 }, text: "Checkouts call Payments; browsing is answered by the shop alone.", focus: { nodes: ["shop"], link: ["shop", "pay"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Make payments hang.", focus: { action: "hang" }, pause: true },
        {
          id: "stuck",
          when: { note: HANG },
          text: "Payments takes requests and never answers. Each checkout holds a worker, waiting.",
          focus: { nodes: ["shop"], sockets: true },
          pause: true,
        },
        {
          id: "full",
          when: { metric: M.busy(["shop"]), is: ">", value: 0.9 },
          text: "Every worker is stuck. Even browsing now waits in line.",
          focus: { nodes: ["shop"], dots: "waiting" },
        },
        {
          id: "browse",
          when: { metric: browse, is: ">", value: 400 },
          text: "Browsing's slowest 1 in 20: {p95:problem}, though browsing never calls Payments.",
          focus: { metric: "Browsing response time" },
        },
      ],
      predict: {
        prompt: "Payments is about to hang. Browsing never calls it. Browsing will…",
        options: ["carry on as normal", "slow down too", "fail outright"],
        answer: 1,
        before: "press",
        reveal: { beat: "browse", text: "Browsing's slowest 1 in 20 went from {before} to {after}." },
        track: { metric: browse },
        holds: (before, after) => before !== null && after !== null && after > 2 * before,
      },
      break: { action: "hang", beat: "press" },
      build: () => shop(undefined),
    },
    {
      tone: "fix",
      short: "Breaker",
      title: "Stop calling after repeated failures",
      caption: "After five failures in a row, the shop stops calling payments for a cool-down.",
      knobs: [knob("cool", "Cool-down", 200, 2000, 100, 600, ms)],
      actions: [hang],
      metrics: [browse, { id: "fallback", label: "Checkouts fast-failed", op: "write", hint: "Checkouts answered instantly by the open breaker." }, M.busy(["shop"], "Shop server busy")],
      beats: [
        { id: "press2", when: { wait: 0 }, text: "Press ⚡ Make payments hang: same fault, both worlds.", focus: { action: "hang" }, pause: true },
        {
          id: "hanging",
          when: { note: HANG },
          text: "Payments hangs here too. Checkouts wait up to 0.9 s, then fail. Watch Shop server's pill.",
          focus: { nodes: ["shop"] },
        },
        {
          id: "open",
          when: { fx: "open", node: "shop" },
          text: "Five failures in a row: the [[circuit-breaker|circuit breaker]] opens. Checkouts now fail fast: grey squares.",
          focus: { nodes: ["shop"], dots: "turned" },
          pause: true,
          term: "circuit-breaker",
        },
        {
          id: "browsing",
          when: { wait: 0 },
          text: "Browsing's slowest 1 in 20: {p95:fix} here, {p95:problem} without a breaker.",
          focus: { metric: "Browsing response time" },
        },
        { id: "close", when: { fx: "close", node: "shop" }, text: "Payments is back. One trial call works, so the breaker closes.", focus: { nodes: ["shop"] } },
      ],
      break: { action: "hang", beat: "press2" },
      headline: {
        metric: "Browsing response time",
        sentence: "Same hang. Browsing's slowest 1 in 20 took {p95:problem} without a breaker, {p95:fix} with one.",
        at: "browsing",
      },
      build: (v) => shop({ threshold: 5, cooldownMs: v.cool }),
    },
  ],
  checks: [
    {
      prompt: "Why did browsing slow down without a breaker?",
      options: ["Browsing calls payments", "Stuck checkouts held every worker", "The database was slow"],
      answer: 1,
      why: "Each hung checkout held a worker; with none free, browsing waited in line too.",
      focus: { nodes: ["shop"], sockets: true },
    },
    {
      prompt: "After the cool-down, the breaker…",
      options: ["closes for good", "lets one trial call through", "stays open"],
      answer: 1,
      why: "One trial tests payments: success closes the breaker, failure opens it again.",
      focus: { nodes: ["shop"] },
    },
  ],
  takeaways: {
    use: "Wrap every call to a remote dependency that can slow down or hang, especially non-critical ones.",
    catch: "Users still lose the feature while the breaker is open. Design what they see instead: a fallback, a cached value, or a clear message.",
    seen: "Resilience4j, Polly, Envoy outlier detection, Netflix Hystrix.",
    rule: "Fail fast when a dependency hangs.",
  },
};

export default breakers;
