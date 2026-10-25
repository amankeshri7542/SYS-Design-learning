import type { Sim } from "../../sim/engine";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";
import { balancer, lane, range, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S3: chat messages (4 a second) go through a topic to every chat server, and users hear of them either by asking a
// server four times a second (polling) or through a connection each server holds open (push), up to 60 per server.
// The target: every message reaches a user within 0.4 s, and almost no user misses any. Stages grow the users until
// polling swamps one server, until held connections pass what two servers can hold, and then freeze a server.

const PRICE = { base: 80, server: 60, push: 10, beats: 5 };
const START: Values = { servers: 1, push: 0, beats: 0 };
const HOLD = 60;

function chat(a: Values, s: StoryStage): SceneSpec {
  const ids = range(a.servers).map((i) => `p${i + 1}`);
  const heartbeat = a.beats ? { everyMs: 200, missAfter: 2, timeoutMs: 200 } : undefined;
  const nodes: NodeSpec[] = [
    users("u", [6, 40], a.push ? { rate: 0, keys: s.params.users, subscribe: { holdMs: 1e9, reconnectMs: 600, heartbeat } } : { rate: 0, keys: s.params.users, poll: 250 }, "lb", { label: "Users" }),
    balancer("lb", [28, 40], ids, { label: "Balancer", layer: 4, health: { everyMs: 100, failAfter: 2, passAfter: 2, timeoutMs: 150 } }),
    ...ids.map((id, i) => server(id, [58, lane(a.servers, i)], { label: `Server ${i + 1}`, slots: 4, serviceMs: 10, hold: { max: HOLD }, feed: true, downMode: "hang" })),
    { id: "topic", kind: "topic", label: "Topic", at: [86, 50], to: ids },
    users("msgs", [86, 92], { rate: 4, keys: 50, news: true, writes: 1 }, "topic", { label: "Messages" }),
  ];
  return scene(nodes, {
    windowMs: 3000,
    wideH: 440,
    script: s.params.freeze
      ? {
          loopMs: 4000,
          events: [
            { at: 200, label: "Server 1 froze", run: (sim: Sim) => sim.setUp("p1", false) },
            { at: 3400, label: "Server 1 is back", run: (sim: Sim) => sim.setUp("p1", true) },
          ],
        }
      : undefined,
  });
}

const within: MetricSpec = { id: "pushLag", label: "Message within", hint: "95% of messages reach a user within this time of being sent." };
const missing: MetricSpec = { id: "missed", label: "Users missing messages", nodes: ["u"], hint: "Share of users who hadn't had a message a second after it was sent." };

/** Deliver every message: four stages, from a small chat to a busy one with a server that freezes. */
const chatStory: StoryDef = {
  controls: [
    { kind: "count", id: "servers", label: "Chat servers", min: 1, max: 4 },
    { kind: "switch", id: "push", label: "Hold connections open" },
    { kind: "switch", id: "beats", label: "Heartbeats" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.servers * PRICE.server + a.push * PRICE.push + a.beats * PRICE.beats,
  scene: chat,
  targets: [
    { metric: within, label: "Message within", max: 400 },
    { metric: missing, label: "Users missing messages", max: 0.02 },
  ],
  metrics: [
    { id: "util", label: "Servers busy", nodes: ["p1", "p2", "p3", "p4"], hint: "Share of the chat servers' workers busy right now." },
    { id: "connections", label: "Connections held", nodes: ["p1", "p2", "p3", "p4"], hint: "Users' connections the chat servers hold open." },
  ],
  win: (cost) => `Your chat delivered every message through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: (s) => `${s.params.users} users`,
  stages: [
    {
      name: "A small chat",
      beats: [
        { id: "ask", when: { step: "enter" }, text: "Twenty users ask a chat server for new messages four times a second.", focus: { nodes: ["u"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Message within: every message must reach users within 0.4 s.", focus: { nodes: ["p1"] } },
      ],
      brief: "Twenty users, polling four times a second. Check that one chat server keeps up.",
      hint: "Nothing to change yet. Watch messages arrive within a poll.",
      params: { users: 20, freeze: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "Evening rush",
      beats: [
        { id: "ask", when: { step: "enter" }, text: "Now 120 users poll four times a second: almost 500 asks a second.", focus: { nodes: ["u"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Server 1: its line grows, and every message waits in it.", focus: { nodes: ["p1"], sockets: true } },
      ],
      brief: "The evening rush: 120 users. Most polls come back empty, and each one costs a worker.",
      hint: "Polls cost a worker whether or not there's news. What if the server only worked when there was?",
      params: { users: 120, freeze: 0 },
      hold: 8,
      solution: { ...START, servers: 2, push: 1 },
    },
    {
      name: "Too many to hold",
      beats: [
        { id: "ask", when: { step: "enter" }, text: "Now 180 users, and each chat server holds at most 60 connections.", focus: { nodes: ["u"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Users missing messages: those turned away hear nothing.", focus: { nodes: ["lb"] } },
      ],
      brief: "More users than your chat servers can hold connections for. The rest are turned away and miss messages.",
      hint: "Each server holds 60 connections. How many servers do 180 users need?",
      params: { users: 180, freeze: 0 },
      hold: 8,
      solution: { ...START, servers: 3, push: 1 },
    },
    {
      name: "A server freezes",
      beats: [
        { id: "ask", when: { step: "enter" }, text: "Server 1 now freezes every few seconds, its connections open and silent.", focus: { nodes: ["p1"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Users missing messages: its users wait for news that never comes.", focus: { nodes: ["p1"] } },
      ],
      brief: "A chat server keeps freezing without closing anything. Its users must notice, and move.",
      hint: "Users need a way to tell silence from a dead server, and room elsewhere to move to.",
      params: { users: 180, freeze: 1 },
      hold: 10,
      solution: { ...START, servers: 4, push: 1, beats: 1 },
    },
  ],
};

export default chatStory;
