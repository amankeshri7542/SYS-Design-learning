import { M, armed, fault, scene, server, users } from "../kit";
import type { LessonScene } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// N9: three senders want 300 messages a second through one line that carries 200 (4 lanes, 20 ms each) with a buffer of
// 50. Each resends a message unanswered after 250 ms. At fixed windows of 30, the buffer fills, answers come back later
// than 250 ms, and the senders resend messages that weren't lost: the line fills with repeats and almost nothing gets
// through. With AIMD each window grows while answers return and halves on a loss, and the line stays busy with real work.

const GREEDY = "Sender C turns greedy";
const FAIR = "Sender C plays fair again";
const greedy = fault("greedy", "Add a greedy sender", "Make it fair again", GREEDY, FAIR, (s) => s.nodes.get("c")?.spec.client?.window?.mode !== "aimd");

const SENDERS = ["a", "b", "c"];
const FULL = { size: 30 };
const AIMD = { size: 1, max: 32, mode: "aimd" as const };

/** `aimd`: senders back off on loss. `greedyC`: sender C keeps a full window whatever happens. */
const line = (aimd: boolean, greedyC = false): SceneSpec => {
  const sender = (id: string, i: number): NodeSpec =>
    users(id, [8, 14 + 36 * i], { rate: 100, keys: 50, tag: id, timeoutMs: 250, retry: { mode: "now", max: 6 }, window: aimd && !(greedyC && id === "c") ? AIMD : FULL }, "rt", { label: `Sender ${id.toUpperCase()}` });
  return scene([...SENDERS.map(sender), { id: "rt", kind: "lb", glyph: "router", label: "Router", at: [44, 50], to: ["s"] }, server("s", [88, 50], { label: "Server", slots: 64, serviceMs: 2 })], {
    links: { "a>rt": 10, "b>rt": 10, "c>rt": 10, "rt>s": { ms: 20, parallel: 4, buffer: 50, label: "one line, 200 a second" } },
    windowMs: 1500,
    seed: 23,
    script: aimd
      ? armed({ node: "c", at: 2500, lastsMs: 3500, start: GREEDY, end: FAIR }, { start: (s) => s.reconfigure(line(true, true)), end: (s) => s.reconfigure(line(true)) })
      : undefined,
  });
};

const goodput = M.throughput({ label: "Goodput", hint: "Messages answered in time each second: useful work, not repeats." });
const sends: MetricSpec = { id: "amplify", label: "Sends per message", hint: "Times each message was sent, on average. ×1.0 means nothing was sent twice." };
const lost: MetricSpec = { id: "lost", label: "Lost", hint: "Share of messages dropped because the line's buffer was full." };
const win: MetricSpec = { id: "window", label: "Window", nodes: SENDERS, hint: "Messages each sender may have in flight right now, on average." };
const metrics = [goodput, sends, lost, win];

const congestion: LessonScene = {
  hook: "Why does a network get slower for everyone when everyone pushes harder?",
  dots: ["req", "ok", "gaveup", "lost"],
  figures: [
    {
      tone: "problem",
      short: "Full windows",
      title: "Everyone sends all they can",
      caption: "Three senders share one line to a server. Each keeps 30 messages in flight, and resends any unanswered after 250 ms.",
      metrics,
      parts: [
        { node: SENDERS, text: "Three senders: 100 messages a second each." },
        { node: "rt", text: "Router: one shared line, 200 a second." },
        { node: "s", text: "Server: answers in 2 ms." },
      ],
      beats: [
        { id: "pile", when: { at: 300 }, text: "Watch messages pile up at Router: three senders, one line.", focus: { nodes: ["rt"] }, pause: true },
        {
          id: "congestion",
          when: { wait: 0 },
          text: "More sent than the line can carry is [[congestion]]: it queues, then overflows.",
          focus: { link: ["rt", "s"] },
          term: "congestion",
        },
        { id: "lost", when: { metric: lost, is: ">", value: 0.05 }, text: "Read Lost: {lost} dropped where the line's buffer ran out of room.", focus: { metric: "Lost" } },
        { id: "resend", when: { metric: sends, is: ">", value: 1.5 }, text: "Late answers look lost, so senders resend: {amplify} sends per message.", focus: { metric: "Sends per message" } },
        {
          id: "collapse",
          when: { metric: goodput, is: "<", value: 50 },
          text: "Read Goodput: {throughput}. The line carries repeats: [[congestion-collapse|congestion collapse]].",
          focus: { metric: "Goodput" },
          term: "congestion-collapse",
        },
      ],
      predict: {
        prompt: "Next, each sender starts small, grows while answers come back, and halves on a loss. Goodput will…",
        options: ["Recover to near the line's limit", "Fall even further"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Goodput: {before} at full windows, {after} backing off." },
        track: { metric: goodput, world: 0, afterWorld: 1, same: true },
        holds: (_, after) => after !== null && after > 150,
      },
      build: () => line(false),
    },
    {
      tone: "fix",
      short: "Back off",
      title: "Grow slowly, halve on a loss",
      caption: "The same senders and line. Each window starts at one, grows while answers come back, and halves when one is lost.",
      actions: [greedy],
      metrics,
      beats: [
        {
          id: "aimd",
          when: { step: "enter" },
          text: "Now each window grows by one per round trip and halves on a loss: [[aimd|AIMD]].",
          focus: { nodes: SENDERS },
          term: "aimd",
        },
        { id: "saw", when: { wait: 0 }, text: "Watch Window climb, then drop by half: a sawtooth, feeling for room.", focus: { metric: "Window" } },
        { id: "compare", when: { wait: 0 }, text: "Compare Goodput: {throughput:fix} backing off, {throughput:problem} at full windows.", focus: { metric: "Goodput" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Add a greedy sender.", focus: { action: "greedy" }, pause: true },
        { id: "grab", when: { note: GREEDY }, text: "Sender C never backs off: it takes the line while A and B halve.", focus: { nodes: ["c"] } },
      ],
      break: { action: "greedy", beat: "press" },
      headline: { metric: "Goodput", sentence: "300 a second into a line for 200: {throughput:problem} got through at full windows, {throughput:fix} backing off." },
      build: () => line(true),
    },
  ],
  checks: [
    {
      prompt: "Why did goodput fall to almost nothing with full windows?",
      options: ["Late answers were resent, filling the line with repeats", "The server crashed"],
      answer: 0,
      why: "A full buffer made answers late, late looked lost, and the resends made the line fuller still.",
      focus: { link: ["rt", "s"] },
    },
    {
      prompt: "Why does every sender halve its window on a loss?",
      options: ["A loss means the line is full, so everyone backs off and shares", "To save memory"],
      answer: 0,
      why: "Loss is the network's only signal. If every sender halves, the line drains and each gets a fair share.",
      focus: { metric: "Window" },
    },
  ],
  takeaways: {
    use: "Any shared network path: senders must slow down when they see loss, not push harder.",
    catch: "It only works if every sender plays along. One that never backs off takes more than its share.",
    seen: "TCP Reno and CUBIC, Google's BBR, QUIC, adaptive retry modes in cloud SDKs.",
    rule: "Back off when the line is full.",
    interview: "Say: “Slow start, then additive increase and multiplicative decrease; loss is the signal to back off.”",
  },
};

export default congestion;
