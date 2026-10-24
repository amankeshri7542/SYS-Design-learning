import { M, armedCrash, cache, choice, database, fault, scene, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// C6: users read and write 40 keys through a cache in front of a database 20 ms away. Write-behind confirms a write as
// soon as the cache has it and saves the new values every second: writes are fast, but a crash loses everything not yet
// saved, and reads then find the database's older values. Write-through saves each write to the database before
// confirming it and keeps the new value in the cache: nothing is lost, every write pays the trip. Write-around saves to
// the database and drops the cache's copy, so the next read misses.

const CRASH = "The cache crashes";
const BACK = "The cache is back";
const crashCache = fault("crash-cache", "Crash the cache", "Restore the cache", CRASH, BACK, (s) => s.nodes.get("c")?.up === false);

/** `mode`: what the cache does with a write. */
const store = (mode: "behind" | "through" | "around"): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 60, keys: 40, writes: 0.4 }, "c", { label: "Users" }),
      cache("c", [46, 50], "db", { capacity: 50, writeMode: mode, flushMs: 1000 }),
      database("db", [86, 50], { slots: 4, serviceMs: 30 }),
    ],
    { links: { "c>db": 20 }, windowMs: 2000, seed: 85, script: armedCrash("c", 2500, 300, CRASH, BACK) },
  );

const lost: MetricSpec = { id: "lostWrites", label: "Lost writes", hint: "Writes confirmed to users and then lost in a crash, in the window." };
const unsaved: MetricSpec = { id: "unsaved", label: "Unsaved writes", hint: "Writes confirmed to users but not yet saved to Database: a crash now would lose them." };
const writeTime = M.p95({ op: "write", label: "Write time", hint: "95% of writes are confirmed faster than this (the p95)." });
const stale = M.stale({ hint: "Share of reads that missed a write already confirmed to its user." });
const metrics = [lost, unsaved, writeTime, stale];

const cacheWrites: LessonScene = {
  hook: "Your cache confirms writes instantly. What happens to them when it crashes?",
  dots: ["req", "ok", "stale", "copy", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Save later",
      title: "Confirm now, save later",
      caption: "Users read and write 40 keys through a cache. The cache confirms each write at once and saves new values to Database every second.",
      actions: [crashCache],
      metrics,
      parts: [
        { node: "u", text: "Users: 60 a second, 4 in 10 writes." },
        { node: "c", text: "Cache: confirms writes, saves them every second." },
        { node: "db", text: "Database: 30 ms a request, 20 ms away." },
      ],
      beats: [
        {
          id: "behind",
          when: { at: 300 },
          text: "Watch writes stop at Cache: confirmed at once, saved later: [[write-behind|write-behind]].",
          focus: { nodes: ["c"] },
          term: "write-behind",
        },
        { id: "unsaved", when: { metric: unsaved, is: ">", value: 5 }, text: "Read Unsaved writes: {unsaved}. Confirmed to users, but only in Cache.", focus: { metric: "Unsaved writes" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash the cache.", focus: { action: "crash-cache" }, pause: true },
        { id: "lost", when: { metric: lost, is: ">", value: 0 }, text: "Read Lost writes: {lostWrites}. Confirmed, then gone with the cache.", focus: { metric: "Lost writes" } },
      ],
      predict: {
        prompt: "Cache is about to crash. The writes it hasn't saved yet will…",
        options: ["Be saved when it restarts", "Be lost"],
        answer: 1,
        before: "press",
        reveal: { beat: "lost", text: "Lost writes: {before} before the crash, {after} after." },
        track: { metric: lost },
        holds: (_, after) => after !== null && after > 0,
      },
      break: { action: "crash-cache", beat: "press" },
      build: () => store("behind"),
    },
    {
      tone: "fix",
      short: "Write through",
      title: "Save first, then confirm",
      caption: "The same users and cache. Each write goes to Database first, then into the cache, before it is confirmed.",
      actions: [crashCache],
      knobs: [choice("mode", "On a write", ["Write-through", "Write-around"], 0)],
      metrics,
      beats: [
        {
          id: "through",
          when: { step: "enter" },
          text: "Now a write goes to Database, then into Cache: [[write-through|write-through]].",
          focus: { nodes: ["c"] },
          term: "write-through",
        },
        { id: "press-through", when: { wait: 0 }, text: "Press ⚡ Crash the cache.", focus: { action: "crash-cache" }, pause: true },
        { id: "compare", when: { note: CRASH }, text: "Compare Lost writes: {lostWrites:fix} here, {lostWrites:problem} saving later.", focus: { metric: "Lost writes" } },
        { id: "cost", when: { wait: 0 }, text: "The cost: Write time {p95:fix}, a trip to Database on every write.", focus: { metric: "Write time" } },
        { id: "around", when: { wait: 600 }, text: "Switch On a write to Write-around: writes skip Cache and drop its copy.", focus: { knob: "mode" } },
      ],
      break: { action: "crash-cache", beat: "press-through" },
      headline: { metric: "Lost writes", sentence: "The cache down 0.3 s: {lostWrites:problem} confirmed writes lost saving later, {lostWrites:fix} writing through." },
      build: (v: Values) => store(v.mode === 1 ? "around" : "through"),
    },
  ],
  checks: [
    {
      prompt: "Why did saving later lose writes?",
      options: ["They were confirmed before they reached Database", "Database crashed"],
      answer: 0,
      why: "Write-behind says yes as soon as Cache has the write; until it is saved, Cache holds the only copy.",
      focus: { nodes: ["c"] },
    },
    {
      prompt: "Write-through loses nothing. What does it cost?",
      options: ["Every write waits for Database", "More stale reads"],
      answer: 0,
      why: "Each write makes the trip to Database before it is confirmed, so writes take as long as Database does.",
      focus: { metric: "Write time" },
    },
  ],
  takeaways: {
    use: "Write-through for data you can't lose; write-behind for counters and buffers where speed beats a small loss; write-around for data rarely read back.",
    catch: "Write-behind loses what it hasn't saved in a crash; write-through slows every write; write-around makes the next read miss.",
    seen: "Redis as a write-behind buffer, Ehcache and Hibernate write-through, DynamoDB Accelerator (DAX), disk write-back caches.",
    rule: "Confirm a write only once it's saved.",
    interview: "Say: “Write-through for durability, write-behind with a durable log for write speed, cache-aside for read-heavy data.”",
  },
};

export default cacheWrites;
