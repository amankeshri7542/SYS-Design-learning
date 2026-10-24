import type { MetricSpec } from "../../sim/metrics";
import { M, cache, knob, lane, scene, server, users } from "../kit";
import type { LessonScene } from "../types";

const REGIONS = [
  { id: "am", label: "Americas", far: 40 },
  { id: "eu", label: "Europe", far: 140 },
  { id: "as", label: "Asia", far: 220 },
];

const typical = (o: Partial<MetricSpec> = {}): MetricSpec => ({
  id: "p50",
  label: "Typical response",
  hint: "Half of all requests are answered faster than this (the median).",
  ...o,
});
const asiaTypical = typical({ tag: "as", label: "Asia, typical" });

const origin = () => server("origin", [90, 50], { slots: 8, serviceMs: 30, label: "Origin (US)" });

const noCdn = () =>
  scene(
    [...REGIONS.map((r, i) => users(r.id, [6, lane(3, i)], { rate: 16, keys: 14, skew: 1.2, tag: r.id }, "origin", { label: r.label })), origin()],
    {
      sloMs: 250,
      links: Object.fromEntries(REGIONS.map((r) => [`${r.id}>origin`, r.far])),
      linkLabels: { "eu>origin": "~140 ms away", "as>origin": "~220 ms away" },
      wideH: 460,
    },
  );

const cdn: LessonScene = {
  hook: "Why does the same page load fast in New York and slowly in Tokyo?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Origin only",
      title: "Everyone fetches from one origin",
      caption: "The origin is in the US. Asia's requests cross the ocean both ways before any work starts.",
      metrics: [typical(), asiaTypical, M.load(["origin"], "Origin requests")],
      parts: [
        { node: ["am", "eu", "as"], text: "Users in three regions, 16 requests a second each." },
        { node: "origin", text: "Origin: in the US, 30 ms of work each." },
      ],
      beats: [
        { id: "follow", when: { at: 100 }, text: "Follow one request from Asia: 220 ms each way on the wire.", focus: { nodes: ["as"], link: ["as", "origin"] }, follow: true },
        { id: "work", when: { wait: 0 }, text: "At the origin the work takes 30 ms. The trip takes 440.", focus: { nodes: ["origin"] } },
        { id: "asia", when: { wait: 0 }, text: "Asia's typical response: {p50:as}. The target is 250 ms.", focus: { metric: "Asia, typical" } },
        { id: "load", when: { wait: 0 }, text: "The origin answers every request from every region: {load:origin}.", focus: { nodes: ["origin"] } },
      ],
      predict: {
        prompt: "We put a small cache next to each region. Asia's typical response will…",
        options: ["barely change", "fall by about half", "fall to a fraction"],
        answer: 2,
        before: "end",
        reveal: { beat: "faster", text: "Asia's typical answer: {before} from the origin, {after} nearby." },
        track: { metric: asiaTypical, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.4 * before,
      },
      trace: { client: "as" },
      build: noCdn,
    },
    {
      tone: "fix",
      short: "With CDN",
      title: "Caches next to each region",
      caption: "Each region now talks to a nearby cache. Only misses make the long trip.",
      knobs: [knob("size", "Edge cache size", 0, 14, 1, 10, (v) => `${v} files`)],
      metrics: [typical(), M.hit(["e-am", "e-eu", "e-as"], "Edge hits"), M.load(["origin"], "Origin requests")],
      parts: [{ node: ["e-am", "e-eu", "e-as"], text: "Nearby caches: 14 ms from each region." }],
      beats: [
        {
          id: "hit",
          when: { fx: "hit", node: "e-as" },
          text: "Asia's [[edge]] has a copy: answered 14 ms away, no ocean.",
          focus: { nodes: ["e-as"] },
          pause: true,
          term: "edge",
        },
        {
          id: "miss",
          when: { fx: "miss" },
          text: "A miss still crosses the ocean once; its copy then serves everyone nearby.",
          focus: { nodes: ["origin"] },
        },
        { id: "faster", when: { wait: 0 }, text: "Asia's typical response: {p50:as:fix}, down from {p50:as:problem}.", focus: { metric: "Asia, typical" } },
        { id: "origin", when: { wait: 0 }, text: "The origin now sees only misses: {load:origin:fix}.", focus: { nodes: ["origin"] } },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Edge cache size to 0: every request crosses the ocean again.", focus: { knob: "size" } }],
      headline: {
        metric: "Typical response",
        sentence: "Same requests. Typical response: {p50:problem} from one origin, {p50:fix} with edges; Asia {p50:as:problem} to {p50:as:fix}.",
      },
      trace: { client: "as" },
      build: (v) =>
        scene(
          [
            ...REGIONS.map((r, i) =>
              users(r.id, [6, lane(3, i)], { rate: 16, keys: 14, skew: 1.2, tag: r.id }, `e-${r.id}`, { label: r.label }),
            ),
            ...REGIONS.map((r, i) =>
              cache(`e-${r.id}`, [34, lane(3, i)], "origin", {
                glyph: "edge",
                label: `Edge · ${r.label}`,
                capacity: v.size,
                ttlMs: 6000,
              }),
            ),
            origin(),
          ],
          {
            sloMs: 250,
            links: Object.fromEntries(REGIONS.flatMap((r) => [[`${r.id}>e-${r.id}`, 14], [`e-${r.id}>origin`, r.far]])),
            linkLabels: { "e-eu>origin": "~140 ms", "e-as>origin": "~220 ms" },
            wideH: 460,
            warmMs: 1200,
          },
        ),
    },
  ],
  checks: [
    {
      prompt: "What makes Asia slow without a CDN?",
      options: ["The origin's work", "The distance, both ways", "Too many users"],
      answer: 1,
      why: "The work took 30 ms; the round trip across the ocean took about 440.",
      focus: { link: ["e-as", "origin"] },
    },
    {
      prompt: "Which responses can an edge cache serve?",
      options: ["Ones that are the same for many users", "Each user's private data", "Writes"],
      answer: 0,
      why: "An edge keeps copies; only answers that many people share are worth copying near them.",
      focus: { nodes: ["e-as"] },
    },
  ],
  takeaways: {
    use: "Use one for images, video, scripts and any response that's the same for many users.",
    catch: "Changes take time to reach every edge, and personalised or private responses usually can't be shared.",
    seen: "Cloudflare, Akamai, Fastly, and Amazon CloudFront.",
    rule: "Move the copy, not the user.",
  },
};

export default cdn;
