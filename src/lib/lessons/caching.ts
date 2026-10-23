import type { MetricSpec } from "../sim/metrics";
import { M, cache, choice, database, knob, lane, ms, scene, server, users } from "./kit";
import type { Lesson, Values } from "./types";

const readUsers = { rate: 48, keys: 60, skew: 1.1 };

const noCache = () =>
  scene([
    users("u", [6, 50], readUsers, "app"),
    server("app", [32, 50], { slots: 8, serviceMs: 20, to: ["db"] }),
    database("db", [88, 50], { slots: 4, serviceMs: 110, queueMax: 40 }),
  ]);

const dbQueue = M.queue(["db"], "Waiting at Database");
const hits = M.hit(["cache"]);

const caching: Lesson = {
  slug: "caching",
  code: "C1",
  line: "caching",
  title: "Caching",
  why: "Databases are slow and hard to scale. Keep popular answers in fast memory and most reads never reach the database.",
  level: "beginner",
  minutes: 6,
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

const cdn: Lesson = {
  slug: "cdn",
  code: "C2",
  line: "caching",
  title: "Content delivery networks",
  why: "Signals take real time to cross the planet. Serving files from a cache near the user turns a trip across the ocean into a trip across town.",
  level: "beginner",
  minutes: 6,
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

const staleScene = (ttl: number | undefined, purge: boolean) =>
  scene([
    users("readers", [6, 28], { rate: 30, keys: 16, skew: 0.6, tag: "reader" }, "app", { label: "Readers" }),
    users("editors", [6, 76], { rate: 6, keys: 16, skew: 0.6, writes: 1, tag: "editor" }, "app", { label: "Editors" }),
    server("app", [34, 50], { slots: 8, serviceMs: 15, calls: { read: ["cache"], write: purge ? ["cache"] : ["db"] } }),
    cache("cache", [62, 28], "db", { capacity: 20, ttlMs: ttl, invalidate: purge }),
    database("db", [90, 50], { slots: 6, serviceMs: 40 }),
  ], { warmMs: 900 });

const staleReads = M.stale({ tag: "reader" });

const stale: Lesson = {
  slug: "stale-data",
  code: "C3",
  line: "caching",
  title: "Expiry & stale data",
  why: "A cache is a copy, and copies go out of date. Expiry and invalidation decide how wrong you can be, and for how long.",
  level: "intermediate",
  minutes: 6,
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

const stampede: Lesson = {
  slug: "cache-stampede",
  code: "C4",
  line: "caching",
  title: "Cache stampede",
  why: "When a popular cached item expires, every request for it misses at the same moment and they all hit the database together.",
  level: "intermediate",
  minutes: 6,
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

export const cachingLessons = [caching, cdn, stale, stampede];
