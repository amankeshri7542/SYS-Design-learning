import { M, knob, perSecond, rush, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

// F1's traffic: a calm 20 a second, then a rush to 44 that peaks 2.5 s into the scene, once the parts have been
// introduced, a short line has been named and the prediction made. The line it builds is counted 21 s in on screen.
// Seed 24 keeps the calm calm (`npm run tune -- latency-and-throughput --beats` shows the timeline).
const f1Traffic = { rate: rush(20, 44, 1900, 1200, 3400), keys: 50 };
const f1Queue = M.queue(["app"], "Waiting at Server");
const f1Busy = M.busy(["app"]);

const latency: LessonScene = {
  hook: "Why does a website get slow before it breaks?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Rising traffic",
      title: "See it slow down",
      caption: "Traffic rises to about 40 a second and falls back. Nothing is broken.",
      metrics: [M.p95(), f1Busy, M.throughput()],
      parts: [
        { node: "u", text: "Users: 20 requests a second, rising to 44." },
        { node: "app", text: "Server: works on 4 at once, 120 ms each.", sockets: true },
      ],
      beats: [
        { id: "watch", when: { at: 30 }, text: "Watch one blue dot leave Users and reach Server.", focus: { link: ["u", "app"] } },
        {
          id: "worker",
          when: { metric: f1Busy, is: ">", value: 0.05 },
          text: "Each socket in Server is a [[worker]]. A dot fills one for 120 ms.",
          focus: { nodes: ["app"], sockets: true },
          pause: true,
          term: "worker",
        },
        {
          id: "queue",
          when: { metric: f1Queue, is: ">", value: 0 },
          text: "A dot waits in front of Server: every worker is busy. That's the [[queue]].",
          focus: { nodes: ["app"], dots: "waiting" },
          pause: true,
          term: "queue",
        },
        {
          id: "count",
          when: { metric: f1Queue, is: ">", value: 9 },
          text: "Count the line in front of Server: {queue:app} waiting.",
          focus: { nodes: ["app"], dots: "waiting" },
        },
        {
          id: "late",
          when: { metric: M.p95(), is: ">", value: 400 },
          text: "An amber dot waited past 400 ms, the [[latency-target|target]]. It's late, not lost.",
          focus: { dots: "late" },
          term: "latency-target",
        },
      ],
      predict: {
        prompt: "Traffic is about to double, from 20 to 40 a second. The line in front of Server will…",
        options: ["Double", "More than double", "Stay about the same"],
        answer: 1,
        before: "count",
        reveal: { beat: "count", text: "The line went from {before} to {after}. Traffic only doubled." },
        track: { metric: f1Queue },
        holds: (before, after) => after !== null && after > 2 * Math.max(2, before ?? 0),
      },
      build: () =>
        scene([users("u", [14, 50], f1Traffic, "app"), server("app", [86, 50], { slots: 4, serviceMs: 120, label: "Server" })], {
          seed: 24,
          stillMs: 3800,
        }),
    },
    {
      tone: "explore",
      short: "More workers",
      title: "Find the limit",
      caption: "Same server. You set the traffic and the number of workers.",
      knobs: [
        knob("rate", "Traffic", 5, 60, 1, 26, perSecond),
        knob("slots", "Workers", 1, 8, 1, 4),
      ],
      metrics: [M.p95(), f1Busy, M.throughput()],
      beats: [
        {
          id: "capacity",
          when: { step: "enter" },
          text: "[[capacity|Capacity]] is workers ÷ time per request: 4 ÷ 0.12 s ≈ 33 a second.",
          focus: { nodes: ["app"], sockets: true },
          term: "capacity",
        },
        { id: "push", when: { wait: 0 }, text: "Drag Traffic to 30. Server busy reaches 90%. Watch the line form.", focus: { knob: "rate" } },
        { id: "more", when: { wait: 600 }, text: "Now give it 6 workers: capacity 50 a second. The line disappears.", focus: { knob: "slots" } },
      ],
      headline: {
        metric: "Response time",
        sentence: "In your scene: {load:app:2} arriving each second, Server {util:app:2} busy, and the slowest 1 in 20 waits {p95:2}.",
      },
      build: (v: Values) =>
        scene([users("u", [14, 50], { rate: v.rate, keys: 50 }, "app"), server("app", [86, 50], { slots: v.slots, serviceMs: 120, label: "Server" })], { seed: 24 }),
    },
  ],
  checks: [
    {
      prompt: "2 workers, 200 ms each. About how many requests a second can they finish?",
      options: ["4", "10", "100"],
      answer: 1,
      why: "2 ÷ 0.2 s = 10 a second. Capacity is workers divided by time per request.",
      focus: { nodes: ["app"], sockets: true },
    },
    {
      prompt: "A server is 90% busy. A new request most likely…",
      options: ["is served at once", "waits behind others", "is rejected"],
      answer: 1,
      why: "At 90% busy the line is already there most of the time; waiting, not failing, is what you see first.",
      focus: { nodes: ["app"], dots: "waiting" },
    },
  ],
  takeaways: {
    use: "Every design. Know each part's capacity and keep it well under 100% busy.",
    catch: "Waiting grows faster than load. At 90% busy a request waits several times longer than at 50%.",
    seen: "Every web server, database and API has a fixed number of workers or connections.",
    rule: "Queues grow faster than traffic.",
  },
};

export default latency;
