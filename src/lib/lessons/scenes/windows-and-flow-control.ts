import { M, armed, fault, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// N6: a sender with 100 messages a second for a receiver 25 ms away (a 55 ms round trip with its work). One message at a
// time delivers about 18 a second. A window of 12 keeps up, until the receiver slows to 40 a second: then its buffer of
// 8 overflows and messages are dropped. With flow control the receiver says how much room it has, and the sender waits.

const SLOW = "The receiver slows down";
const FAST = "The receiver is back to speed";
const slow = fault("slow", "Slow the receiver", "Speed it up again", SLOW, FAST, (s) => (s.nodes.get("r")?.spec.serviceMs ?? 0) > 10);
const windowKnob = knob("size", "Window", 1, 16, 1, 12, (v) => `${v} in flight`);

/** `size`: messages in flight at once. `flow`: the receiver advertises its room. `slowed`: it works at 40 a second. */
const link = (size: number, flow: boolean, slowed = false): SceneSpec =>
  scene(
    [
      users("u", [14, 50], { rate: 100, keys: 50, window: { size }, timeoutMs: 1500 }, "r", { label: "Sender" }),
      server("r", [86, 50], { label: "Receiver", slots: 1, serviceMs: slowed ? 25 : 6, queueMax: 8, advertise: flow ? { high: 8, low: 3 } : undefined }),
    ],
    {
      links: { "u>r": { ms: 25, label: "25 ms each way" } },
      windowMs: 1500,
      seed: 21,
      script: armed({ node: "r", at: 2000, lastsMs: 3000, start: SLOW, end: FAST }, { start: (s) => s.reconfigure(link(size, flow, true)), end: (s) => s.reconfigure(link(size, flow)) }),
    },
  );

const delivered = M.throughput({ label: "Delivered", hint: "Messages answered each second (simulated time)." });
const dropped = M.errors({ label: "Dropped", hint: "Share of messages the receiver had no room for, so they were thrown away." });
const waiting: MetricSpec = { id: "sendWait", label: "Waiting to send", hint: "95% of messages waited at most this long at the sender before going out." };
const win: MetricSpec = { id: "window", label: "Window", nodes: ["u"], hint: "How many messages the sender may have in flight right now." };
const metrics = [delivered, dropped, waiting, win];

const windows: LessonScene = {
  hook: "The line is fast, so why does sending a big file still crawl?",
  dots: ["req", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "One at a time",
      title: "Send one, wait for its answer",
      caption: "Sender has 100 messages a second for a receiver 25 ms away, and sends each only after the last one's answer.",
      metrics,
      parts: [
        { node: "u", text: "Sender: 100 messages a second to send." },
        { node: "r", text: "Receiver: 25 ms away, about 160 a second.", sockets: true },
      ],
      beats: [
        { id: "one", when: { at: 300 }, text: "Watch Sender send one message, then wait for its answer before the next.", focus: { link: ["u", "r"] }, pause: true },
        {
          id: "stop",
          when: { wait: 0 },
          text: "That's [[stop-and-wait]]: one message per round trip, however fast the line.",
          focus: { link: ["u", "r"] },
          term: "stop-and-wait",
        },
        { id: "rate", when: { metric: delivered, is: ">", value: 0 }, text: "Read Delivered: {throughput}, one for each 55 ms round trip.", focus: { metric: "Delivered" } },
        { id: "backlog", when: { metric: waiting, is: ">", value: 1000 }, text: "Count the backlog at Sender: messages now wait {sendWait} to go out.", focus: { nodes: ["u"], dots: "waiting" } },
      ],
      predict: {
        prompt: "Next, Sender keeps up to 12 messages in flight at once. Delivered will…",
        options: ["Rise to keep up", "Stay about the same"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Delivered: {before} one at a time, {after} with 12 in flight." },
        track: { metric: delivered, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after > 3 * before,
      },
      build: () => link(1, false),
    },
    {
      tone: "fix",
      short: "A window",
      title: "Keep several in flight",
      caption: "Sender keeps up to 12 messages in flight at once. Receiver keeps up to 8 waiting in its buffer.",
      knobs: [windowKnob],
      actions: [slow],
      metrics,
      beats: [
        {
          id: "window",
          when: { step: "enter" },
          text: "Now Sender keeps up to 12 in flight: a [[sliding-window|window]].",
          focus: { link: ["u", "r"] },
          term: "sliding-window",
        },
        { id: "compare", when: { metric: delivered, is: ">", value: 30 }, text: "Compare Delivered: {throughput:2} with a window, {throughput:1} one at a time.", focus: { metric: "Delivered" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Slow the receiver.", focus: { action: "slow" }, pause: true },
        { id: "drop", when: { metric: dropped, is: ">", value: 0.05 }, text: "Receiver's buffer overflows: {errors} of messages dropped, sent for nothing.", focus: { nodes: ["r"] } },
      ],
      break: { action: "slow", beat: "press" },
      headline: { metric: "Delivered", sentence: "100 messages a second to send: {throughput:1} delivered one at a time, {throughput:2} with a window." },
      build: (v: Values) => link(v.size, false),
    },
    {
      tone: "fix",
      short: "Flow control",
      title: "The receiver sets the pace",
      caption: "The same window. With each answer, Receiver says how much room its buffer has left, and Sender never sends more.",
      knobs: [windowKnob],
      actions: [slow],
      metrics,
      beats: [
        {
          id: "room",
          when: { step: "enter" },
          text: "Now each answer says how much room Receiver has left: [[flow-control|flow control]].",
          focus: { nodes: ["r"] },
          term: "flow-control",
        },
        { id: "press-flow", when: { wait: 0 }, text: "Press ⚡ Slow the receiver.", focus: { action: "slow" }, pause: true },
        { id: "shrink", when: { note: SLOW }, text: "Watch Window shrink as Receiver's buffer fills: Sender waits instead of sending.", focus: { metric: "Window" } },
        { id: "none", when: { wait: 1200 }, text: "Compare Dropped: {errors:3} with flow control, {errors:2} without.", focus: { metric: "Dropped" } },
      ],
      break: { action: "slow", beat: "press-flow" },
      build: (v: Values) => link(v.size, true),
    },
  ],
  checks: [
    {
      prompt: "Why does stop-and-wait waste a fast line?",
      options: ["The line sits empty for a round trip between messages", "Each message gets bigger"],
      answer: 0,
      why: "Only one message is ever on the wire. A window keeps the line busy while answers travel back.",
      focus: { link: ["u", "r"] },
    },
    {
      prompt: "What does flow control protect?",
      options: ["The receiver's buffer", "The network between them"],
      answer: 0,
      why: "The receiver says how much room it has, and the sender never sends more. Sparing the network is congestion control.",
      focus: { nodes: ["r"] },
    },
  ],
  takeaways: {
    use: "Any stream of messages over a long link: keep several in flight, and let the receiver set the limit.",
    catch: "A window bigger than the receiver can take just fills its buffer; bigger than the network can carry, it causes loss.",
    seen: "TCP's sliding and receive windows, HTTP/2 flow control, gRPC streaming, a Kafka producer's in-flight limit.",
    rule: "Fill the pipe, not the receiver.",
    interview: "Say: “A window fills the bandwidth-delay product; the receiver's advertised window stops it overflowing.”",
  },
};

export default windows;
