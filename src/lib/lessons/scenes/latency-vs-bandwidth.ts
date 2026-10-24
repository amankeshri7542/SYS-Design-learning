import { M, choice, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

// N3: one line, two kinds of answer. A 1 MB file next door is all sending time (bandwidth); a 2 KB page from Sydney is
// all travel time (latency). Every request is the same size in the trace; the answer's size lives in the link's
// per-answer sending time, so both steps see identical traffic. The line sends one answer at a time (`parallel: 1`).

const SPEEDS = [5, 10, 20, 50, 100];
const bandwidth = (value: number) => choice("bw", "Bandwidth, Mb/s", SPEEDS.map(String), value);

/** `megabits`: the answer's size. `bw`: the line's megabits a second. `away`: one way, in ms. */
const n3 = (megabits: number, bw: number, away: number) =>
  scene([users("u", [14, 50], { rate: 1.2, keys: 50 }, "app", { label: "User" }), server("app", [86, 50], { slots: 4, serviceMs: 5, label: "Server" })], {
    links: { "u>app": { ms: away, perCostMs: (megabits / bw) * 1000, parallel: 1, label: `${bw} Mb/s, ${away} ms away` } },
    windowMs: 4000,
    seed: 3,
  });

const FILE = 8; // 1 MB
const PAGE = 0.016; // 2 KB
const metrics = [M.p50(), M.wire()];

const latencyVsBandwidth: LessonScene = {
  hook: "Why doesn't a faster internet plan make every website faster?",
  dots: ["req", "ok"],
  figures: [
    {
      tone: "tradeoff",
      short: "Big file",
      title: "A big file next door",
      caption: "A 1 MB file from a server 5 ms away, over a 20 megabit line.",
      knobs: [bandwidth(2), knob("away", "Distance", 5, 150, 5, 5, (v) => `${ms(v)} each way`)],
      metrics,
      parts: [
        { node: "u", text: "User: asks for a 1 MB file." },
        { node: "app", text: "Server: 5 ms away, answers in 5 ms." },
      ],
      beats: [
        { id: "stream", when: { at: 1100 }, text: "Watch the green answer stretch along the wire: 1 MB, sent bit by bit.", focus: { link: ["u", "app"] }, pause: true },
        {
          id: "bandwidth",
          when: { wait: 0 },
          text: "Its length is [[bandwidth]]: 20 megabits a second, so 1 MB takes 400 ms.",
          focus: { link: ["u", "app"] },
          term: "bandwidth",
        },
        {
          id: "latency",
          when: { wait: 0 },
          text: "The first bit lands after just 5 ms: the wire's [[latency]]. The rest is the file.",
          focus: { link: ["u", "app"] },
          term: "latency",
        },
        { id: "total", when: { metric: M.p50(), is: ">", value: 0 }, text: "Read Typical response: {p50}, nearly all of it sending the file.", focus: { metric: "Typical response" } },
        { id: "faster", when: { wait: 0 }, text: "Drag Bandwidth to 50 Mb/s: the time drops to a fifth of a second.", focus: { knob: "bw" } },
      ],
      predict: {
        prompt: "Next: a 2 KB page from Sydney, 80 ms away, on the same line. Compared with this file, it arrives…",
        options: ["Sooner", "Later: it's 16 times farther"],
        answer: 0,
        before: "end",
        reveal: { beat: "sooner", text: "Typical response: {before} for the file next door, {after} for the page from Sydney." },
        track: { metric: M.p50(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before,
      },
      build: (v: Values) => n3(FILE, SPEEDS[v.bw], v.away),
    },
    {
      tone: "tradeoff",
      short: "Far page",
      title: "A small page far away",
      caption: "A 2 KB page from a server in Sydney, 80 ms away, over the same 20 megabit line.",
      knobs: [bandwidth(2), knob("away", "Distance", 5, 150, 5, 80, (v) => `${ms(v)} each way`)],
      metrics,
      beats: [
        { id: "sooner", when: { step: "enter" }, text: "Compare: {p50:2} for the page from Sydney, {p50:1} for the file next door.", focus: { metric: "Typical response" } },
        { id: "dash", when: { wait: 0 }, text: "Watch an answer cross: a dot, not a bar. 2 KB sends in under 1 ms.", focus: { link: ["u", "app"] } },
        {
          id: "bdp",
          when: { wait: 0 },
          text: "Bandwidth × round trip is the [[bdp|bandwidth-delay product]]: how much the wire holds at once.",
          focus: { link: ["u", "app"] },
          term: "bdp",
        },
        { id: "closer", when: { wait: 600 }, text: "Drag Bandwidth to 100: nothing changes. Drag Distance down: the time falls with it.", focus: { knob: "away" } },
      ],
      headline: {
        metric: "Typical response",
        sentence: "On one 20 megabit line: {p50:1} for 1 MB next door, {p50:2} for 2 KB from Sydney.",
      },
      build: (v: Values) => n3(PAGE, SPEEDS[v.bw], v.away),
    },
  ],
  checks: [
    {
      prompt: "A 4 MB download over a 40 megabit line, 10 ms away. About how long does it take?",
      options: ["20 ms", "0.8 s", "8 s"],
      answer: 1,
      why: "4 MB is 32 megabits; at 40 a second that is 0.8 s. The 10 ms of distance barely shows.",
      focus: { link: ["u", "app"] },
    },
    {
      prompt: "A chat app sends tiny messages to users on another continent. What gets them there sooner?",
      options: ["More bandwidth", "Servers closer to the users"],
      answer: 1,
      why: "Tiny messages are all latency. More bandwidth only shortens big transfers; distance sets the floor.",
      focus: { link: ["u", "app"] },
    },
  ],
  takeaways: {
    use: "Buy bandwidth for big transfers; move closer for small, chatty ones.",
    catch: "No bandwidth upgrade fixes latency. A far server stays far at any speed.",
    seen: "Video and downloads need bandwidth; APIs, games and chat need low latency.",
    rule: "Big needs bandwidth. Small needs nearness.",
  },
};

export default latencyVsBandwidth;
