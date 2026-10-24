import { M, armedCrash, choice, fault, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// N4: one browser, one server 40 ms away (an 80 ms round trip). Opening a connection costs a round trip for TCP and one
// or two more for TLS before the request can go, so a new connection per request makes every answer about four round
// trips. Kept open, each connection pays that once. Restarting the server closes every connection at once.

const RESTART = "The server restarts";
const BACK = "The server is back";
const restart = fault("restart", "Restart the server", "Wait for it to come back", RESTART, BACK, (s) => s.nodes.get("app")?.up === false);
const TLS = ["None", "TLS 1.3", "TLS 1.2"];
const encryption = choice("tls", "Encryption", TLS, 2);

/** `tls`: extra round trips for encryption (0–2). `keepAliveMs`: how long an idle connection stays open (0: closed after each answer). */
const n4 = (tls: number, keepAliveMs: number) =>
  scene(
    [
      users("u", [14, 50], { rate: 5, keys: 50 }, "app", { label: "Browser", connect: { handshakeRtts: 1 + tls, keepAliveMs, max: 6 } }),
      server("app", [86, 50], { slots: 8, serviceMs: 10, label: "Server" }),
    ],
    {
      sloMs: 250,
      links: { "u>app": { ms: 40, label: "40 ms each way" } },
      windowMs: 3000,
      seed: 9,
      // A restart takes 0.4 s: long enough to drop every connection, too short to fail more than a request or two.
      script: armedCrash("app", 2000, 400, RESTART, BACK),
    },
  );

const handshakes: MetricSpec = { id: "handshakes", label: "New connections", hint: "Connections opened each second: each one is a handshake before the first request." };
const metrics = [M.p50(), handshakes, M.wire()];

const handshakesAndKeepAlive: LessonScene = {
  hook: "Why is the first click on a site slower than the next one?",
  dots: ["req", "ok", "hand"],
  figures: [
    {
      tone: "problem",
      short: "Reconnecting",
      title: "A new connection every time",
      caption: "A browser asks a server 40 ms away for something five times a second, opening a new connection for each request.",
      knobs: [encryption],
      metrics,
      parts: [
        { node: "u", text: "Browser: five requests a second." },
        { node: "app", text: "Server: 40 ms away, answers in 10 ms." },
      ],
      beats: [
        {
          id: "rings",
          when: { metric: handshakes, is: ">", value: 0 },
          text: "Watch grey rings go out and back before each request: the [[handshake]].",
          focus: { link: ["u", "app"] },
          pause: true,
          term: "handshake",
        },
        {
          id: "three",
          when: { wait: 0 },
          text: "Count three round trips: one to connect, two more to agree on [[tls|encryption]].",
          focus: { link: ["u", "app"] },
          term: "tls",
        },
        { id: "slow", when: { metric: M.p50(), is: ">", value: 0 }, text: "Read Typical response: {p50}, four round trips for every answer.", focus: { metric: "Typical response" } },
      ],
      predict: {
        prompt: "Next, the browser keeps each connection open for the next request. A typical request will take…",
        options: ["About one round trip", "Still about four"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Typical response: {before} with a new connection each time, {after} kept open." },
        track: { metric: M.p50(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before / 2,
      },
      build: (v: Values) => n4(v.tls, 0),
    },
    {
      tone: "fix",
      short: "Kept open",
      title: "Keep the connection open",
      caption: "The same browser and server. Each connection stays open after its answer, and the next request goes on it at once.",
      knobs: [encryption],
      actions: [restart],
      metrics,
      beats: [
        {
          id: "kept",
          when: { step: "enter" },
          text: "Now each connection stays open after its answer: [[keep-alive|keep-alive]].",
          focus: { nodes: ["u"] },
          term: "keep-alive",
        },
        {
          id: "compare",
          when: { metric: M.p50(), is: "<", value: 150 },
          text: "Compare Typical response: {p50:fix} kept open, {p50:problem} connecting each time.",
          focus: { metric: "Typical response" },
        },
        { id: "tls", when: { wait: 0 }, text: "Switch Encryption to TLS 1.3: it speeds up only new connections, now rare.", focus: { knob: "tls" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Restart the server.", focus: { action: "restart" }, pause: true },
        { id: "again", when: { note: RESTART }, text: "A restart closes every open connection: the next requests shake hands again.", focus: { link: ["u", "app"] } },
      ],
      break: { action: "restart", beat: "press" },
      headline: { metric: "Typical response", sentence: "Server 40 ms away: {p50:problem} with a new connection each time, {p50:fix} kept open." },
      build: (v: Values) => n4(v.tls, 60_000),
    },
  ],
  checks: [
    {
      prompt: "Why is a request on a kept-open connection faster?",
      options: ["It skips the handshake", "The server remembers the answer"],
      answer: 0,
      why: "The connection is already set up, so the request goes at once: one round trip instead of four.",
      focus: { link: ["u", "app"] },
    },
    {
      prompt: "Voice calls and games often use UDP instead of TCP. Why?",
      options: ["It sends at once, with no handshake or resends", "It never loses anything"],
      answer: 0,
      why: "UDP skips the handshake and never waits for a lost packet: late audio is worse than a tiny gap.",
    },
  ],
  takeaways: {
    use: "Every client of a busy server: keep connections open and reuse them, in browsers, SDKs and between services.",
    catch: "Open connections hold memory on the server, and a restart drops them all at once.",
    seen: "HTTP keep-alive, TLS 1.3 and its 0-RTT resumption, QUIC, browser connection reuse.",
    rule: "Connect once, reuse often.",
    interview: "Say: “Reuse connections: a new one costs a TCP round trip plus TLS before the first byte.”",
  },
};

export default handshakesAndKeepAlive;
