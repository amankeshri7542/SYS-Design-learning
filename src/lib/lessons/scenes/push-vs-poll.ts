import { armedCrash, fault, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec } from "../../sim/types";

// N7: forty users want news that comes about once a second. Polling four times a second, most answers say nothing new,
// each costs the server a worker's time, and news waits for the next poll. Holding a connection open (a WebSocket), the
// server pushes each item the moment it arrives and answers nothing in between. When the push server restarts, every
// user reconnects at once unless each waits a random while first.

const CRASH = "The push server restarts";
const BACK = "The push server is back";
const crash = fault("crash-app", "Crash the push server", "Bring it back", CRASH, BACK, (s) => s.nodes.get("app")?.up === false);

const news = users("news", [10, 86], { rate: 1.2, keys: 50, news: true, writes: 1 }, "app", { label: "News desk" });
const opts = { timeScale: 0.15, windowMs: 4000, seed: 41 };

/** Users ask for news every `everyMs`. */
const polling = (everyMs: number) =>
  scene([users("u", [10, 40], { rate: 0, keys: 40, poll: everyMs }, "app", { label: "Users" }), news, server("app", [84, 50], { label: "Server", slots: 4, serviceMs: 15, feed: true })], opts);

/** Users keep a connection open; after a crash each reconnects after a random wait of up to `waitMs`. */
const pushing = (waitMs: number) => {
  const u: NodeSpec = users("u", [10, 40], { rate: 0, keys: 40, subscribe: { holdMs: 1e9, reconnectMs: waitMs } }, "app", { label: "Users" });
  return scene([u, news, server("app", [84, 50], { label: "Push server", slots: 4, serviceMs: 15, hold: { max: 200 } })], { ...opts, script: armedCrash("app", 3000, 400, CRASH, BACK) });
};

const delivered: MetricSpec = { id: "pushLag", label: "News delivered within", hint: "95% of news items reach a user within this time of being published." };
const busy: MetricSpec = { id: "util", label: "Server busy", nodes: ["app"], hint: "Share of the server's workers busy right now." };
const empty: MetricSpec = { id: "empty", label: "Nothing new", hint: "Share of polls answered with no news at all." };
const open: MetricSpec = { id: "connections", label: "Connections open", nodes: ["app"], hint: "Users' connections the server holds open right now." };
const metrics = [delivered, busy, empty, open];

const pushVsPoll: LessonScene = {
  hook: "How does a chat app show a message the instant it's sent?",
  dots: ["req", "ok", "push"],
  figures: [
    {
      tone: "problem",
      short: "Polling",
      title: "Keep asking",
      caption: "Forty users want news that comes about once a second. Each asks the server for it four times a second.",
      knobs: [knob("every", "Ask every", 250, 2000, 250, 250, ms)],
      metrics,
      parts: [
        { node: "u", text: "Users: 40, each asking four times a second." },
        { node: "news", text: "News desk: about one item a second." },
        { node: "app", text: "Server: answers each ask in 15 ms.", sockets: true },
      ],
      beats: [
        {
          id: "ask",
          when: { metric: empty, is: ">", value: 0 },
          text: "Watch Users ask again and again: “Anything new?” That's [[polling]].",
          focus: { link: ["u", "app"] },
          pause: true,
          term: "polling",
        },
        { id: "nothing", when: { metric: empty, is: ">", value: 0.5 }, text: "Read Nothing new: {empty} of answers carry nothing, but each takes a worker.", focus: { metric: "Nothing new" } },
        { id: "late", when: { metric: delivered, is: ">", value: 0 }, text: "News waits for each user's next ask: delivered within {pushLag}.", focus: { metric: "News delivered within" } },
      ],
      predict: {
        prompt: "Next, each user keeps one connection open, and the server sends news down it. News will arrive…",
        options: ["Within one trip across the wire", "About as late as now"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "News delivered within: {before} polling, {after} pushed." },
        track: { metric: delivered, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before / 2,
      },
      build: (v: Values) => polling(v.every),
    },
    {
      tone: "fix",
      short: "Push",
      title: "Keep a line open",
      caption: "The same users and news. Each user keeps one connection open, and the server sends each item down it as it arrives.",
      knobs: [knob("wait", "Reconnect wait", 0, 2000, 250, 0, ms)],
      actions: [crash],
      metrics,
      beats: [
        {
          id: "open",
          when: { step: "enter" },
          text: "Now each user holds a connection open, and news is pushed down it: a [[websocket|WebSocket]].",
          focus: { nodes: ["u"] },
          term: "websocket",
        },
        // A moment for both worlds to have delivered news, even for a learner who came straight here.
        { id: "compare", when: { wait: 900 }, text: "Compare News delivered within: {pushLag:fix} pushed, {pushLag:problem} polling.", focus: { metric: "News delivered within" } },
        { id: "quiet", when: { wait: 0 }, text: "Read Server busy: {util:app:fix}, down from {util:app:problem}. No empty answers.", focus: { metric: "Server busy" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash the push server.", focus: { action: "crash-app" }, pause: true },
        {
          id: "storm",
          when: { note: BACK },
          text: "Every connection dropped, and all 40 users reconnect at once: a [[reconnect-storm|reconnect storm]].",
          focus: { nodes: ["app"], sockets: true },
          term: "reconnect-storm",
        },
        { id: "spread", when: { wait: 800 }, text: "Drag Reconnect wait to 1 s: users come back spread out, not all at once.", focus: { knob: "wait" } },
      ],
      break: { action: "crash-app", beat: "press" },
      headline: { metric: "News delivered within", sentence: "News about once a second: delivered within {pushLag:problem} polling, {pushLag:fix} pushed." },
      build: (v: Values) => pushing(v.wait),
    },
  ],
  checks: [
    {
      prompt: "Why does polling waste the server's time?",
      options: ["Most answers carry nothing new", "Each poll is bigger than a push"],
      answer: 0,
      why: "The server answers every ask, news or not. Pushing, it works only when there is something to send.",
      focus: { metric: "Nothing new" },
    },
    {
      prompt: "A push server restarts. How do you stop every user reconnecting in the same instant?",
      options: ["Each waits a random while before reconnecting", "Each reconnects as fast as it can"],
      answer: 0,
      why: "A random wait (jitter) spreads the reconnects out, so the server isn't flattened as it comes back.",
      focus: { knob: "wait" },
    },
  ],
  takeaways: {
    use: "Chat, live scores, notifications and dashboards: hold a connection (WebSocket or server-sent events) and push. Poll only for rare checks.",
    catch: "Every open connection holds memory on a server, and when one dies all its users come back at once: add jitter.",
    seen: "WebSockets, server-sent events, long polling, Slack and WhatsApp clients, Apple and Firebase push.",
    rule: "Push news; don't make users ask.",
    interview: "Say: “Hold connections for real-time updates, fan out through a broker, and jitter reconnects.”",
  },
};

export default pushVsPoll;
