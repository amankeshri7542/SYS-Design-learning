import { M, armed, database, fault, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { ConnectSpec, SceneSpec } from "../../sim/types";

// D5: two app servers call a database that accepts at most 20 connections. Opening one costs two round trips (connect,
// then sign in). A connection per request pays that every time, and a spike in traffic opens more than 20 at once, so
// the database refuses the rest. A pool keeps a few open on each server; requests borrow one and wait briefly for a free
// one, and the database never sees more than the pools hold. A pool too small makes requests wait for it instead.

const SPIKE = "Traffic spikes";
const CALM = "Traffic calms down";
const spike = fault("spike", "Make traffic spike", "Calm it down", SPIKE, CALM, (s) => {
  const rate = s.nodes.get("u")?.spec.client?.rate;
  return typeof rate === "number" && rate > 150;
});
const APPS = ["a1", "a2"];

/** `connect`: how each app server reaches the database. `limit`: connections the database accepts. */
const shop = (connect: ConnectSpec, limit: number, spiking = false): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: spiking ? 320 : 140, keys: 200, tag: "user" }, ["a1", "a2"], { label: "Users" }),
      ...APPS.map((id, i) => server(id, [42, 26 + 48 * i], { label: `App ${i + 1}`, slots: 24, serviceMs: 4, blocking: true, to: ["db"], connect, callTimeoutMs: 1200 })),
      database("db", [84, 50], { label: "Database", slots: 8, serviceMs: 20, maxConns: limit }),
    ],
    {
      links: { "a1>db": 10, "a2>db": 10 },
      windowMs: 1500,
      seed: 43,
      script: armed({ node: "u", at: 2000, lastsMs: 2500, start: SPIKE, end: CALM }, { start: (s) => s.reconfigure(shop(connect, limit, true)), end: (s) => s.reconfigure(shop(connect, limit)) }),
    },
  );

const EACH: ConnectSpec = { handshakeRtts: 2, keepAliveMs: 0, max: 1000 };
const pool = (size: number): ConnectSpec => ({ handshakeRtts: 2, keepAliveMs: 1e9, max: size, waitMs: 600 });

const refused = M.errors({ label: "Failed", hint: "Share of requests that failed: refused by the database, or tired of waiting for a connection." });
const opened: MetricSpec = { id: "handshakes", label: "New connections", hint: "Database connections opened each second, each costing two round trips first." };
const held: MetricSpec = { id: "connections", label: "Database connections", nodes: ["db"], hint: "Connections the database holds open right now (it accepts at most its limit)." };
const metrics = [M.p95(), refused, opened, held];

const pools: LessonScene = {
  hook: "Why does the database say “too many connections” when it isn't even busy?",
  dots: ["req", "late", "ok", "failed", "hand"],
  figures: [
    {
      tone: "problem",
      short: "One each",
      title: "A new connection per request",
      caption: "Two app servers call a database that accepts at most 20 connections. Each request opens its own, then closes it.",
      actions: [spike],
      metrics,
      parts: [
        { node: "u", text: "Users: 140 requests a second." },
        { node: APPS, text: "App servers: one database call per request." },
        { node: "db", text: "Database: 8 workers, at most 20 connections.", sockets: true },
      ],
      beats: [
        { id: "shake", when: { metric: opened, is: ">", value: 0 }, text: "Watch grey rings before every call: each opens a connection, and signs in.", focus: { link: ["a1", "db"] } },
        { id: "rate", when: { wait: 0 }, text: "Count New connections: {handshakes}, two round trips each, thrown away after.", focus: { metric: "New connections" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Make traffic spike.", focus: { action: "spike" }, pause: true },
        { id: "refused", when: { metric: refused, is: ">", value: 0.05 }, text: "Past 20 open, the database refuses the rest: {errors} of requests fail.", focus: { nodes: ["db"] } },
      ],
      predict: {
        prompt: "Traffic is about to double. With a connection per request, the database will…",
        options: ["Take them all, a little slower", "Refuse some: it hits its connection limit"],
        answer: 1,
        before: "press",
        reveal: { beat: "refused", text: "Failed: {before} before the spike, {after} during it." },
        track: { metric: refused },
        holds: (_, after) => after !== null && after > 0.05,
      },
      break: { action: "spike", beat: "press" },
      build: () => shop(EACH, 20),
    },
    {
      tone: "fix",
      short: "A pool",
      title: "Borrow an open connection",
      caption: "The same servers and database. Each server keeps up to 8 connections open, and a request borrows a free one.",
      actions: [spike],
      knobs: [knob("size", "Pool size", 1, 16, 1, 8, (v) => `${v} per server`), knob("limit", "Database limit", 8, 40, 4, 20)],
      metrics,
      beats: [
        {
          id: "pool",
          when: { step: "enter" },
          text: "Now each server keeps up to 8 connections open: a [[connection-pool|connection pool]].",
          focus: { nodes: APPS },
          term: "connection-pool",
        },
        { id: "press-pool", when: { wait: 0 }, text: "Press ⚡ Make traffic spike.", focus: { action: "spike" }, pause: true },
        { id: "wait", when: { note: SPIKE }, text: "Requests wait a moment for a free connection, and the database never sees more than 16.", focus: { nodes: ["db"] } },
        { id: "small", when: { wait: 800 }, text: "Drag Pool size to 2: now the pool is the line everyone waits in.", focus: { knob: "size" } },
      ],
      break: { action: "spike", beat: "press-pool" },
      headline: { metric: "Failed", sentence: "Traffic doubling for a moment: {errors:problem} of requests failed with a connection each, {errors:fix} with a pool." },
      build: (v: Values) => shop(pool(v.size), v.limit),
    },
  ],
  checks: [
    {
      prompt: "Why did the database refuse requests when its workers weren't all busy?",
      options: ["It ran out of connections, not workers", "It crashed"],
      answer: 0,
      why: "Each connection holds memory and a process on the database, so it caps them. Requests holding one each hit that cap first.",
      focus: { nodes: ["db"] },
    },
    {
      prompt: "Pools of 16 on each of two servers, and a database limit of 20. What happens under load?",
      options: ["The pools try to open 32 and some are refused", "Nothing: pools never exceed limits"],
      answer: 0,
      why: "Every server's pool counts against the one limit. Size pools so their total stays under it.",
      focus: { knob: "size" },
    },
  ],
  takeaways: {
    use: "Every service that talks to a database: keep a pool per process, sized so all of them together fit the database's limit.",
    catch: "Too small and the pool is the queue; too big, times every server, and the database refuses or slows down.",
    seen: "HikariCP, PgBouncer, RDS Proxy, the pool in every database driver, and serverless's connection-limit trouble.",
    rule: "Borrow connections; don't open them per request.",
    interview: "Say: “Pool connections per instance, cap the pool so instances × size stays under max_connections, and add a proxy if needed.”",
  },
};

export default pools;
