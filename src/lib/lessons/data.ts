import type { Sim } from "../sim/engine";
import type { Algo } from "../sim/types";
import { M, balancer, cache, database, knob, lane, ms, range, scene, server, users } from "./kit";
import type { Action, Lesson, Values } from "./types";

const readHeavy = { rate: 50, keys: 30, skew: 0.8, writes: 0.1 };

const oneDb = () =>
  scene([
    users("u", [6, 50], readHeavy, "app"),
    server("app", [34, 50], { slots: 12, serviceMs: 15, to: ["primary"] }),
    database("primary", [70, 50], { slots: 3, serviceMs: 80, queueMax: 40, label: "Database" }),
  ]);

const replicas: Lesson = {
  slug: "read-replicas",
  code: "D1",
  line: "data",
  title: "Read replicas",
  why: "Most apps read far more than they write. Copy the database to replicas and spread the reads across them, accepting that the copies lag slightly behind.",
  figures: [
    {
      tone: "problem",
      short: "One database",
      title: "One database does everything",
      caption: "Nine reads for every write, all hitting one machine that can manage about 37 a second. It's always full.",
      metrics: [M.p95(), M.busy(["primary"], "Database busy"), M.errors()],
      build: oneDb,
    },
    {
      tone: "fix",
      short: "Replicas",
      title: "Writes to the primary, reads from replicas",
      caption:
        "Each write is copied to the replicas a little later (small dots on the dashed lines). A read that reaches a replica before the copy arrives gets stale data.",
      knobs: [
        knob("n", "Replicas", 1, 3, 1, 2),
        knob("lag", "Copy delay", 20, 800, 20, 150, ms),
      ],
      metrics: [M.p95(), M.stale(), M.busy(["primary"], "Primary busy")],
      build: (v: Values) => {
        const ids = range(v.n).map((i) => `r${i + 1}`);
        return scene(
          [
            users("u", [6, 50], readHeavy, "app"),
            server("app", [34, 50], { slots: 12, serviceMs: 15, calls: { read: [ids], write: ["primary"] } }),
            database("primary", [70, 14], { slots: 3, serviceMs: 80, queueMax: 40, label: "Primary" }),
            ...ids.map((id, i) =>
              database(id, [94, v.n === 1 ? 70 : 42 + (48 * i) / (v.n - 1)], {
                slots: 3,
                serviceMs: 80,
                queueMax: 40,
                replicaOf: "primary",
                lagMs: v.lag,
                label: `Replica ${i + 1}`,
              }),
            ),
          ],
          { wideH: 480 },
        );
      },
    },
  ],
  takeaways: {
    use: "Use them when reads dominate and slightly old data is acceptable for most screens.",
    catch: "Replication lag. A user can save something and then not see it. Send their own reads to the primary for a moment.",
    seen: "PostgreSQL and MySQL replicas, Amazon Aurora readers, MongoDB secondaries.",
  },
};

const writeHeavy = (hot: number) => ({ rate: 45, keys: 300, skew: 0.2, writes: 0.8, hot });

const oneWriter = (v: Values) =>
  scene([
    users("u", [6, 50], writeHeavy(v.hot ?? 0), "app"),
    server("app", [30, 50], { slots: 12, serviceMs: 10, to: ["db"] }),
    database("db", [88, 50], { slots: 3, serviceMs: 90, queueMax: 40 }),
  ]);

