import { M, armedCrash, cache, choice, database, fault, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// R7: users ask for 3,000 pages, some far more often than others; a cache in front of the database holds the 800 most
// asked for, so the database (80 a second at most) sees only the misses. The cache restarts and comes back empty: every request
// misses at once, the database is swamped, and the line in front of it holds back the cache from refilling, so it stays
// swamped for seconds. Warmed before it serves, the cache comes back holding the hottest pages and the database barely
// notices.

const RESTART = "The cache restarts";
const BACK = "The cache is back";
// The restart counts as under way for 0.4 s after the cache went down, long enough to see what it comes back to.
const restart = fault("restart-c", "Restart the cache", "Wait for it to come back", RESTART, BACK, (s) => {
  const c = s.nodes.get("c");
  return !!c && (!c.up || s.t - c.downAt < 400);
});
const SHARES = [0, 0.25, 0.5, 1];

/** `warm`: share of the cache filled with the hottest pages before it serves again. */
const site = (warm: number): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 220, keys: 3000, skew: 1.1 }, "app", { label: "Users" }),
      server("app", [32, 50], { label: "App server", slots: 32, serviceMs: 3, blocking: true, to: ["c"], callTimeoutMs: 800 }),
      cache("c", [60, 50], "db", { label: "Cache", capacity: 800, prewarm: warm ? Math.round(800 * warm) : undefined }),
      database("db", [88, 50], { label: "Database", slots: 2, serviceMs: 25 }),
    ],
    {
      timeoutMs: 1000,
      windowMs: 1000,
      seed: 53,
      // Open on a cache that has filled up.
      warmMs: 6000,
      // After the warm-up, as a learner would press it.
      script: armedCrash("c", 7500, 40, RESTART, BACK),
    },
  );

const hits = M.hit(["c"], "Cache hits");
const dbBusy: MetricSpec = { id: "util", label: "Database busy", nodes: ["db"], hint: "Share of the database's workers busy right now." };
const metrics = [M.p95(), dbBusy, hits, M.errors()];

const coldCaches: LessonScene = {
  hook: "Only the cache restarted. Why did the whole site go down?",
  dots: ["req", "late", "ok", "failed", "gaveup"],
  figures: [
    {
      tone: "problem",
      short: "Cold restart",
      title: "Back up, and empty",
      caption: "A cache holds the 800 most asked-for of 3,000 pages, in front of a database that answers 80 a second at most.",
      actions: [restart],
      metrics,
      parts: [
        { node: "u", text: "Users: 220 a second, some pages far more popular." },
        { node: "app", text: "App server: asks Cache first." },
        { node: "c", text: "Cache: the 800 most asked-for pages." },
        { node: "db", text: "Database: 80 a second at most.", sockets: true },
      ],
      beats: [
        { id: "warm", when: { at: 300 }, text: "Watch Cache answer most requests: {hit:c} of them. Database sees only the misses.", focus: { nodes: ["c"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Restart the cache.", focus: { action: "restart-c" }, pause: true },
        {
          id: "herd",
          when: { note: BACK },
          text: "It's back, empty: every request misses at once, a [[thundering-herd|thundering herd]].",
          focus: { link: ["c", "db"] },
          term: "thundering-herd",
        },
        { id: "drown", when: { metric: dbBusy, is: ">", value: 0.95 }, text: "Database drowns: {util:db} busy, and its line keeps growing.", focus: { nodes: ["db"], dots: "waiting" } },
        { id: "slow", when: { metric: M.p95(), is: ">", value: 600 }, text: "Read Response time: {p95}. Misses wait in Database's line, so Cache refills slowly.", focus: { metric: "Response time" } },
      ],
      predict: {
        prompt: "The cache is about to restart and come back empty. The database will…",
        options: ["Take the extra reads in its stride", "Be swamped"],
        answer: 1,
        before: "press",
        reveal: { beat: "drown", text: "Database busy: {before} before the restart, {after} after." },
        track: { metric: dbBusy },
        holds: (_, after) => after !== null && after > 0.9,
      },
      break: { action: "restart-c", beat: "press" },
      build: () => site(0),
    },
    {
      tone: "fix",
      short: "Warmed",
      title: "Fill it before it serves",
      caption: "The same site. When the cache restarts, it loads the most asked-for pages before it takes any traffic.",
      actions: [restart],
      knobs: [choice("warm", "Warmed before serving", ["None", "25%", "50%", "All"], 3)],
      metrics,
      beats: [
        {
          id: "warming",
          when: { step: "enter" },
          text: "Now Cache loads the hottest pages before it serves again: [[cache-warming|warming]].",
          focus: { nodes: ["c"] },
          term: "cache-warming",
        },
        { id: "press-warm", when: { wait: 0 }, text: "Press ⚡ Restart the cache.", focus: { action: "restart-c" }, pause: true },
        { id: "back", when: { note: BACK }, text: "It's back holding the hot pages already: hits stay near {hit:c:fix}.", focus: { nodes: ["c"] } },
        { id: "compare", when: { wait: 800 }, text: "Compare Database busy: {util:db:fix} warmed, {util:db:problem} cold.", focus: { metric: "Database busy" } },
        { id: "less", when: { wait: 600 }, text: "Switch Warmed before serving to 25%: a smaller herd, but Database feels it.", focus: { knob: "warm" } },
      ],
      break: { action: "restart-c", beat: "press-warm" },
      headline: { metric: "Response time", sentence: "Cache restarted: response time {p95:problem} when it came back cold, {p95:fix} warmed." },
      build: (v: Values) => site(SHARES[v.warm]),
    },
  ],
  checks: [
    {
      prompt: "Why did the database fall over when only the cache restarted?",
      options: ["Every read became a miss at the same moment", "The database restarted too"],
      answer: 0,
      why: "The database was sized for the misses only. An empty cache sends it everything, all at once.",
      focus: { link: ["c", "db"] },
    },
    {
      prompt: "Besides warming, what else keeps a herd from forming?",
      options: ["Spreading things out: random jitter on expiry and reconnects", "A faster network"],
      answer: 0,
      why: "Herds come from everyone acting at once. Random jitter, ramping traffic in slowly and coalescing misses spread it out.",
      focus: { nodes: ["db"] },
    },
  ],
  takeaways: {
    use: "Any cache or pool that hides a slow backend: warm it before it takes traffic, ramp traffic in, and jitter expiry times.",
    catch: "Anything that makes everyone act in the same instant (a restart, a deploy, keys expiring together) is a spike you never sized for.",
    seen: "Cache warming on deploy, slow start on load balancers, jittered TTLs, request coalescing, the AWS outages caused by cold caches.",
    rule: "Never let everyone arrive at once.",
    interview: "Say: “A cold cache sends every read to the database: warm it first, ramp traffic, jitter expiries and coalesce misses.”",
  },
};

export default coldCaches;
