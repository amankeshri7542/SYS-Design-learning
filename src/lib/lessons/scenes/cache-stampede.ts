import { M, cache, choice, database, scene, server, users } from "../kit";
import type { LessonScene } from "../types";

const stampedeScene = (coalesce: boolean) =>
  scene(
    [
      users("u", [6, 50], { rate: 70, keys: 30, hot: 0.9 }, "app"),
      server("app", [32, 50], { slots: 16, serviceMs: 10, to: ["cache"] }),
      cache("cache", [60, 50], "db", { capacity: 30, ttlMs: 1500, coalesce }),
      database("db", [88, 50], { slots: 2, serviceMs: 160, queueMax: 40 }),
    ],
    { timeoutMs: 1200 },
  );

const dbReads = M.load(["db"], "Database reads");
const dbQueueC4 = M.queue(["db"], "Database queue");

const stampede: LessonScene = {
  hook: "Your most popular page's cached copy expires. Why does everything slow down?",
  dots: ["req", "late", "ok", "gaveup"],
  figures: [
    {
      tone: "problem",
      short: "Stampede",
      title: "A hot item expires",
      caption: "Nine in ten requests are for one item. Its cached copy expires every 1.5 s.",
      metrics: [M.p95(), dbReads, dbQueueC4],
      parts: [
        { node: "u", text: "Users: 70 a second, mostly for one item." },
        { node: "cache", text: "Cache: each copy expires after 1.5 s." },
        { node: "db", text: "Database: 2 workers, 160 ms each.", sockets: true },
      ],
      beats: [
        { id: "hits", when: { at: 200 }, text: "Most requests are answered by Cache: one hot item, one copy.", focus: { nodes: ["cache"] } },
        {
          id: "expire",
          when: { metric: dbQueueC4, is: ">", value: 4 },
          text: "The hot copy expired. Every request for it misses at once.",
          focus: { nodes: ["cache"], link: ["cache", "db"] },
          pause: true,
        },
        {
          id: "rush",
          when: { wait: 0 },
          text: "They all rush Database: a [[stampede|cache stampede]]. Its line jumps.",
          focus: { nodes: ["db"], dots: "waiting" },
          term: "stampede",
        },
        { id: "wait", when: { metric: M.p95(), is: ">", value: 400 }, text: "Everyone waits for the same answer: the slowest 1 in 20 takes {p95:problem}.", focus: { metric: "Response time" } },
      ],
      predict: {
        prompt: "Let the first miss fetch the item while the rest wait for its answer. At the next expiry, the line at Database will…",
        options: ["shrink a little", "nearly vanish", "stay the same"],
        answer: 1,
        before: "end",
        reveal: { beat: "compare", text: "At the same expiry: {before} waiting without sharing, {after} with it." },
        track: { metric: dbQueueC4, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after <= 0.25 * before,
      },
      build: () => stampedeScene(false),
    },
    {
      tone: "fix",
      short: "Coalesced",
      title: "One fetch, everyone else waits for it",
      caption: "Misses for the same item now share one fetch to the database.",
      knobs: [choice("co", "Misses for the same item", ["All go to the database", "Share one fetch"], 1)],
      metrics: [M.p95(), dbReads, dbQueueC4],
      beats: [
        {
          id: "share",
          when: { fx: "miss", node: "cache" },
          text: "On a miss, one request fetches; the rest wait beside Cache: [[coalescing|request coalescing]].",
          focus: { nodes: ["cache"] },
          pause: true,
          term: "coalescing",
        },
        { id: "answer", when: { wait: 0 }, text: "One answer comes back and serves them all.", focus: { nodes: ["cache"] } },
        {
          id: "compare",
          // The next stampede in the other world: compare both lines at that moment.
          when: { metric: dbQueueC4, is: ">", value: 6, world: 0 },
          text: "Another expiry: {queue:db:problem} waiting at Database without sharing, {queue:db:fix} here.",
          focus: { metric: "Database queue" },
        },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Switch to “All go to the database” and watch the rush return.", focus: { knob: "co" } }],
      headline: {
        metric: "Response time",
        sentence: "Same expiring item. The slowest 1 in 20 waits {p95:fix} with one shared fetch, {p95:problem} without.",
        at: "compare",
      },
      build: (v) => stampedeScene(v.co === 1),
    },
  ],
  checks: [
    {
      prompt: "What causes a stampede?",
      options: ["A slow cache", "Many misses for one item at the same moment", "Too many items"],
      answer: 1,
      why: "When a popular copy expires, every request for it misses at once and they all go to the database.",
      focus: { nodes: ["db"], dots: "waiting" },
    },
    {
      prompt: "With coalescing, what do the waiting requests depend on?",
      options: ["Each other", "The one fetch in flight", "The cache size"],
      answer: 1,
      why: "They all wait for that single fetch, so it needs a timeout of its own.",
      focus: { nodes: ["cache"] },
    },
  ],
  takeaways: {
    use: "Use it for very popular keys, expensive queries, and anything that expires on a fixed schedule.",
    catch: "Waiting requests all depend on that single fetch. Give it a timeout, or serve the old copy while refreshing early.",
    seen: "Go's singleflight, Varnish request coalescing, CDN origin shielding.",
    rule: "One miss fetches; the rest wait.",
  },
};

export default stampede;
