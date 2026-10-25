import { choice, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { ConnectSpec } from "../../sim/types";

// N10: a browser loads pages of 24 files from a server 30 ms away, over a line that loses some packets; a connection
// resends what is lost after 200 ms. HTTP/1.1 gets six connections, one file at a time each, so a page takes four
// rounds. HTTP/2 sends all 24 at once on one connection, but TCP delivers in order, so one loss holds up every file behind
// it. HTTP/3 (QUIC) keeps each file on its own stream: a loss holds up only that file.

const LOSS = [0, 0.01, 0.03, 0.05];
const lossKnob = choice("loss", "Lost packets", ["None", "1%", "3%", "5%"], 2);

const page = (connect: ConnectSpec, loss: number) =>
  scene(
    [
      users("u", [14, 50], { rate: 2, keys: 50, page: 24, timeoutMs: 5000 }, "app", { label: "Browser", connect }),
      server("app", [86, 50], { label: "Server", slots: 32, serviceMs: 5 }),
    ],
    {
      timeoutMs: 5000,
      links: { "u>app": { ms: 30, loss, perCostMs: 6, label: "30 ms each way" } },
      windowMs: 3000,
      seed: 33,
    },
  );

const HTTP1: ConnectSpec = { handshakeRtts: 1, keepAliveMs: 1e9, max: 6, streams: "one", rtoMs: 200 };
const HTTP2: ConnectSpec = { handshakeRtts: 1, keepAliveMs: 1e9, max: 1, streams: "multiplex", rtoMs: 200 };
const HTTP3: ConnectSpec = { handshakeRtts: 1, keepAliveMs: 1e9, max: 1, streams: "independent", rtoMs: 200 };

const loaded: MetricSpec = { id: "pageMs", label: "Page loaded within", hint: "95% of pages had all 24 files within this time." };
const asset: MetricSpec = { id: "p50", label: "Typical file", hint: "Half of the files arrive faster than this." };
const lane: MetricSpec = { id: "sendWait", label: "Waiting for a lane", hint: "95% of files waited at most this long in the browser for a free connection." };
const metrics = [loaded, asset, lane];

const headOfLine: LessonScene = {
  hook: "Why does one lost packet hold up the whole page?",
  dots: ["req", "ok", "lost"],
  figures: [
    {
      tone: "problem",
      short: "HTTP/1.1",
      title: "Six lanes, one file each",
      caption: "A browser loads pages of 24 files over six connections, one file each at a time. The line loses 3% of packets.",
      knobs: [lossKnob],
      metrics,
      parts: [
        { node: "u", text: "Browser: a page of 24 files, twice a second." },
        { node: "app", text: "Server: 30 ms away, 5 ms a file." },
      ],
      beats: [
        {
          id: "six",
          when: { metric: { id: "connections", label: "Open", nodes: ["u"] }, is: ">", value: 0 },
          text: "Watch six files go out; the other 18 wait above Browser for a lane.",
          focus: { nodes: ["u"], dots: "waiting" },
          pause: true,
        },
        {
          id: "blocked",
          when: { fx: "lost", node: "u" },
          text: "A lost file holds up its whole lane until it's resent: [[head-of-line-blocking|head-of-line blocking]].",
          focus: { link: ["u", "app"] },
          term: "head-of-line-blocking",
        },
        { id: "slow", when: { metric: loaded, is: ">", value: 0 }, text: "Read Page loaded within: {pageMs}, four rounds of six files each.", focus: { metric: "Page loaded within" } },
      ],
      predict: {
        prompt: "Next, one connection carries all 24 files at once. Pages will load…",
        options: ["Much faster", "About the same"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Page loaded within: {before} on six lanes, {after} on one shared connection." },
        track: { metric: loaded, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before * 0.9,
      },
      build: (v: Values) => page(HTTP1, LOSS[v.loss]),
    },
    {
      tone: "fix",
      short: "HTTP/2",
      title: "All 24 on one connection",
      caption: "The same pages and line. One connection carries all 24 files at once, their pieces interleaved.",
      knobs: [lossKnob],
      metrics,
      beats: [
        {
          id: "mux",
          when: { step: "enter" },
          text: "Now all 24 files share one connection at the same time: [[multiplexing]].",
          focus: { link: ["u", "app"] },
          term: "multiplexing",
        },
        { id: "compare", when: { metric: loaded, is: ">", value: 0 }, text: "Compare Page loaded within: {pageMs:2} on one connection, {pageMs:1} on six.", focus: { metric: "Page loaded within" } },
        { id: "stall", when: { fx: "lost", node: "u" }, text: "Watch a red cross: every file behind it waits for the resend too.", focus: { link: ["u", "app"] } },
        { id: "order", when: { wait: 0 }, text: "Read Typical file: {p50:2}. The connection hands over bytes only in order.", focus: { metric: "Typical file" } },
      ],
      headline: { metric: "Page loaded within", sentence: "Pages of 24 files: loaded within {pageMs:1} on six connections, {pageMs:2} on one." },
      build: (v: Values) => page(HTTP2, LOSS[v.loss]),
    },
    {
      tone: "fix",
      short: "HTTP/3",
      title: "Each file on its own stream",
      caption: "The same pages and line. One connection, but each file travels on its own, so a loss holds up only that file.",
      knobs: [lossKnob],
      metrics,
      beats: [
        {
          id: "quic",
          when: { step: "enter" },
          text: "Now each file is its own stream over [[quic|QUIC]]: a loss stalls just that file.",
          focus: { link: ["u", "app"] },
          term: "quic",
        },
        { id: "streams", when: { metric: asset, is: ">", value: 0 }, text: "Compare Typical file: {p50:3} here, {p50:2} on HTTP/2 at the same loss.", focus: { metric: "Typical file" } },
        { id: "worse", when: { wait: 600 }, text: "Drag Lost packets to 5%: only the unlucky files wait; the rest arrive on time.", focus: { knob: "loss" } },
      ],
      build: (v: Values) => page(HTTP3, LOSS[v.loss]),
    },
  ],
  checks: [
    {
      prompt: "Why did one connection beat six for a page of 24 files?",
      options: ["All 24 go at once instead of waiting for a lane", "One connection has more bandwidth"],
      answer: 0,
      why: "Six lanes meant four rounds of six. Sharing one connection, every file goes in the first round.",
      focus: { metric: "Page loaded within" },
    },
    {
      prompt: "HTTP/2 runs over TCP. Why does one lost packet hold up every file?",
      options: ["TCP hands over bytes in order, so everything waits for the gap", "The server sends every file again"],
      answer: 0,
      why: "The files arrive interleaved on one ordered stream. Until the gap is filled, nothing behind it is handed over.",
      focus: { link: ["u", "app"] },
    },
  ],
  takeaways: {
    use: "Pages and APIs with many small requests: use HTTP/2 or HTTP/3 rather than many HTTP/1.1 connections.",
    catch: "On a lossy line, such as mobile, HTTP/2's single TCP stream stalls everything at each loss; HTTP/3 needs UDP to get through.",
    seen: "Browsers' six connections per host, HTTP/2 multiplexing, HTTP/3 over QUIC, gRPC on HTTP/2.",
    rule: "One loss shouldn't stop every stream.",
    interview: "Say: “HTTP/2 fixes request queueing but keeps TCP's head-of-line blocking; QUIC streams are independent.”",
  },
};

export default headOfLine;