const sharding: Lesson = {
  slug: "sharding",
  code: "D2",
  line: "data",
  title: "Sharding",
  why: "When writes outgrow one machine, split the data by key so that each database owns only a slice of it.",
  figures: [
    {
      tone: "problem",
      short: "One database",
      title: "Every write lands on one database",
      caption: "Replicas can't help here: every copy still has to apply every write. The single primary is saturated.",
      metrics: [M.p95(), M.busy(["db"], "Database busy"), M.errors()],
      build: () => oneWriter({ hot: 0 }),
    },
    {
      tone: "fix",
      short: "Shards",
      title: "Split keys across shards",
      caption:
        "A router hashes each key to choose its shard, so each one handles a fraction of the writes. Then add a celebrity: one key that's suddenly very popular.",
      knobs: [
        knob("n", "Shards", 2, 4, 1, 3),
        knob("hot", "Celebrity traffic", 0, 0.6, 0.1, 0, (v) => `${Math.round(v * 100)}%`),
      ],
      metrics: [M.p95(), M.peak(["d1", "d2", "d3", "d4"], "Busiest shard"), M.errors()],
      build: (v) => {
        const ids = range(v.n).map((i) => `d${i + 1}`);
        return scene(
          [
            users("u", [6, 50], writeHeavy(v.hot), "app"),
            server("app", [30, 50], { slots: 12, serviceMs: 10, to: ["router"] }),
            balancer("router", [58, 50], ids, { algo: "hash", glyph: "router", label: "Shard router" }),
            ...ids.map((id, i) => database(id, [90, lane(v.n, i)], { slots: 3, serviceMs: 90, queueMax: 40, label: `Shard ${i + 1}` })),
          ],
          { wideH: 480 },
        );
      },
    },
  ],
  takeaways: {
    use: "Use it when the write volume or data size is beyond what one machine can do, even a big one.",
    catch: "Queries across shards are hard, hot keys still melt one shard, and re-sharding later is painful.",
    seen: "DynamoDB and Cassandra partitions, Vitess, MongoDB sharded clusters.",
  },
};

const SLOTS = 4;
const hashing = (algo: Algo) => {
  const build = (v: Values): ReturnType<typeof scene> => {
    const n = 3 + (v.extra ?? 0);
    const ids = range(n).map((i) => `c${i + 1}`);
    return scene(
      [
        users("u", [6, 50], { rate: 50, keys: 150, skew: 0.5 }, "router"),
        balancer("router", [30, 50], ids, {
          algo,
          glyph: "router",
          label: algo === "ring" ? "Hash ring" : "hash % N",
        }),
        ...ids.map((id, i) =>
          cache(id, [62, lane(SLOTS, i)], "db", { capacity: 50, label: `Cache ${i + 1}` }),
        ),
        database("db", [92, 50], { slots: 4, serviceMs: 60, queueMax: 60 }),
      ],
      {
        wideH: 500,
        warmMs: 1400,
        script: {
          loopMs: 4200,
          events: [
            { at: 1800, label: "Cache 4 joins the cluster", run: (s: Sim) => s.reconfigure(build({ ...v, extra: 1 })) },
            { at: 3200, label: "Cache 4 leaves", run: (s: Sim) => s.reconfigure(build({ ...v, extra: 0 })) },
          ],
        },
      },
    );
  };
  return build;
};

const movedMetric = { id: "moved" as const, label: "Keys that moved", nodes: ["router"], hint: "Share of keys whose owner changed at the last membership change." };

const consistent: Lesson = {
  slug: "consistent-hashing",
  code: "D3",
  line: "data",
  title: "Consistent hashing",
  why: "Spread keys over N caches with hash % N, and adding one cache moves almost every key. Consistent hashing moves only the keys it has to.",
  figures: [
    {
      tone: "problem",
      short: "hash % N",
      title: "hash(key) % N",
      caption:
        "Watch for a fourth cache joining, and later leaving. N changes, so about three out of four keys now map to a different cache. Hits collapse and the database takes the load.",
      metrics: [M.hit(["c1", "c2", "c3", "c4"]), M.busy(["db"], "Database busy"), movedMetric],
      build: hashing("hash"),
    },
    {
      tone: "fix",
      short: "Hash ring",
      title: "A hash ring",
      caption:
        "Caches and keys are placed around a ring, and each key belongs to the next cache clockwise. A newcomer takes over only the keys next to its own points.",
      metrics: [M.hit(["c1", "c2", "c3", "c4"]), M.busy(["db"], "Database busy"), movedMetric],
      build: hashing("ring"),
    },
  ],
  takeaways: {
    use: "Use it when the set of cache or storage nodes changes while the system runs.",
    catch: "You need virtual nodes for an even spread, and it still doesn't fix a single hot key.",
    seen: "Cassandra and DynamoDB partitioning, Memcached clients, Envoy's ring-hash balancer.",
  },
};

