import type { Algo } from "../sim/types";
import { M, armed, balancer, cache, database, fault, knob, lane, ms, range, scene, server, users } from "./kit";
import type { Action, Lesson, Values } from "./types";

const readHeavy = { rate: 50, keys: 30, skew: 0.8, writes: 0.1 };

const oneDb = () =>
  scene([
    users("u", [6, 50], readHeavy, "app"),
    server("app", [34, 50], { slots: 12, serviceMs: 15, to: ["primary"] }),
    database("primary", [70, 50], { slots: 3, serviceMs: 80, queueMax: 40, label: "Database" }),
  ]);

const dbBusy = M.busy(["primary"], "Database busy");
const staleD1 = M.stale();

const replicas: Lesson = {
  slug: "read-replicas",
  code: "D1",
  line: "data",
  title: "Read replicas",
  why: "Most apps read far more than they write. Copy the database to replicas and spread the reads across them, accepting that the copies lag slightly behind.",
  level: "intermediate",
  minutes: 6,
  hook: "Nine in ten requests only read. Why does one database still drown?",
  dots: ["req", "late", "ok", "stale", "copy"],
  figures: [
    {
      tone: "problem",
      short: "One database",
      title: "One database does everything",
      caption: "Nine reads for every write, all on one database that manages about 37 a second.",
      metrics: [M.p95(), dbBusy, M.errors()],
      parts: [
        { node: "u", text: "Users: 50 a second, 9 reads to every write." },
        { node: "app", text: "App server: 12 workers, 15 ms each." },
        { node: "primary", text: "Database: about 37 a second (3 workers, 80 ms).", sockets: true },
      ],
      beats: [
        { id: "full", when: { at: 200 }, text: "Watch Database: every read and every write waits for its 3 workers.", focus: { nodes: ["primary"], sockets: true } },
        {
          id: "line",
          when: { metric: M.queue(["primary"]), is: ">", value: 5 },
          text: "Its line keeps growing: 50 arrive, about 37 can be served.",
          focus: { nodes: ["primary"], dots: "waiting" },
          pause: true,
        },
        { id: "slow", when: { metric: M.p95(), is: ">", value: 400 }, text: "The slowest 1 in 20 takes {p95:problem}, target 400 ms.", focus: { metric: "Response time" } },
      ],
      predict: {
        prompt: "We copy the database twice and send reads to the copies. Some reads will now…",
        options: ["be faster and always current", "be faster but sometimes out of date", "be slower"],
        answer: 1,
        before: "end",
        reveal: { beat: "stale", text: "{after} of reads were out of date: the copy hadn't landed yet." },
        track: { metric: staleD1, world: 1 },
        holds: (_, after) => after !== null && after > 0,
      },
      build: oneDb,
    },
    {
      tone: "fix",
      short: "Replicas",
      title: "Writes to one, reads from its copies",
      caption: "Each write is copied to the other databases a moment later. Reads go to the copies.",
      knobs: [
        knob("n", "Replicas", 1, 3, 1, 2),
        knob("lag", "Copy delay", 20, 800, 20, 150, ms),
      ],
      metrics: [M.p95(), staleD1, M.busy(["primary"], "Primary busy")],
      parts: [
        { node: "primary", text: "Primary: takes every write." },
        { node: ["r1", "r2"], text: "[[replica|Replicas]]: copies that answer the reads." },
      ],
      beats: [
        {
          id: "copy",
          when: { wait: 0 },
          text: "A write lands on Primary; a small square copy then travels to each replica.",
          focus: { nodes: ["primary"], link: ["primary", "r1"] },
        },
        { id: "behind", when: { wait: 0 }, text: "A violet rule under a replica: a copy is still on its way.", focus: { nodes: ["r1"] } },
        {
          id: "stale",
          when: { metric: staleD1, is: ">", value: 0 },
          text: "A read that beats the copy gets old data: [[replication-lag|replication lag]].",
          focus: { dots: "stale" },
          pause: true,
          term: "replication-lag",
        },
        { id: "relief", when: { wait: 0 }, text: "Primary busy: {util:primary:fix}. The slowest 1 in 20: {p95:fix}.", focus: { metric: "Primary busy" } },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Copy delay up to 800 ms and watch stale reads climb.", focus: { knob: "lag" } }],
      headline: {
        metric: "Response time",
        sentence: "Same traffic. The slowest 1 in 20 waits {p95:fix} with replicas, {p95:problem} on one database; {stale:fix} of reads were stale.",
      },
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
  checks: [
    {
      prompt: "Why can a read from a replica be stale?",
      options: ["Replicas are slower", "The write's copy hadn't arrived yet", "The primary lost it"],
      answer: 1,
      why: "Copies travel after the write lands; a read that gets there first sees the old value.",
      focus: { nodes: ["r1"] },
    },
    {
      prompt: "Replicas help most when…",
      options: ["reads far outnumber writes", "writes outnumber reads", "the data never changes"],
      answer: 0,
      why: "Every replica still applies every write; only the reads are spread out.",
      focus: { nodes: ["primary"] },
    },
  ],
  takeaways: {
    use: "Use them when reads dominate and slightly old data is acceptable for most screens.",
    catch: "Replication lag. A user can save something and then not see it. Send their own reads to the primary for a moment.",
    seen: "PostgreSQL and MySQL replicas, Amazon Aurora readers, MongoDB secondaries.",
    rule: "Spread the reads; accept a little lag.",
  },
};

const writeHeavy = (hot: number) => ({ rate: 45, keys: 300, skew: 0.2, writes: 0.8, hot });

const oneWriter = (v: Values) =>
  scene([
    users("u", [6, 50], writeHeavy(v.hot ?? 0), "app"),
    server("app", [30, 50], { slots: 12, serviceMs: 10, to: ["db"] }),
    database("db", [88, 50], { slots: 3, serviceMs: 90, queueMax: 40 }),
  ]);

const busiestShard = M.peak(["d1", "d2", "d3", "d4"], "Busiest shard");

const sharding: Lesson = {
  slug: "sharding",
  code: "D2",
  line: "data",
  title: "Sharding",
  why: "When writes outgrow one machine, split the data by key so that each database owns only a slice of it.",
  level: "intermediate",
  minutes: 6,
  hook: "Copies help with reads. What do you do when the writes alone are too many?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "One database",
      title: "Every write lands on one database",
      caption: "45 requests a second, mostly writes, on one database that can do about 33.",
      metrics: [M.p95(), M.busy(["db"], "Database busy"), M.errors()],
      parts: [
        { node: "u", text: "Users: 45 a second, 8 in 10 are writes." },
        { node: "app", text: "App server: 12 workers, 10 ms each." },
        { node: "db", text: "Database: about 33 a second (3 workers, 90 ms).", sockets: true },
      ],
      beats: [
        { id: "writes", when: { at: 200 }, text: "Watch Database: every write must land here.", focus: { nodes: ["db"] } },
        {
          id: "line",
          when: { metric: M.queue(["db"]), is: ">", value: 5 },
          text: "Its line keeps growing. Copies wouldn't help: each would take every write too.",
          focus: { nodes: ["db"], dots: "waiting" },
          pause: true,
        },
        { id: "slow", when: { metric: M.p95(), is: ">", value: 400 }, text: "The slowest 1 in 20 takes {p95:problem}, target 400 ms.", focus: { metric: "Response time" } },
      ],
      predict: {
        prompt: "We split the keys over 3 databases, each owning a third. The slowest 1 in 20 will…",
        options: ["stay over the target", "drop under the 400 ms target", "fail outright"],
        answer: 1,
        before: "end",
        reveal: { beat: "busy", text: "The slowest 1 in 20 now: {after}, against a 400 ms target." },
        track: { metric: M.p95(), world: 1 },
        holds: (_, after) => after !== null && after < 400,
      },
      build: () => oneWriter({ hot: 0 }),
    },
    {
      tone: "fix",
      short: "Shards",
      title: "Split the keys across databases",
      caption: "A router hashes each key to pick a database, so each takes a slice of the writes.",
      knobs: [
        knob("n", "Shards", 2, 4, 1, 3),
        knob("hot", "Celebrity traffic", 0, 0.6, 0.1, 0, (v) => `${Math.round(v * 100)}%`),
      ],
      metrics: [M.p95(), busiestShard, M.errors()],
      parts: [
        { node: "router", text: "Router: hashes each key to choose a database." },
        { node: ["d1", "d2", "d3"], text: "Three databases, each owning a third of the keys." },
      ],
      beats: [
        { id: "shard", when: { wait: 0 }, text: "Each database now owns a slice of the keys: a [[shard]].", focus: { nodes: ["d1", "d2", "d3"] }, term: "shard" },
        { id: "route", when: { wait: 0 }, text: "The router sends a key to the same shard every time.", focus: { nodes: ["router"] } },
        { id: "busy", when: { wait: 0 }, text: "Busiest shard: {peak:fix}. The slowest 1 in 20: {p95:fix}.", focus: { metric: "Busiest shard" } },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Celebrity traffic up: one key's shard fills while the others idle.", focus: { knob: "hot" } }],
      headline: { metric: "Response time", sentence: "Same writes. One database: the slowest 1 in 20 took {p95:problem}. Three shards: {p95:fix}." },
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
  checks: [
    {
      prompt: "Why couldn't replicas fix this?",
      options: ["Replicas are slow", "Every replica must apply every write", "Replicas can't be added"],
      answer: 1,
      why: "Replicas copy everything, so the writes still pile up on each. Shards split them.",
      focus: { nodes: ["router"] },
    },
    {
      prompt: "One key gets 60% of all traffic. Sharding…",
      options: ["spreads it evenly", "can't split one key: its shard melts", "removes it"],
      answer: 1,
      why: "A key always lives on one shard, so a celebrity key overloads that shard alone.",
      focus: { nodes: ["d1"] },
    },
  ],
  takeaways: {
    use: "Use it when the write volume or data size is beyond what one machine can do, even a big one.",
    catch: "Queries across shards are hard, hot keys still melt one shard, and re-sharding later is painful.",
    seen: "DynamoDB and Cassandra partitions, Vitess, MongoDB sharded clusters.",
    rule: "Split the data, and the writes split too.",
  },
};

const SLOTS = 4;
const JOIN = "Cache 4 joins";
const LEAVE = "Cache 4 leaves";
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
        // Armed: the learner adds cache 4; it leaves again 1.4 s later.
        script: armed(
          { node: "router", at: 1800, lastsMs: 1400, start: JOIN, end: LEAVE },
          { start: (s) => s.reconfigure(build({ ...v, extra: 1 })), end: (s) => s.reconfigure(build({ ...v, extra: 0 })) },
        ),
      },
    );
  };
  return build;
};

