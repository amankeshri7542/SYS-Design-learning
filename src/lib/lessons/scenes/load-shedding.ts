import { M, armed, fault, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// R4: buyers and browsers share one shop server (4 workers, 50 ms each: 80 a second). A spike triples browsing to 110 a
// second. In one first-come line everyone waits, buyers too, and users who gave up after 1 s are still served. Shedding
// turns browsing away once 8 are waiting (never checkout), and checkout goes to the front of the line.

const SPIKE = "Browsing traffic spikes";
const CALM = "Traffic calms down";
const spike = fault("spike", "Make traffic spike", "Calm it down", SPIKE, CALM, (s) => {
  const rate = s.nodes.get("look")?.spec.client?.rate;
  return typeof rate === "number" && rate > 50;
});
/** `shedAt`: line length past which browsing is turned away, with checkout served first (0: one line, oldest first). */
const shop = (shedAt: number, spiking = false): SceneSpec => {
  const rules: Partial<NodeSpec> = shedAt ? { shed: { queueAbove: shedAt, keep: ["checkout"] }, priority: ["checkout"] } : {};
  return scene(
    [
      users("buy", [8, 24], { rate: 10, keys: 50, tag: "checkout" }, "app", { label: "Checkout" }),
      users("look", [8, 76], { rate: spiking ? 110 : 30, keys: 50, tag: "browse" }, "app", { label: "Browsing" }),
      server("app", [80, 50], { label: "Shop server", slots: 4, serviceMs: 50, queueMax: 400, ...rules }),
    ],
    {
      timeoutMs: 1000,
      windowMs: 1500,
      seed: 16,
      script: armed({ node: "look", at: 1200, lastsMs: 3500, start: SPIKE, end: CALM }, { start: (s) => s.reconfigure(shop(shedAt, true)), end: (s) => s.reconfigure(shop(shedAt)) }),
    },
  );
};

const checkout = M.p95({ tag: "checkout", label: "Checkout response time", hint: "95% of checkouts are answered faster than this (the p95)." });
const browsing = M.p95({ tag: "browse", label: "Browsing response time", hint: "95% of answered browsing requests are faster than this (the p95)." });
const wasted: MetricSpec = { id: "wasted", label: "Wasted work", hint: "Share of the workers' time spent on requests whose user had already given up." };
const turned: MetricSpec = { id: "rejected", label: "Turned away", hint: "Requests refused at once because the line was too long." };
const metrics = [checkout, browsing, wasted, turned];

const shedding: LessonScene = {
  hook: "When you can't serve everyone, who should wait, and who should hear no?",
  dots: ["req", "late", "ok", "gaveup", "turned", "failed"],
  figures: [
    {
      tone: "problem",
      short: "One line",
      title: "First come, all served late",
      caption: "Buyers and browsers wait in one line, oldest first. Users give up after 1 s.",
      actions: [spike],
      metrics,
      parts: [
        { node: "buy", text: "Checkout: 10 a second, the ones who pay." },
        { node: "look", text: "Browsing: 30 a second, just looking." },
        { node: "app", text: "Shop server: 4 workers, 50 ms each.", sockets: true },
      ],
      beats: [
        { id: "calm", when: { at: 300 }, text: "Everyone shares one line at Shop server, first come, first served.", focus: { nodes: ["app"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Make traffic spike.", focus: { action: "spike" }, pause: true },
        { id: "line", when: { metric: M.queue(["app"]), is: ">", value: 20 }, text: "Watch the line outgrow what 4 workers can clear. Buyers wait in it too.", focus: { nodes: ["app"], dots: "waiting" } },
        { id: "buyers", when: { metric: checkout, is: ">", value: 700 }, text: "Read Checkout response time: {p95:checkout}, as slow as browsing.", focus: { metric: "Checkout response time" } },
        { id: "waste", when: { metric: wasted, is: ">", value: 0.3 }, text: "Count Wasted work: {wasted}. Users gave up, yet the server still serves them.", focus: { metric: "Wasted work" } },
      ],
      predict: {
        prompt: "Browsing triples for a few seconds. Checkout, a small share of traffic, will…",
        options: ["Stay fast: it's small", "Slow down like everyone"],
        answer: 1,
        before: "press",
        reveal: { beat: "buyers", text: "Checkout response time: {before} before the spike, {after} during it." },
        track: { metric: checkout },
        holds: (before, after) => before !== null && after !== null && after > 2 * before,
      },
      break: { action: "spike", beat: "press" },
      build: () => shop(0),
    },
    {
      tone: "fix",
      short: "Shedding",
      title: "Shed early, serve what matters",
      caption: "Past 8 waiting, new browsing is turned away at once. Checkout is never turned away, and goes first.",
      actions: [spike],
      knobs: [knob("shed", "Shed above", 2, 40, 2, 8, (v) => `${v} waiting`)],
      metrics,
      beats: [
        {
          id: "limit",
          when: { step: "enter" },
          text: "Now the line has a limit, and checkout skips ahead: [[load-shedding|load shedding]] with priority.",
          focus: { nodes: ["app"] },
          term: "load-shedding",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Checkout response time: {p95:checkout:fix} here, {p95:checkout:problem} in one line.", focus: { metric: "Checkout response time" } },
        { id: "slate", when: { wait: 0 }, text: "Slate squares are browsers told “busy” at once, not left to time out.", focus: { dots: "turned" } },
        { id: "longer", when: { wait: 600 }, text: "Drag Shed above to 40: the line, and every wait, grows long again.", focus: { knob: "shed" } },
      ],
      headline: {
        metric: "Checkout response time",
        sentence: "During the spike, checkout's slowest 1 in 20: {p95:checkout:problem} in one line, {p95:checkout:fix} with shedding.",
        at: "buyers",
      },
      build: (v: Values) => shop(v.shed),
    },
  ],
  checks: [
    {
      prompt: "Under overload, why turn some requests away instead of queueing them all?",
      options: ["So the ones you serve are still on time", "To save memory"],
      answer: 0,
      why: "A long line makes everyone late, and many give up anyway. A fast no keeps the rest fast.",
      focus: { dots: "turned" },
    },
    {
      prompt: "Which requests should a shop shed first?",
      options: ["Checkout", "Browsing"],
      answer: 1,
      why: "Losing a browse costs a page view; losing a checkout costs a sale. Shed what matters least.",
      focus: { metric: "Checkout response time" },
    },
  ],
  takeaways: {
    use: "Any service that can be overloaded: bound the line, turn work away early, and protect what matters most.",
    catch: "Clients must treat “busy” as a reason to back off, not to retry at once, or shedding feeds the overload.",
    seen: "HTTP 503 with Retry-After, Envoy's admission control, priority queues in payment systems, CoDel.",
    rule: "A fast no beats a slow yes.",
  },
};

export default shedding;
