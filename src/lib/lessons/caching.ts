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

const caching: Lesson = {
  slug: "caching",
  code: "C1",
  line: "caching",
  title: "Caching",
  why: "Databases are slow and hard to scale. Keep popular answers in fast memory and most reads never reach the database.",
  figures: [
    {
      tone: "problem",
      title: "Every read goes to the database",
      caption:
        "The database can answer about 36 reads a second and it's getting 48. A queue builds in front of it and responses slow to a crawl.",
      metrics: [M.p95(), M.busy(["db"], "Database busy"), M.errors()],
      build: noCache,
    },
    {
      tone: "fix",
      title: "A cache in front of the database",
      caption:
        "The app asks the cache first. A hit (green ring) answers right away. A miss (amber ring) fetches from the database and keeps a copy for next time.",
      knobs: [knob("size", "Cache size", 0, 40, 1, 15, (v) => `${v} items`)],
      metrics: [M.p95(), M.hit(["cache"]), M.busy(["db"], "Database busy")],
      build: (v: Values) =>
        scene([
          users("u", [6, 50], readUsers, "app"),
          server("app", [32, 50], { slots: 8, serviceMs: 20, to: ["cache"] }),
          cache("cache", [60, 50], "db", { capacity: v.size, ttlMs: 4000 }),
          database("db", [88, 50], { slots: 4, serviceMs: 110, queueMax: 40 }),
        ]),
      compare: { label: "no cache", build: noCache },
    },
  ],
  takeaways: {
    use: "Use one when the same data is read far more often than it changes, and a slightly old copy is acceptable.",
    catch: "A cache only holds copies, which can go out of date. It's also one more system to run, and it starts empty after a restart.",
    seen: "Redis and Memcached in front of databases, browser caches, and CPU caches.",
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
  figures: [
    {
      tone: "problem",
      title: "Everyone fetches from one origin",
      caption:
        "The origin is in the US. Requests from Asia spend most of their time crossing the ocean, both there and back, before any work starts.",
      metrics: [typical(), typical({ tag: "as", label: "Asia, typical" }), M.load(["origin"], "Origin requests")],
      build: noCdn,
    },
    {
      tone: "fix",
      title: "Edge caches next to each region",
      caption:
        "Each region talks to a nearby edge server. Only misses make the long trip, and the copy they bring back serves everyone nearby.",
      knobs: [knob("size", "Edge cache size", 0, 14, 1, 10, (v) => `${v} files`)],
      metrics: [typical(), M.hit(["e-am", "e-eu", "e-as"], "Edge hits"), M.load(["origin"], "Origin requests")],
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
      compare: { label: "no CDN", build: noCdn },
    },
  ],
  takeaways: {
    use: "Use one for images, video, scripts and any response that's the same for many users.",
    catch: "Changes take time to reach every edge, and personalised or private responses usually can't be shared.",
    seen: "Cloudflare, Akamai, Fastly, and Amazon CloudFront.",
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

const stale: Lesson = {
  slug: "stale-data",
  code: "C3",
  line: "caching",
  title: "Expiry & stale data",
  why: "A cache is a copy, and copies go out of date. Expiry and invalidation decide how wrong you can be, and for how long.",
  figures: [
    {
      tone: "problem",
      title: "Copies that never expire",
      caption:
        "Editors update items in the database, but the cache keeps serving the old copies. Violet rings are readers being handed out-of-date data.",
      metrics: [M.stale({ tag: "reader" }), M.hit(["cache"]), M.load(["db"], "Database load")],
      build: () => staleScene(undefined, false),
    },
    {
      tone: "fix",
      title: "Expire copies, or delete them on write",
      caption:
        "A short lifetime means fewer stale reads but more trips to the database. Deleting the copy when an editor writes fixes most of the staleness at once.",
      knobs: [
        knob("ttl", "Copy lifetime", 100, 3000, 100, 800, ms),
        choice("purge", "When an editor saves", ["Leave the copy", "Delete the copy"], 1),
      ],
      metrics: [M.stale({ tag: "reader" }), M.hit(["cache"]), M.load(["db"], "Database load")],
      build: (v) => staleScene(v.ttl, v.purge === 1),
      compare: { label: "never expiring", build: () => staleScene(undefined, false) },
    },
  ],
  takeaways: {
    use: "Give every cached value a lifetime, and delete or update the copy whenever the source changes.",
    catch: "There's no free lunch. Short lifetimes cost database load, and invalidation can race with in-flight reads.",
    seen: "HTTP Cache-Control max-age, Redis TTLs, CDN purge APIs.",
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

const stampede: Lesson = {
  slug: "cache-stampede",
  code: "C4",
  line: "caching",
  title: "Cache stampede",
  why: "When a popular cached item expires, every request for it misses at the same moment and they all hit the database together.",
  figures: [
    {
      tone: "problem",
      title: "A hot item expires",
      caption:
        "Nine in ten requests are for the same item. Each time its copy expires, a crowd of misses rushes the database and everyone waits.",
      metrics: [M.p95(), M.load(["db"], "Database reads"), M.queue(["db"], "Database queue")],
      build: () => stampedeScene(false),
    },
    {
      tone: "fix",
      title: "One fetch, everyone else waits for it",
      caption:
        "With request coalescing, the first miss fetches the item and the others wait beside the cache for that one answer.",
      knobs: [choice("co", "Misses for the same item", ["All go to the database", "Share one fetch"], 1)],
      metrics: [M.p95(), M.load(["db"], "Database reads"), M.queue(["db"], "Database queue")],
      build: (v) => stampedeScene(v.co === 1),
      compare: { label: "no coalescing", build: () => stampedeScene(false) },
    },
  ],
  takeaways: {
    use: "Use it for very popular keys, expensive queries, and anything that expires on a fixed schedule.",
    catch: "Waiting requests all depend on that single fetch. Give it a timeout, or serve the old copy while refreshing early.",
    seen: "Go's singleflight, Varnish request coalescing, CDN origin shielding.",
  },
};

export const cachingLessons = [caching, cdn, stale, stampede];
