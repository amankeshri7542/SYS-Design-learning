import type { Sim } from "../../sim/engine";
import type { Call, NodeSpec, SceneSpec } from "../../sim/types";
import { M, balancer, cache, database, lane, range, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

/** The target: the slowest 1 in 20 of users' requests within 300 ms, and at most 2% failing. */
const P95 = 300;
const PRICE = { base: 100, server: 40, cache: 25, replica: 60, limiter: 10 };
const START: Values = { servers: 1, cache: 0, replicas: 0, limiter: 0 };

function shortener(a: Values, s: StoryStage): SceneSpec {
  const { users: rate, hot, bot, crash } = s.params;
  const servers = range(a.servers).map((i) => `s${i + 1}`);
  const replicas = range(a.replicas).map((i) => `r${i + 1}`);
  const readOrigin: Call = replicas.length ? replicas : "db";
  const entry = a.limiter ? "lim" : "lb";
  const nodes: NodeSpec[] = [
    users("u", [4, bot ? 28 : 50], { rate, keys: 200, skew: 1.1, hot, writes: 0.05, tag: "user" }, entry, { label: "Users" }),
  ];
  if (bot) nodes.push(users("bot", [4, 78], { rate: bot, keys: 200, tag: "bot" }, entry, { label: "Bot", glyph: "bot" }));
  if (a.limiter)
    nodes.push({ id: "lim", kind: "limiter", label: "Rate limiter", at: [19, 50], limit: { rps: 20, burst: 10, tags: ["bot"] }, to: ["lb"] });
  nodes.push(balancer("lb", [33, 50], servers, { health: { everyMs: 120, failAfter: 2, passAfter: 2, timeoutMs: 150 } }));
  nodes.push(
    ...servers.map((id, i) =>
      server(id, [53, lane(a.servers, i)], {
        slots: 3,
        serviceMs: 40,
        queueMax: 60,
        label: `Server ${i + 1}`,
        calls: { read: [a.cache ? "cache" : readOrigin], write: ["db"] },
      }),
    ),
  );
  if (a.cache) nodes.push(cache("cache", [73, 50], readOrigin, { capacity: 100, ttlMs: 20000 }));
  nodes.push(database("db", [94, replicas.length ? 14 : 50], { slots: 4, serviceMs: 90, queueMax: 60, label: "Primary DB" }));
  nodes.push(
    ...replicas.map((id, i) =>
      database(id, [94, a.replicas === 1 ? 66 : 50 + 36 * i], {
        slots: 4,
        serviceMs: 90,
        queueMax: 60,
        replicaOf: "db",
        lagMs: 120,
        label: `Replica ${i + 1}`,
      }),
    ),
  );
  return scene(nodes, {
    sloMs: P95,
    msPerUnit: 0.45,
    wideH: 440,
    script: crash
      ? {
          loopMs: 3200,
          events: [
            { at: 300, label: "Server 1 crashed", run: (sim: Sim) => sim.setUp("s1", false) },
            { at: 2000, label: "Server 1 is back", run: (sim: Sim) => sim.setUp("s1", true) },
          ],
        }
      : undefined,
  });
}

/** Keep a URL shortener alive: four stages of growth on one screen. */
const capstone: StoryDef = {
  controls: [
    { kind: "count", id: "servers", label: "App servers", min: 1, max: 4 },
    { kind: "switch", id: "cache", label: "Cache" },
    { kind: "count", id: "replicas", label: "Read replicas", min: 0, max: 2 },
    { kind: "switch", id: "limiter", label: "Rate limiter" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.servers * PRICE.server + a.cache * PRICE.cache + a.replicas * PRICE.replica + a.limiter * PRICE.limiter,
  scene: shortener,
  targets: [
    { metric: M.p95({ tag: "user", label: "Users' response time" }), label: "Response time", max: P95 },
    { metric: M.errors({ tag: "user", label: "Users failed" }), label: "Failed", max: 0.02 },
  ],
  metrics: [M.busy(["s1", "s2", "s3", "s4"], "Servers busy"), M.busy(["db", "r1", "r2"], "Databases busy")],
  win: (cost) => `You kept it alive through all four stages for $${cost} a month. Can you find a cheaper design that still holds stage 4?`,
  lead: (s) => `${s.params.users + s.params.bot} a second`,
  stages: [
    {
      name: "Launch day",
      beats: [
        { id: "users", when: { step: "enter" }, text: "Users send about 12 a second: short links, read back again and again.", focus: { nodes: ["u"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Primary DB's meter: the box to keep under 100%.", focus: { nodes: ["db"] } },
      ],
      brief: "A few hundred people are shortening links. Check that one server and one database hold the target.",
      hint: "Nothing to change yet. Watch the target hold and get used to the scene.",
      params: { users: 12, hot: 0, bot: 0, crash: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "Featured on a blog",
      beats: [
        { id: "users", when: { step: "enter" }, text: "Traffic triples to 40 a second, mostly the same popular links.", focus: { nodes: ["u"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Primary DB: it fills first. Repeated reads needn't reach it.", focus: { nodes: ["db"] } },
      ],
      brief: "Traffic triples overnight. Nearly every request is a redirect: a read of the same popular links, again and again.",
      hint: "The database is the box at 100%. What lets repeated reads skip it entirely?",
      params: { users: 40, hot: 0, bot: 0, crash: 0 },
      hold: 8,
      solution: { ...START, cache: 1 },
    },
    {
      name: "A link goes viral",
      beats: [
        { id: "users", when: { step: "enter" }, text: "One link is now more than a third of all traffic.", focus: { nodes: ["u"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Server 1's sockets: one server only has so many workers.", focus: { nodes: ["s1"], sockets: true } },
      ],
      brief: "One link is everywhere, more than a third of all traffic, and total traffic doubles again.",
      hint: "Watch which box fills first. However good the cache is, one server only has so many workers.",
      params: { users: 85, hot: 0.35, bot: 0, crash: 0 },
      hold: 8,
      solution: { ...START, cache: 1, servers: 2 },
    },
    {
      name: "Under attack",
      beats: [
        { id: "users", when: { step: "enter" }, text: "A bot sends 90 a second, every one aimed at your servers.", focus: { nodes: ["bot"] } },
        { id: "watch", when: { wait: 0 }, text: "Watch Server 1: it will crash, again and again.", focus: { nodes: ["s1"] } },
      ],
      brief: "A bot hammers the API at 90 requests a second, and server 1 keeps crashing. Real users must not notice.",
      hint: "Shed the bot's traffic before it reaches the servers, and make sure losing one server still leaves enough.",
      params: { users: 85, hot: 0.2, bot: 90, crash: 1 },
      hold: 12,
      solution: { ...START, cache: 1, servers: 3, limiter: 1 },
    },
  ],
};

export default capstone;
