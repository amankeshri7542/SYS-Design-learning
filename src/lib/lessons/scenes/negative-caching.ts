import { M, cache, choice, database, scene, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// C5: users read popular items through a cache whose copies last 0.8 s; a bot asks for ids that don't exist. A miss
// stores nothing, so every bot request reaches the database and the users' own misses wait behind it. Remembering
// "not found" works only while the bot repeats its ids (a pool of 40); an existence check in front of the cache turns
// away almost every missing id, repeated or not. The bot's ids are a knob in both fixes.

/** `defence`: 0 none, 1 remember "not found" for 5 s, 2 an existence check (3% slip through). `fresh`: the bot never repeats an id. */
const store = (defence: number, fresh: boolean) =>
  scene(
    [
      users("u", [8, 26], { rate: 30, keys: 30, skew: 1, tag: "user" }, "cache", { label: "Users" }),
      users("bot", [8, 74], { rate: 60, keys: 30, tag: "bot", absent: 1, absentKeys: fresh ? undefined : 40 }, "cache", { label: "Bot", glyph: "bot" }),
      cache("cache", [48, 50], "db", {
        capacity: 200,
        ttlMs: 800,
        negativeTtlMs: defence === 1 ? 5000 : undefined,
        bloom: defence === 2 ? { fp: 0.03 } : undefined,
      }),
      database("db", [86, 50], { slots: 4, serviceMs: 50 }),
    ],
    { windowMs: 2000, seed: 13 },
  );

const queries = M.load(["db"], "Database queries");
const usersP95 = M.p95({ tag: "user", label: "Users' response time", hint: "95% of real users' requests are answered faster than this (the p95)." });
const stopped: MetricSpec = { id: "filtered", label: "Stopped by the check", nodes: ["cache"], hint: "Share of lookups the existence check answered “not found” at once." };
const metrics = [queries, usersP95, M.hit(["cache"]), stopped];
const botIds = (value: number) => choice("fresh", "Bot's ids", ["Repeat", "Never repeat"], value);

const negative: LessonScene = {
  hook: "Why can a request for something that doesn't exist hurt everyone else?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "No defence",
      title: "Lookups for nothing",
      caption: "A bot asks for ids that don't exist, from a list of 40. The cache keeps only answers it found.",
      metrics,
      parts: [
        { node: "u", text: "Users: 30 a second, popular items." },
        { node: "bot", text: "Bot: 60 a second, ids that don't exist." },
        { node: "cache", text: "Cache: keeps each answer found for 0.8 s." },
        { node: "db", text: "Database: 4 workers, 50 ms a lookup.", sockets: true },
      ],
      beats: [
        { id: "miss", when: { at: 300 }, text: "Watch the bot's requests miss: nothing is kept for an id that doesn't exist.", focus: { nodes: ["cache"] } },
        {
          id: "penetrate",
          when: { wait: 0 },
          text: "Every one goes through to Database: that's [[penetration|cache penetration]].",
          focus: { link: ["cache", "db"] },
          pause: true,
          term: "penetration",
        },
        { id: "load", when: { metric: queries, is: ">", value: 50 }, text: "Read Database queries: {load:db}, most of them searching for nothing.", focus: { metric: "Database queries" } },
        { id: "users", when: { metric: usersP95, is: ">", value: 250 }, text: "Users' misses wait behind the bot: their slowest 1 in 20 take {p95:user}.", focus: { metric: "Users' response time" } },
      ],
      predict: {
        prompt: "The cache will remember “not found” for 5 s. The database will get…",
        options: ["Much quieter", "About as busy"],
        answer: 0,
        before: "end",
        reveal: { beat: "kept", text: "Database queries: {before} without, {after} remembering “not found”." },
        track: { metric: queries, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before * 0.6,
      },
      build: () => store(0, false),
    },
    {
      tone: "fix",
      short: "Not found",
      title: "Remember “not found”",
      caption: "The cache also keeps “not found” answers, for 5 s. You choose whether the bot repeats its ids.",
      knobs: [botIds(0)],
      metrics,
      beats: [
        {
          id: "kept",
          when: { step: "enter" },
          text: "Now a miss for a missing id is kept too: a [[negative-cache|negative cache]].",
          focus: { nodes: ["cache"] },
          term: "negative-cache",
        },
        { id: "quiet", when: { wait: 0 }, text: "Compare Database queries: {load:db:2} here, {load:db:problem} with no defence.", focus: { metric: "Database queries" } },
        { id: "fresh", when: { wait: 600 }, text: "Switch Bot's ids to Never repeat: each id is new, and every one gets through again.", focus: { knob: "fresh" } },
      ],
      build: (v: Values) => store(1, v.fresh === 1),
    },
    {
      tone: "fix",
      short: "Existence check",
      title: "Check that it exists",
      caption: "In front of the cache, a compact list of every id that exists answers most missing ids at once.",
      knobs: [botIds(0)],
      metrics,
      beats: [
        {
          id: "check",
          when: { step: "enter" },
          text: "Now an [[existence-check|existence check]] says “no such id” before any lookup.",
          focus: { nodes: ["cache"] },
          term: "existence-check",
        },
        { id: "stopped", when: { wait: 0 }, text: "Read Stopped by the check: {filtered:cache:3}. A few slip through, and that's fine.", focus: { metric: "Stopped by the check" } },
        { id: "either", when: { wait: 600 }, text: "Switch Bot's ids to Never repeat: the check doesn't care. The database stays quiet.", focus: { knob: "fresh" } },
      ],
      headline: { metric: "Database queries", sentence: "With the bot asking for missing ids: {load:db:problem} database queries, {load:db:3} with an existence check." },
      build: (v: Values) => store(2, v.fresh === 1),
    },
  ],
  checks: [
    {
      prompt: "A bot asks for random ids that never repeat. Which defence works?",
      options: ["Remember “not found”", "An existence check"],
      answer: 1,
      why: "A remembered “not found” helps only if the same id comes back. An existence check knows every id that exists.",
      focus: { nodes: ["cache"] },
    },
    {
      prompt: "An existence check sometimes says “maybe” for an id that doesn't exist. What happens then?",
      options: ["The lookup goes to the database", "The user gets an error"],
      answer: 0,
      why: "A “maybe” just means an ordinary lookup, which then finds nothing. It never says “no” for an id that exists.",
      focus: { link: ["cache", "db"] },
    },
  ],
  takeaways: {
    use: "Any public lookup by id: remember “not found” briefly, and put an existence check in front when ids can be guessed.",
    catch: "A remembered “not found” goes stale when the item is created; keep it short, or clear it on create.",
    seen: "Bloom filters in Cassandra and Bigtable, Redis-backed negative caches, CDN 404 caching.",
    rule: "Answer “nothing” without looking.",
  },
};

export default negative;
