import { M, database, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// A8: clicks on 20 ads arrive 300 a second, and one in five arrives up to 2 s after it happened. Writing a row per click
// keeps Counts busy all the time. A counter adds up each ad's clicks per window of when they happened and writes one
// row per ad as each window closes: almost no writes. But a window that closes at once drops the late clicks; waiting
// for them counts every click, and writes every total that much later. Slowed less than most lessons (`timeScale` 0.25)
// so a one-second window closes every few seconds on screen.

const clicks = (to: string): NodeSpec => users("u", [8, 50], { rate: 300, keys: 20, writes: 1, lateness: { share: 0.2, maxMs: 2000 } }, to, { label: "Clicks" });
const counts = database("db", [86, 50], { label: "Counts", slots: 4, serviceMs: 13 });
const opts = { links: { "api>db": 5, "counter>db": 5 }, timeScale: 0.25, windowMs: 4000, seed: 81 };

/** A row per click. */
const perClick = (): SceneSpec =>
  scene([clicks("api"), server("api", [46, 50], { label: "Click API", slots: 64, serviceMs: 1, blocking: true, calls: { write: ["db"] }, callTimeoutMs: 1500 }), counts], opts);

/** `sizeMs`: each window's length. `waitMs`: how long a window waits for late clicks once it has ended. */
const windowed = (sizeMs: number, waitMs: number): SceneSpec =>
  scene([clicks("counter"), server("counter", [46, 50], { label: "Counter", slots: 8, serviceMs: 1, window: { sizeMs, latenessMs: waitMs, to: "db" } }), counts], opts);

const busy = M.busy(["db"], "Counts busy", { hint: "Share of Counts' workers busy right now." });
const clickTime = M.p95({ label: "Click time", hint: "95% of clicks are answered faster than this (the p95)." });
const uncounted: MetricSpec = { id: "uncounted", label: "Clicks not counted", hint: "Share of clicks answered but never added to a total." };
const lag: MetricSpec = { id: "windowLag", label: "Totals written after", hint: "How long after a window opens its totals are written: its length, plus the wait for late clicks." };
const metrics = [busy, clickTime, uncounted, lag];

const streamWindows: LessonScene = {
  hook: "Three hundred clicks a second on twenty ads. Do you write three hundred rows?",
  dots: ["req", "late", "ok", "copy"],
  figures: [
    {
      tone: "problem",
      short: "Per click",
      title: "A row per click",
      caption: "Clicks on 20 ads arrive 300 a second; one in five arrives up to 2 s late. Each click adds one to its ad's row.",
      metrics,
      parts: [
        { node: "u", text: "Clicks: 300 a second, on 20 ads." },
        { node: "api", text: "Click API: writes each click to Counts." },
        { node: "db", text: "Counts: 13 ms a write, 4 at once.", sockets: true },
      ],
      beats: [
        { id: "each", when: { at: 300 }, text: "Watch every click become its own write to Counts.", focus: { link: ["api", "db"] } },
        { id: "busy", when: { metric: busy, is: ">", value: 0.85 }, text: "Read Counts busy: {util:db}. Twenty rows, written 300 times a second.", focus: { metric: "Counts busy" } },
        { id: "slow", when: { metric: clickTime, is: ">", value: 150 }, text: "Read Click time: {p95}. Each click waits its turn at Counts.", focus: { metric: "Click time" } },
      ],
      predict: {
        prompt: "Next, a counter adds up each ad's clicks every second and writes once per ad. Counts busy will…",
        options: ["Drop to almost nothing", "Fall by about half"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Counts busy: {before} writing every click, {after} writing totals." },
        track: { metric: busy, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before * 0.2,
      },
      build: () => perClick(),
    },
    {
      tone: "fix",
      short: "In windows",
      title: "Add up per second, write the totals",
      caption: "The same clicks. A counter adds them up per ad for each second, by when they happened, and writes each second's totals once.",
      knobs: [knob("size", "Window", 500, 5000, 500, 1000, ms), knob("wait", "Wait for late clicks", 0, 3000, 500, 0, ms)],
      metrics,
      beats: [
        {
          id: "window",
          when: { step: "enter" },
          text: "Now a counter adds up each ad's clicks per second: a [[stream-window|window]].",
          focus: { nodes: ["counter"] },
          term: "stream-window",
        },
        { id: "rows", when: { metric: lag, is: ">", value: 0 }, text: "Watch a window close: one row per ad goes to Counts.", focus: { link: ["counter", "db"] } },
        { id: "compare", when: { wait: 0 }, text: "Compare Counts busy: {util:db:fix} here, {util:db:problem} writing every click.", focus: { metric: "Counts busy" } },
        {
          id: "late",
          when: { metric: uncounted, is: ">", value: 0.05 },
          text: "Read Clicks not counted: {uncounted}. They came after their window closed: [[late-event|late events]].",
          focus: { metric: "Clicks not counted" },
          term: "late-event",
        },
        { id: "wait", when: { wait: 600 }, text: "Drag Wait for late clicks to 2 s: every click counted, every total 2 s later.", focus: { knob: "wait" } },
      ],
      headline: { metric: "Counts busy", sentence: "300 clicks a second on 20 ads: Counts {util:db:problem} busy writing each click, {util:db:fix} writing totals." },
      build: (v: Values) => windowed(v.size, v.wait),
    },
  ],
  checks: [
    {
      prompt: "Why does the counter write so much less than the Click API?",
      options: ["One row per ad per window, not one per click", "It drops most of the clicks"],
      answer: 0,
      why: "Totals are added up in memory: Counts sees 20 writes a second instead of 300.",
      focus: { nodes: ["db"] },
    },
    {
      prompt: "Waiting longer for late clicks counts them all. What does it cost?",
      options: ["Every total is written later", "More writes to Counts"],
      answer: 0,
      why: "A window can't close until its wait is over, so every total, and the dashboard reading it, runs that much behind.",
      focus: { knob: "wait" },
    },
  ],
  takeaways: {
    use: "Counting, summing or ranking a stream of events at volume: add up per key per window, then write the totals.",
    catch: "Totals live in memory until written (checkpoint them), and a wait for late events trades freshness for accuracy.",
    seen: "Apache Flink, Kafka Streams, Spark Structured Streaming, Google Dataflow and Apache Beam watermarks, ksqlDB.",
    rule: "Sum in the stream, write the totals.",
    interview: "Say: “Aggregate in event-time windows with a watermark for late events, and write one row per key per window.”",
  },
};

export default streamWindows;
