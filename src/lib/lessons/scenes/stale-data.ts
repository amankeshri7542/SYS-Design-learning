import { M, cache, choice, database, knob, ms, scene, server, users } from "../kit";
import type { LessonScene } from "../types";

const staleScene = (ttl: number | undefined, purge: boolean) =>
  scene([
    users("readers", [6, 28], { rate: 30, keys: 16, skew: 0.6, tag: "reader" }, "app", { label: "Readers" }),
    users("editors", [6, 76], { rate: 6, keys: 16, skew: 0.6, writes: 1, tag: "editor" }, "app", { label: "Editors" }),
    server("app", [34, 50], { slots: 8, serviceMs: 15, calls: { read: ["cache"], write: purge ? ["cache"] : ["db"] } }),
    cache("cache", [62, 28], "db", { capacity: 20, ttlMs: ttl, invalidate: purge }),
    database("db", [90, 50], { slots: 6, serviceMs: 40 }),
  ], { warmMs: 900 });

const staleReads = M.stale({ tag: "reader" });

const stale: LessonScene = {
  hook: "You fixed a typo a minute ago. Why do readers still see it?",
  dots: ["req", "ok", "stale"],
  figures: [
    {
      tone: "problem",
      short: "Never expire",
      title: "Copies that never expire",
      caption: "Editors change items in the database. The cache keeps whatever copy it fetched first.",
      metrics: [staleReads, M.hit(["cache"]), M.load(["db"], "Database load")],
      parts: [
        { node: "readers", text: "Readers: 30 reads a second over 16 items." },
        { node: "editors", text: "Editors: 6 changes a second." },
        { node: "cache", text: "Cache: keeps every copy forever." },
        { node: "db", text: "Database: always has the latest." },
      ],
      beats: [
        { id: "edit", when: { at: 200 }, text: "Watch an editor's change go to Database, past Cache.", focus: { nodes: ["db"], link: ["app", "db"] } },
        {
          id: "stale",
          when: { metric: staleReads, is: ">", value: 0.02 },
          text: "A violet donut: a reader got an old copy. That's a [[stale-read|stale read]].",
          focus: { dots: "stale" },
          pause: true,
          term: "stale-read",
        },
        { id: "count", when: { wait: 0 }, text: "Stale reads: {stale:reader}. Cache never learns the item changed.", focus: { metric: "Stale reads" } },
        { id: "hits", when: { metric: M.hit(["cache"]), is: ">", value: 0.85 }, text: "Yet Cache hits look great: {hit}.", focus: { metric: "Cache hits" } },
      ],
      predict: {
        prompt: "Give each copy 0.8 s to live, and delete it when an editor saves. Stale reads will…",
        options: ["drop to almost none", "fall by about half", "stay the same"],
        answer: 0,
        before: "end",
        reveal: { beat: "fresh", text: "Stale reads: {before} before, {after} now." },
        track: { metric: staleReads, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.25 * before,
      },
      build: () => staleScene(undefined, false),
    },
    {
      tone: "fix",
      short: "Expire + purge",
      title: "Expire copies, or delete them on write",
      caption: "Each copy now lives 0.8 s, and an editor's save deletes the cached copy.",
      knobs: [
        knob("ttl", "Copy lifetime", 100, 3000, 100, 800, ms),
        choice("purge", "When an editor saves", ["Leave the copy", "Delete the copy"], 1),
      ],
      metrics: [staleReads, M.hit(["cache"]), M.load(["db"], "Database load")],
      beats: [
        { id: "ttl", when: { step: "enter" }, text: "Every copy now expires after 0.8 s: its [[ttl|time to live]].", focus: { nodes: ["cache"] }, term: "ttl" },
        {
          id: "purge",
          when: { wait: 0 },
          text: "An editor's save now goes through Cache and deletes the old copy: [[invalidation]].",
          focus: { link: ["app", "cache"] },
          term: "invalidation",
        },
        { id: "fresh", when: { wait: 0 }, text: "Stale reads: {stale:reader:fix}, down from {stale:reader:problem}.", focus: { metric: "Stale reads" } },
        { id: "cost", when: { wait: 0 }, text: "The cost: more misses. Database load {load:db:fix} instead of {load:db:problem}.", focus: { metric: "Database load" } },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Copy lifetime to 3 s and leave the copy on save. Stale reads return.", focus: { knob: "ttl" } }],
      headline: {
        metric: "Stale reads",
        sentence: "Same readers and editors. Stale reads: {stale:reader:problem} with copies kept forever, {stale:reader:fix} with expiry and delete on save.",
      },
      build: (v) => staleScene(v.ttl, v.purge === 1),
    },
  ],
  checks: [
    {
      prompt: "Why did the cache keep serving old copies?",
      options: ["It was too small", "Nothing told it the item changed", "The database was slow"],
      answer: 1,
      why: "Writes went straight to the database. Without expiry or invalidation, the cache never learned.",
      focus: { nodes: ["cache"] },
    },
    {
      prompt: "A shorter copy lifetime means…",
      options: ["fewer stale reads and more database load", "fewer stale reads and less load", "more hits"],
      answer: 0,
      why: "Copies expire sooner, so more reads miss and go to the database, but each copy is fresher.",
      focus: { nodes: ["db"] },
    },
  ],
  takeaways: {
    use: "Give every cached value a lifetime, and delete or update the copy whenever the source changes.",
    catch: "There's no free lunch. Short lifetimes cost database load, and invalidation can race with in-flight reads.",
    seen: "HTTP Cache-Control max-age, Redis TTLs, CDN purge APIs.",
    rule: "Every copy needs an expiry.",
  },
};

export default stale;