const capScene = (mode: "cp" | "ap") =>
  scene(
    [
      users("us", [10, 20], { rate: 14, keys: 8, writes: 0.4, tag: "us" }, "dbUS", { label: "US users" }),
      users("eu", [10, 80], { rate: 14, keys: 8, writes: 0.4, tag: "eu" }, "dbEU", { label: "EU users" }),
      database("dbUS", [74, 20], {
        label: mode === "cp" ? "US database · leader" : "US database",
        slots: 4,
        serviceMs: 40,
        region: "us",
        peer: "dbEU",
        lagMs: 90,
      }),
      database("dbEU", [74, 80], {
        label: mode === "cp" ? "EU database · follower" : "EU database",
        slots: 4,
        serviceMs: 40,
        region: "eu",
        leader: mode === "cp" ? "dbUS" : undefined,
        peer: mode === "ap" ? "dbUS" : undefined,
        lagMs: 90,
      }),
    ],
    {
      sloMs: 300,
      links: { "dbUS>dbEU": 90 },
      linkLabels: { "dbUS>dbEU": "across the Atlantic" },
      wideH: 460,
      script: {
        loopMs: 5200,
        events: [
          { at: 1500, label: "The link between regions breaks", run: (s: Sim) => s.setPartition(true) },
          { at: 3400, label: "The link is repaired", run: (s: Sim) => s.setPartition(false) },
        ],
      },
    },
  );

const cut: Action = {
  id: "cut",
  label: "Cut the network",
  undo: "Repair the network",
  run: (s, on) => s.setPartition(on),
  isOn: (s) => s.partitioned,
};

const answered = { id: "answered" as const, label: "EU requests answered", tag: "eu", hint: "Share of EU requests that got a real answer." };

const cap: Lesson = {
  slug: "consistency-vs-availability",
  code: "D4",
  line: "data",
  title: "Consistency vs availability",
  why: "When the network splits two copies of your data apart, each side has to choose: refuse requests, or answer with data that might be old.",
  figures: [
    {
      tone: "tradeoff",
      short: "Consistent",
      title: "Choose consistency: refuse when unsure",
      caption:
        "The EU copy forwards everything to the US leader, so answers are always current. When the link breaks, EU users get errors instead of possibly wrong data.",
      actions: [cut],
      metrics: [answered, M.p95({ tag: "eu", label: "EU response time" }), M.stale({ tag: "eu", label: "EU stale reads" })],
      build: () => capScene("cp"),
    },
    {
      tone: "tradeoff",
      short: "Available",
      title: "Choose availability: answer anyway",
      caption:
        "Each region reads and writes locally and syncs in the background. During the split, EU users still get answers, but some are stale. Writes made on both sides conflict when the link comes back.",
      actions: [cut],
      metrics: [answered, M.stale({ tag: "eu", label: "EU stale reads" }), { id: "conflicts", label: "Conflicting writes", hint: "Keys written on both sides during a split." }],
      build: () => capScene("ap"),
    },
  ],
  takeaways: {
    use: "Choose consistency for money, inventory and anything with a single correct answer. Choose availability for feeds, carts and likes.",
    catch: "Even with a healthy network, consistency costs speed: every EU request crossed the ocean.",
    seen: "Spanner and etcd lean consistent. Cassandra, DynamoDB global tables and DNS lean available.",
  },
};

export const dataLessons = [replicas, sharding, consistent, cap];
