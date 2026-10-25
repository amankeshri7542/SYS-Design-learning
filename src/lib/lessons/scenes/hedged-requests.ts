import { M, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// R8: a page is built from five shards, asked all at once; it is ready when the last one answers. Each shard answers in
// about 20 ms, but one request in 20 takes twelve times as long, so most pages wait for some straggler. Hedging sends a
// second copy of any part not answered within a delay; the first answer wins and the other is cancelled. The tail
// collapses for a few percent more requests to the shards.

const SHARDS = ["s1", "s2", "s3", "s4", "s5"];

/** `hedgeMs`: when to send a part's second copy (0: never). */
const page = (hedgeMs: number): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 40, keys: 50 }, "page", { label: "Users" }),
      server("page", [36, 50], { label: "Page server", slots: 32, serviceMs: 2, blocking: true, fanout: { to: SHARDS }, hedgeMs: hedgeMs || undefined, callTimeoutMs: 1500 }),
      ...SHARDS.map((id, i) => server(id, [82, 10 + 20 * i], { label: `Shard ${i + 1}`, slots: 8, serviceMs: 20, tail: { share: 0.05, mult: 12 } })),
    ],
    { links: Object.fromEntries(SHARDS.map((id) => [`page>${id}`, 5])), windowMs: 3000, seed: 71 },
  );

const hedged: MetricSpec = { id: "hedged", label: "Sent twice", hint: "Share of the requests to shards that were slow enough to get a second copy." };
const metrics = [M.p95({ label: "Page within", hint: "95% of pages are ready within this time (the p95)." }), M.p50({ label: "Typical page" }), hedged];

const hedgedRequests: LessonScene = {
  hook: "Every server is fast. Why is the page still slow so often?",
  dots: ["req", "late", "ok", "gaveup"],
  figures: [
    {
      tone: "problem",
      short: "The tail",
      title: "Wait for the slowest of five",
      caption: "A page asks five shards at once and waits for all five. Each takes 20 ms, but one in 20 is twelve times slower.",
      metrics,
      parts: [
        { node: "u", text: "Users: 40 pages a second." },
        { node: "page", text: "Page server: asks all five shards at once." },
        { node: SHARDS, text: "Shards: 20 ms, but one in 20 is slow." },
      ],
      beats: [
        { id: "fan", when: { at: 300 }, text: "Watch each page fan out to five shards, then wait for all five answers.", focus: { nodes: SHARDS } },
        {
          id: "tail",
          when: { metric: M.p95(), is: ">", value: 150 },
          text: "Read Page within: {p95}. One slow shard makes the whole page slow: [[tail-latency|tail latency]].",
          focus: { metric: "Page within" },
          term: "tail-latency",
        },
        { id: "odds", when: { wait: 0 }, text: "Five shards, each slow one time in 20: about one page in four meets a straggler.", focus: { nodes: ["page"] } },
      ],
      predict: {
        prompt: "Next, a shard that hasn't answered in 60 ms gets asked again, and the first answer wins. Page within will…",
        options: ["Drop a lot", "Barely change"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Page within: {before} waiting for every straggler, {after} hedged." },
        track: { metric: M.p95({ label: "Page within" }), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before * 0.6,
      },
      build: () => page(0),
    },
    {
      tone: "fix",
      short: "Hedged",
      title: "Ask again after 60 ms",
      caption: "The same page and shards. A shard that hasn't answered within 60 ms is asked again; the first answer wins, and the other is cancelled.",
      knobs: [knob("hedge", "Ask again after", 20, 200, 10, 60, ms)],
      metrics,
      beats: [
        {
          id: "twin",
          when: { step: "enter" },
          text: "Now a part not back in 60 ms gets a second copy: a [[hedged-request|hedged request]].",
          focus: { nodes: ["page"] },
          term: "hedged-request",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Page within: {p95:fix} hedged, {p95:problem} waiting for stragglers.", focus: { metric: "Page within" } },
        { id: "cost", when: { wait: 0 }, text: "The cost: {hedged} of requests to shards sent twice.", focus: { metric: "Sent twice" } },
        { id: "early", when: { wait: 600 }, text: "Drag Ask again after to 20 ms: faster pages, but far more copies.", focus: { knob: "hedge" } },
      ],
      headline: { metric: "Page within", sentence: "Five shards, one slow in 20: pages within {p95:problem} waiting for each, {p95:fix} hedged after 60 ms." },
      build: (v: Values) => page(v.hedge),
    },
  ],
  checks: [
    {
      prompt: "Why is a page that asks five shards slow more often than any one shard?",
      options: ["It waits for the slowest of the five", "The shards slow each other down"],
      answer: 0,
      why: "One in 20 per shard becomes about one in four per page: the chance that at least one of five is slow.",
      focus: { nodes: SHARDS },
    },
    {
      prompt: "Why hedge after a delay instead of asking twice every time?",
      options: ["Only the few slow ones get a second copy", "It's simpler"],
      answer: 0,
      why: "Waiting until about the 95th percentile means only about one request in 20 is duplicated, for most of the gain.",
      focus: { knob: "hedge" },
    },
  ],
  takeaways: {
    use: "Read requests that fan out to many servers, or any call whose tail is long: hedge after about the 95th percentile.",
    catch: "Only for requests safe to send twice, and hedging too early doubles the load exactly when servers are busiest.",
    seen: "Google's “The Tail at Scale”, gRPC hedging policy, Cassandra speculative retry, Bigtable and Spanner reads.",
    rule: "Ask twice only when it's late.",
    interview: "Say: “Fan-out makes the tail the common case; hedge after the p95 and cancel the loser.”",
  },
};

export default hedgedRequests;
