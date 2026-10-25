import { armedCrash, balancer, fault, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec } from "../../sim/types";

// N16: users in Europe and the US, each sent to the nearest region (10 ms away; the other is 80). Each group's router
// picks the nearest region its health checks call healthy. With DNS, the answer is cached: the router only learns a
// region is gone when the cached answer expires (a health check every TTL). With anycast, the network moves users within
// a couple of checks, 100 ms apart. The US region's workers are the headroom it has for Europe's users.

const DOWN = "EU region goes offline";
const UP = "EU region is back";
const offline = fault("eu-offline", "Take EU region offline", "Bring it back", DOWN, UP, (s) => s.nodes.get("reu")?.up === false);

const router = (id: string, at: [number, number], near: string, far: string, label: string, everyMs: number): NodeSpec =>
  balancer(id, at, [near, far], { label, algo: "nearest", health: { everyMs, failAfter: everyMs > 500 ? 1 : 2, passAfter: 1, timeoutMs: 300 } });

/** `cached`: DNS with this TTL (ms), or 0 for anycast. `usSlots`: the US region's workers. */
const regions = (cached: number, usSlots: number) =>
  scene(
    [
      users("eu", [8, 26], { rate: 60, keys: 50, tag: "eu" }, "deu", { label: "EU users" }),
      users("us", [8, 74], { rate: 60, keys: 50, tag: "us" }, "dus", { label: "US users" }),
      router("deu", [40, 26], "reu", "rus", cached ? "DNS" : "Anycast", cached || 100),
      router("dus", [40, 74], "rus", "reu", cached ? "DNS" : "Anycast", cached || 100),
      server("reu", [84, 26], { label: "EU region", slots: 8, serviceMs: 50 }),
      server("rus", [84, 74], { label: "US region", slots: usSlots, serviceMs: 50 }),
    ],
    {
      links: { "eu>deu": 10, "us>dus": 10, "deu>reu": 10, "deu>rus": 80, "dus>rus": 10, "dus>reu": 80 },
      windowMs: 4000,
      seed: 6,
      script: armedCrash("reu", 1200, 5000, DOWN, UP),
    },
  );

const answered: MetricSpec = { id: "answered", label: "EU users answered", tag: "eu", hint: "Share of EU users' requests that got an answer." };
const euP95: MetricSpec = { id: "p95", label: "EU response time", tag: "eu", hint: "95% of EU users' requests are answered faster than this (the p95)." };
const usBusy: MetricSpec = { id: "util", label: "US region busy", nodes: ["rus"], hint: "Share of the US region's workers that are occupied right now." };
const metrics = [answered, euP95, usBusy];

const nearest: LessonScene = {
  hook: "When a whole region goes dark, how long until its users notice nothing?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Cached DNS",
      title: "One address, cached",
      caption: "Each group's DNS names its nearest region. Users keep that answer for 3 s before asking again.",
      actions: [offline],
      knobs: [knob("ttl", "Cached for", 500, 5000, 500, 3000, ms)],
      metrics,
      parts: [
        { node: ["eu", "us"], text: "Users: 60 a second in each region." },
        { node: ["deu", "dus"], text: "DNS: names the nearest region, kept 3 s." },
        { node: ["reu", "rus"], text: "Regions: 8 workers each, 50 ms a request.", sockets: true },
      ],
      beats: [
        { id: "near", when: { at: 300 }, text: "Watch each group go to its own region: 10 ms away, not 80.", focus: { link: ["deu", "reu"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Take EU region offline.", focus: { action: "eu-offline" }, pause: true },
        {
          id: "stuck",
          when: { metric: answered, is: "<", value: 0.5 },
          text: "EU users still go to the dead region: the cached answer has a [[ttl|time to live]].",
          focus: { link: ["deu", "reu"] },
          term: "ttl",
        },
        { id: "moved", when: { metric: usBusy, is: ">", value: 0.6 }, text: "The cached answer runs out: EU users now reach the US region, 80 ms away.", focus: { link: ["deu", "rus"] } },
        { id: "cost", when: { wait: 0 }, text: "Count the cost: up to 3 s of failures for every EU user.", focus: { metric: "EU users answered" } },
      ],
      predict: {
        prompt: "The EU region goes offline. When do EU users start reaching the US region?",
        options: ["At once", "When their cached answer runs out"],
        answer: 1,
        before: "press",
        reveal: { beat: "stuck", text: "EU users answered: {before} before, {after} while the cached answer lasts." },
        track: { metric: answered },
        holds: (before, after) => before !== null && after !== null && before > 0.9 && after < 0.5,
      },
      break: { action: "eu-offline", beat: "press" },
      build: (v: Values) => regions(v.ttl, 8),
    },
    {
      tone: "fix",
      short: "Anycast",
      title: "Nearest healthy region",
      caption: "One address for both regions. The network sends each user to the nearest region that passes its health checks.",
      actions: [offline],
      knobs: [knob("us", "US region workers", 4, 12, 2, 8)],
      metrics,
      beats: [
        { id: "anycast", when: { step: "enter" }, text: "Now one address reaches the nearest healthy region: that's [[anycast]].", focus: { nodes: ["deu", "dus"] }, term: "anycast" },
        { id: "compare", when: { wait: 0 }, text: "Compare EU users answered: {answered:eu:fix} here, {answered:eu:problem} with a cached address.", focus: { metric: "EU users answered" } },
        { id: "far", when: { wait: 0 }, text: "Moved users pay the long trip: the slowest 1 in 20 take {p95:eu:fix}.", focus: { metric: "EU response time" } },
        { id: "headroom", when: { wait: 600 }, text: "Drag US region workers to 4: no room to spare, and it drowns too.", focus: { knob: "us" } },
      ],
      headline: {
        metric: "EU users answered",
        sentence: "EU region offline: {answered:eu:problem} of EU users answered with a cached address, {answered:eu:fix} with anycast.",
        at: "stuck",
      },
      build: (v: Values) => regions(0, v.us),
    },
  ],
  checks: [
    {
      prompt: "DNS answers are cached for 5 minutes, and a region dies. Its users…",
      options: ["Move within seconds", "Keep failing for up to 5 minutes"],
      answer: 1,
      why: "Their cached answer names the dead region until it runs out. Short TTLs or anycast move them sooner.",
      focus: { link: ["deu", "reu"] },
    },
    {
      prompt: "Failover sends Europe's users to the US region. What must the US region have?",
      options: ["Spare capacity for them", "The same address"],
      answer: 0,
      why: "Failover doubles the survivor's load. Without headroom it drowns, and both regions are down.",
      focus: { nodes: ["rus"], sockets: true },
    },
  ],
  takeaways: {
    use: "Users in several regions: send each to the nearest healthy one, with spare capacity to take a neighbour's users.",
    catch: "Moved users pay the long trip, and a region without headroom falls over when its neighbour's users arrive.",
    seen: "Cloudflare and Google anycast, Route 53 latency routing with health checks, active-active regions.",
    rule: "Fail over fast, with room to spare.",
    interview: "Say: “Anycast or latency-based DNS with health checks, short TTLs, and spare capacity in every region.”",
  },
};

export default nearest;