const join = fault("join", "Add cache 4", "Remove cache 4", JOIN, LEAVE, (s) => s.nodes.has("c4"));
const movedMetric = { id: "moved" as const, label: "Keys that moved", nodes: ["router"], hint: "Share of keys whose owner changed at the last membership change." };
const hitsD3 = M.hit(["c1", "c2", "c3", "c4"]);
const dbBusyD3 = M.busy(["db"], "Database busy");

const consistent: Lesson = {
  slug: "consistent-hashing",
  code: "D3",
  line: "data",
  title: "Consistent hashing",
  why: "Spread keys over N caches with hash % N, and adding one cache moves almost every key. Consistent hashing moves only the keys it has to.",
  level: "intermediate",
  minutes: 7,
  hook: "You add one more cache server to help. Why does the database get hit harder?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "hash % N",
      title: "hash(key) % N",
      caption: "Three caches share 150 keys. A router picks each key's cache with hash(key) % N, N being the number of caches.",
      actions: [join],
      metrics: [hitsD3, dbBusyD3, movedMetric],
      parts: [
        { node: "u", text: "Users: 50 reads a second over 150 keys." },
        { node: "router", text: "Router: picks a key's cache by hash % N." },
        { node: ["c1", "c2", "c3"], text: "Caches: up to 50 copies each." },
        { node: "db", text: "Database: 4 workers, 60 ms each." },
      ],
      beats: [
        { id: "warm", when: { metric: hitsD3, is: ">", value: 0.5 }, text: "The caches are warm: most reads hit.", focus: { nodes: ["c1", "c2", "c3"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Add cache 4.", focus: { action: "join" }, pause: true },
        { id: "remap", when: { note: JOIN }, text: "N went from 3 to 4. About 3 in 4 keys now map to another cache.", focus: { nodes: ["router"] }, pause: true },
        {
          id: "misses",
          when: { metric: hitsD3, is: "<", value: 0.4, forMs: 200 },
          text: "Their copies are in the wrong caches: misses. Database busy: {util:db:problem}.",
          focus: { nodes: ["db"] },
        },
        { id: "leave", when: { note: LEAVE }, text: "Cache 4 leaves: N changes again, and keys move again.", focus: { nodes: ["router"] } },
      ],
      predict: {
        prompt: "One more cache joins to share the work. The share of reads that hit a cache will…",
        options: ["rise right away", "drop for a while", "stay the same"],
        answer: 1,
        before: "press",
        reveal: { beat: "misses", text: "Hits fell from {before} to {after}." },
        track: { metric: hitsD3 },
        holds: (before, after) => before !== null && after !== null && after < before - 0.1,
      },
      break: { action: "join", beat: "press" },
      build: hashing("hash"),
    },
    {
      tone: "fix",
      short: "Hash ring",
      title: "A hash ring",
      caption: "Caches and keys sit on a ring. Each key belongs to the next cache clockwise.",
      actions: [join],
      metrics: [hitsD3, dbBusyD3, movedMetric],
      parts: [{ node: "router", text: "Ring: 64 points per cache; keys go clockwise." }],
      beats: [
        { id: "press2", when: { wait: 0 }, text: "Press ⚡ Add cache 4: same change, both worlds.", focus: { action: "join" }, pause: true },
        { id: "few", when: { note: JOIN }, text: "Cache 4 takes only the keys just before its points. Few keys move.", focus: { nodes: ["router"] }, pause: true },
        {
          id: "name",
          when: { wait: 0 },
          text: "Moving only the keys you must: [[consistent-hashing|consistent hashing]].",
          focus: { metric: "Keys that moved" },
          term: "consistent-hashing",
        },
        { id: "compare", when: { wait: 0 }, text: "Keys that moved: {moved:fix} here, {moved:problem} with hash % N.", focus: { metric: "Keys that moved" } },
      ],
      break: { action: "join", beat: "press2" },
      headline: {
        metric: "Cache hits",
        sentence: "Same new cache. hash % N moved {moved:problem} of keys and hits fell; the ring moved {moved:fix}.",
        at: "compare",
      },
      build: hashing("ring"),
    },
  ],
  checks: [
    {
      prompt: "Why do most keys move with hash % N?",
      options: ["Caches are slow", "Changing N changes almost every key's remainder", "The keys change"],
      answer: 1,
      why: "hash % 3 and hash % 4 agree for only about a quarter of keys, so the rest find a new cache.",
      focus: { nodes: ["router"] },
    },
    {
      prompt: "On a ring, a new cache takes keys from…",
      options: ["every cache equally", "only its neighbours on the ring", "the database"],
      answer: 1,
      why: "Each key goes clockwise to the next point; only keys just before the new points change owner.",
      focus: { nodes: ["router"] },
    },
  ],
  takeaways: {
    use: "Use it when the set of cache or storage nodes changes while the system runs.",
    catch: "You need virtual nodes for an even spread, and it still doesn't fix a single hot key.",
    seen: "Cassandra and DynamoDB partitioning, Memcached clients, Envoy's ring-hash balancer.",
    rule: "Add a node, move only its keys.",
  },
};

const CUT = "The link between regions breaks";
const REPAIR = "The link is repaired";

const capScene = (mode: "cp" | "ap") =>
  scene(
    [
      users("us", [10, 20], { rate: 14, keys: 8, writes: 0.4, tag: "us" }, "dbUS", { label: "US users" }),
      users("eu", [10, 80], { rate: 14, keys: 8, writes: 0.4, tag: "eu" }, "dbEU", { label: "EU users" }),
      database("dbUS", [74, 20], {
        // In the consistent world its role shows as a LEADER badge (the follower's `leader` points here).
        label: "US database",
        slots: 4,
        serviceMs: 40,
        region: "us",
        peer: "dbEU",
        lagMs: 90,
      }),
      database("dbEU", [74, 80], {
        label: "EU database",
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
      // Armed: the learner cuts the link; it is repaired 1.9 s later.
      script: armed({ node: "dbEU", at: 1500, lastsMs: 1900, start: CUT, end: REPAIR }, { start: (s) => s.setPartition(true), end: (s) => s.setPartition(false) }),
    },
  );

const cut: Action = fault("cut", "Cut the network", "Repair the network", CUT, REPAIR, (s) => s.partitioned);

const answered = { id: "answered" as const, label: "EU requests answered", tag: "eu", hint: "Share of EU requests that got a real answer." };
const euStale = M.stale({ tag: "eu", label: "EU stale reads" });
const conflicts = { id: "conflicts" as const, label: "Conflicting writes", hint: "Keys written on both sides during a split." };

const cap: Lesson = {
  slug: "consistency-vs-availability",
  code: "D4",
  line: "data",
  title: "Consistency vs availability",
  why: "When the network splits two copies of your data apart, each side has to choose: refuse requests, or answer with data that might be old.",
  level: "advanced",
  minutes: 8,
  hook: "The ocean cable is cut. Should Europe refuse requests, or answer with old data?",
  dots: ["req", "late", "ok", "stale", "failed", "copy"],
  figures: [
    {
      tone: "tradeoff",
      short: "Consistent",
      title: "Choose consistency: refuse when unsure",
      caption: "The EU copy forwards every request to the US copy, so answers are always current.",
      actions: [cut],
      metrics: [answered, M.p95({ tag: "eu", label: "EU response time" }), euStale],
      parts: [
        { node: ["us", "eu"], text: "US and EU users: 14 a second each." },
        { node: "dbUS", text: "US database: every read and write lands here." },
        { node: "dbEU", text: "EU database: forwards everything across the Atlantic." },
      ],
      beats: [
        { id: "forward", when: { at: 200 }, text: "Watch an EU request cross the Atlantic to the US database and back.", focus: { link: ["dbUS", "dbEU"] } },
        { id: "roles", when: { wait: 0 }, text: "The US copy decides: the [[leader]]. The EU copy only forwards.", focus: { nodes: ["dbUS", "dbEU"] }, term: "leader" },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Cut the network.", focus: { action: "cut" }, pause: true },
        {
          id: "refuse",
          when: { note: CUT },
          text: "Cut off, the EU copy refuses rather than answer from old data.",
          focus: { nodes: ["dbEU"], dots: "failed" },
          pause: true,
        },
        { id: "answered", when: { metric: answered, is: "<", value: 0.6 }, text: "EU requests answered: {answered:eu}. Every answer given is current.", focus: { metric: "EU requests answered" } },
      ],
      predict: {
        prompt: "The cable is cut. If Europe keeps answering on its own, some answers will…",
        options: ["be refused", "be out of date", "be lost"],
        answer: 1,
        before: "press",
        reveal: { beat: "stale", text: "{after} of EU reads were stale during the cut." },
        track: { metric: euStale, world: 1 },
        holds: (_, after) => after !== null && after > 0,
      },
      break: { action: "cut", beat: "press" },
      build: () => capScene("cp"),
    },
    {
      tone: "tradeoff",
      short: "Available",
      title: "Choose availability: answer anyway",
      caption: "Each region reads and writes locally, and copies its writes across in the background.",
      actions: [cut],
      metrics: [answered, euStale, conflicts],
      beats: [
        { id: "local", when: { step: "enter" }, text: "Each region now answers on its own and copies writes across later.", focus: { nodes: ["dbEU", "dbUS"] } },
        {
          id: "same",
          // The cut hit both worlds when it was pressed, and is still on.
          when: { note: CUT, since: "lesson" },
          text: "Same cut, same moment: Europe is cut off here too.",
          focus: { link: ["dbUS", "dbEU"] },
        },
        {
          id: "stale",
          when: { metric: euStale, is: ">", value: 0 },
          text: "Europe still answers, but a violet donut is an out-of-date answer.",
          focus: { dots: "stale" },
          pause: true,
        },
        { id: "conflict", when: { note: REPAIR }, text: "Repaired. Keys written on both sides now conflict: {conflicts:2}.", focus: { metric: "Conflicting writes" } },
      ],
      headline: {
        metric: "EU requests answered",
        sentence: "Same cut. Consistent: {answered:eu:1} of EU requests answered, all current. Available: {answered:eu:2} answered, {stale:eu:2} stale.",
        at: "stale",
      },
      build: () => capScene("ap"),
    },
  ],
  checks: [
    {
      prompt: "During the cut, the consistent side chose to…",
      options: ["answer from its own copy", "refuse rather than risk old data", "wait for the cable"],
      answer: 1,
      why: "It can't reach the leader, so it can't be sure its copy is current; it refuses instead.",
      focus: { nodes: ["dbEU"] },
    },
    {
      prompt: "Which should stay available during a split?",
      options: ["Bank balances", "A social feed", "Seat bookings"],
      answer: 1,
      why: "A feed can show something slightly old; money and seats need one correct answer.",
      focus: { nodes: ["dbEU"] },
    },
  ],
  takeaways: {
    use: "Choose consistency for money, inventory and anything with a single correct answer. Choose availability for feeds, carts and likes.",
    catch: "Even with a healthy network, consistency costs speed: every EU request crossed the ocean.",
    seen: "Spanner and etcd lean consistent. Cassandra, DynamoDB global tables and DNS lean available.",
    rule: "Cut off, refuse or risk old data.",
    interview: "During a partition I'd choose per feature: consistency for money and inventory, availability for feeds and carts.",
  },
};

export const dataLessons = [replicas, sharding, consistent, cap];
