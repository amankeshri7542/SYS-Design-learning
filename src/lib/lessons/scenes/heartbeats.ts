import { armed, balancer, fault, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// N12: forty users each keep a connection open to one of two push servers, behind a balancer that checks their health.
// A news desk publishes four items a second through a topic to both. Push server 1 freezes: it neither answers nor
// closes, so its users' connections look exactly like quiet ones and they hear nothing more. With heartbeats each user
// pings its server; after enough misses it gives up and reconnects, and the balancer sends it to server 2. Pings that
// expect an answer faster than a round trip drop healthy connections.

const FREEZE = "Push server 1 freezes";
const THAW = "Push server 1 is back";
const freeze = fault("freeze", "Freeze push server 1", "Unfreeze it", FREEZE, THAW, (s) => s.nodes.get("a")?.up === false);

/** `everyMs`: how often each user pings (0: never); a ping unanswered by the next is a miss; `misses` in a row end the connection. */
const pushes = (everyMs: number, misses: number): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 0, keys: 40, subscribe: { holdMs: 1e9, reconnectMs: 300, heartbeat: everyMs ? { everyMs, missAfter: misses, timeoutMs: everyMs } : undefined } }, "lb", { label: "Users" }),
      balancer("lb", [34, 50], ["a", "b"], { health: { everyMs: 100, failAfter: 2, passAfter: 2, timeoutMs: 150 } }),
      server("a", [64, 22], { label: "Push server 1", slots: 4, serviceMs: 2, hold: { max: 100 }, downMode: "hang" }),
      server("b", [64, 78], { label: "Push server 2", slots: 4, serviceMs: 2, hold: { max: 100 }, downMode: "hang" }),
      { id: "topic", kind: "topic", label: "Topic", at: [92, 50], to: ["a", "b"] },
      users("news", [92, 92], { rate: 4, keys: 50, news: true, writes: 1 }, "topic", { label: "News desk" }),
    ],
    {
      windowMs: 3000,
      seed: 39,
      script: armed({ node: "a", at: 1800, lastsMs: 5000, start: FREEZE, end: THAW }, { start: (s) => s.setUp("a", false), end: (s) => s.setUp("a", true) }),
    },
  );

const reached: MetricSpec = { id: "reach", label: "News reached", nodes: ["u"], hint: "Share of users who had each news item a second after it was published." };
const noticed: MetricSpec = { id: "detectMs", label: "Noticed within", hint: "How long a user took to notice its server had gone silent (the slowest 1 in 20)." };
const alarms: MetricSpec = { id: "falseAlarms", label: "False alarms", hint: "Healthy connections dropped as dead in the window, because a ping was answered too late." };
const metrics = [reached, noticed, alarms];

const heartbeats: LessonScene = {
  hook: "How do you tell a server that died from one with nothing to say?",
  dots: ["req", "ok", "push", "hand"],
  figures: [
    {
      tone: "problem",
      short: "Silent",
      title: "Open, quiet, and maybe dead",
      caption: "Forty users keep a connection open to one of two push servers. A news desk sends four items a second to both.",
      actions: [freeze],
      metrics,
      parts: [
        { node: "u", text: "Users: 40, each with one connection held open." },
        { node: "lb", text: "Load balancer: new connections to a healthy server." },
        { node: ["a", "b"], text: "Push servers: hold connections, push each item." },
        { node: ["news", "topic"], text: "News desk: 4 items a second, to both." },
      ],
      beats: [
        { id: "fan", when: { metric: reached, is: ">", value: 0.9 }, text: "Watch each item fan out: a small push down every open connection.", focus: { nodes: ["a", "b"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Freeze push server 1.", focus: { action: "freeze" }, pause: true },
        { id: "frozen", when: { note: FREEZE }, text: "Server 1 hangs, but its connections stay open, and silent.", focus: { nodes: ["a"] } },
        { id: "lost", when: { metric: reached, is: "<", value: 0.8 }, text: "Read News reached: {reach}. Half the users wait for news that never comes.", focus: { metric: "News reached" } },
      ],
      predict: {
        prompt: "Push server 1 is about to freeze, without closing anything. Its users will…",
        options: ["Notice, and reconnect elsewhere", "Wait, hearing nothing"],
        answer: 1,
        before: "press",
        reveal: { beat: "lost", text: "News reached: {before} before, {after} after server 1 froze." },
        track: { metric: reached },
        holds: (_, after) => after !== null && after < 0.8,
      },
      break: { action: "freeze", beat: "press" },
      build: () => pushes(0, 2),
    },
    {
      tone: "fix",
      short: "Heartbeats",
      title: "Ping, and give up on silence",
      caption: "The same users and servers. Each user pings its server, and after two pings go unanswered it reconnects.",
      actions: [freeze],
      knobs: [knob("every", "Ping every", 50, 1000, 50, 200, ms), knob("misses", "Misses allowed", 1, 5, 1, 2)],
      metrics,
      beats: [
        {
          id: "beat",
          when: { step: "enter" },
          text: "Now each user pings its server every 200 ms: a [[heartbeat]].",
          focus: { link: ["u", "lb"] },
          term: "heartbeat",
        },
        { id: "press-beat", when: { wait: 0 }, text: "Press ⚡ Freeze push server 1.", focus: { action: "freeze" }, pause: true },
        { id: "noticed", when: { metric: noticed, is: ">", value: 0 }, text: "Two pings unanswered, and its users reconnect to server 2: noticed within {detectMs}.", focus: { nodes: ["b"] } },
        { id: "compare", when: { wait: 600 }, text: "Compare News reached: {reach:fix} with heartbeats, {reach:problem} without.", focus: { metric: "News reached" } },
        { id: "eager", when: { wait: 600 }, text: "Drag Ping every to 50 ms: answers come too late, and healthy connections drop.", focus: { knob: "every" } },
      ],
      break: { action: "freeze", beat: "press-beat" },
      headline: { metric: "News reached", sentence: "Server 1 frozen: news reached {reach:problem} of users without heartbeats, {reach:fix} with them." },
      build: (v: Values) => pushes(v.every, v.misses),
    },
  ],
  checks: [
    {
      prompt: "Without heartbeats, why can't users tell the frozen server from a quiet one?",
      options: ["Both send nothing at all", "A frozen server sends errors"],
      answer: 0,
      why: "A hung server neither answers nor closes the connection. Silence is all the user ever sees.",
      focus: { nodes: ["a"] },
    },
    {
      prompt: "What goes wrong with very frequent pings and very short timeouts?",
      options: ["Healthy connections are dropped as dead", "Nothing: faster is always better"],
      answer: 0,
      why: "A ping answered a little late looks like a miss. Allow a few misses, and a timeout longer than a round trip.",
      focus: { knob: "every" },
    },
  ],
  takeaways: {
    use: "Every long-lived connection: WebSockets, database pools, cluster members. Ping on a timer, and give up after a few misses.",
    catch: "Too eager and you drop healthy connections and cause reconnect storms; too lazy and users sit on dead ones.",
    seen: "WebSocket ping and pong, TCP keepalive, gRPC keepalive, the heartbeats in Raft, Kafka and ZooKeeper.",
    rule: "Silence must have a timeout.",
    interview: "Say: “Heartbeat long-lived connections: interval, timeout and allowed misses tune detection against false alarms.”",
  },
};

export default heartbeats;
