import { M, cache, database, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

const readUsers = { rate: 48, keys: 60, skew: 1.1 };

const noCache = () =>
  scene([
    users("u", [6, 50], readUsers, "app"),
    server("app", [32, 50], { slots: 8, serviceMs: 20, to: ["db"] }),
    database("db", [88, 50], { slots: 4, serviceMs: 110, queueMax: 40 }),
  ]);

const dbQueue = M.queue(["db"], "Waiting at Database");
const hits = M.hit(["cache"]);

const caching: LessonScene = {
  hook: "The same ten questions get asked a thousand times. Why answer them a thousand times?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "No cache",
      title: "Every read goes to the database",
      caption: "48 reads a second, 60 different keys, a few of them very popular. The database can do about 36 a second.",
      metrics: [M.p95(), M.busy(["db"], "Database busy"), M.errors()],
      parts: [
        { node: "u", text: "Users: 48 reads a second across 60 keys." },
        { node: "app", text: "App server: 8 workers, 20 ms each.", sockets: true },
        { node: "db", text: "Database: about 36 a second (4 workers, 110 ms).", sockets: true },
      ],
      beats: [
        { id: "follow", when: { at: 30 }, text: "Follow one read: Users → App server → Database and back.", focus: { nodes: ["u", "app", "db"] }, follow: true },
        { id: "capacity", when: { wait: 0 }, text: "Database can finish about 36 reads a second. 48 arrive.", focus: { nodes: ["db"] } },
        {
          id: "line",
          when: { metric: dbQueue, is: ">", value: 5 },
          text: "Watch the line in front of Database grow. Database busy: {util:db}.",
          focus: { nodes: ["db"], dots: "waiting" },
          pause: true,
        },
        {
          id: "waits",
          when: { metric: M.p95(), is: ">", value: 800 },
          text: "Nothing fails yet. Everyone waits: the slowest 1 in 20 takes {p95:problem}, target 400 ms.",
          focus: { metric: "Response time" },
        },
      ],
      predict: {
        prompt: "We add a box that remembers the last 15 answers. 60 different keys exist. What share of reads will skip the database?",
        options: ["About a quarter", "Well over half", "Nearly all"],
        answer: 1,
        before: "end",
        reveal: { beat: "hits", text: "{hit:fix} skipped it. A few keys are asked for far more than the rest." },
        track: { metric: hits, world: 1 },
        holds: (_, after) => after !== null && after > 0.5 && after < 0.9,
      },
      build: noCache,
    },
    {
      tone: "fix",
      short: "With cache",
      title: "Remember the answer",
      caption: "The app asks the cache first. Only reads it has no copy of go on to the database.",
      knobs: [knob("size", "Cache size", 0, 40, 1, 15, (v) => `${v} items`)],
      metrics: [M.p95(), hits, M.busy(["db"], "Database busy")],
      parts: [{ node: "cache", text: "Cache: keeps the last 15 answers it fetched." }],
      beats: [
        {
          id: "miss",
          when: { fx: "miss", node: "cache" },
          text: "No copy in Cache: a [[miss]]. Cache asks Database and keeps a copy.",
          focus: { nodes: ["cache"], link: ["cache", "db"] },
          pause: true,
          term: "miss",
        },
        {
          id: "hit",
          when: { fx: "hit", node: "cache" },
          text: "Same key again: a [[hit]]. The answer comes straight back; Database never sees it.",
          focus: { nodes: ["cache"] },
          pause: true,
          term: "hit",
        },
        {
          id: "evict",
          when: { fx: "evict", node: "cache" },
          text: "Full at 15 of 15, Cache drops the copy unused longest: an [[eviction]].",
          focus: { nodes: ["cache"] },
          term: "eviction",
        },
        {
          id: "hits",
          when: { wait: 0 },
          text: "Cache hits: {hit:fix}. Database busy fell from {util:db:problem} to {util:db:fix}.",
          focus: { metric: "Cache hits" },
        },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Cache size to 0, then to 40. Find where hits stop improving.", focus: { knob: "size" } }],
      headline: {
        metric: "Response time",
        sentence: "Same reads. The slowest 1 in 20 waits {p95:fix} instead of {p95:problem}, and Database is {util:db:fix} busy instead of {util:db:problem}.",
      },
      build: (v: Values) =>
        scene([
          users("u", [6, 50], readUsers, "app"),
          server("app", [32, 50], { slots: 8, serviceMs: 20, to: ["cache"] }),
          cache("cache", [60, 50], "db", { capacity: v.size, ttlMs: 4000 }),
          database("db", [88, 50], { slots: 4, serviceMs: 110, queueMax: 40 }),
        ]),
    },
  ],
  checks: [
    {
      prompt: "A cache hit means…",
      options: ["the database answered quickly", "the cache had a copy, so the database wasn't asked", "the answer was up to date"],
      answer: 1,
      why: "A hit never reaches the database; that is where the speed and the relief come from.",
      focus: { nodes: ["cache"] },
    },
    {
      prompt: "Cache holds 15 answers but there are 60 keys. Hits can still be high because…",
      options: ["the cache is faster than the database", "a few keys are asked for far more often than the rest", "the database copies data into the cache"],
      answer: 1,
      why: "Popular keys stay in the cache; rare ones miss and don't matter much.",
      focus: { nodes: ["cache"] },
    },
  ],
  takeaways: {
    use: "The same data is read far more often than it changes, and a slightly old copy is acceptable.",
    catch: "A cache holds copies, so they can go out of date. It is one more system to run, and it starts empty after a restart.",
    seen: "Redis and Memcached in front of databases, browser caches, CPU caches.",
    rule: "Answer from copies; fetch only what's new.",
  },
};

export default caching;
