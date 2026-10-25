import { M, balancer, database, knob, lane, range, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

const writeHeavy = (hot: number) => ({ rate: 45, keys: 300, skew: 0.2, writes: 0.8, hot });

const oneWriter = (v: Values) =>
  scene([
    users("u", [6, 50], writeHeavy(v.hot ?? 0), "app"),
    server("app", [30, 50], { slots: 12, serviceMs: 10, to: ["db"] }),
    database("db", [88, 50], { slots: 3, serviceMs: 90, queueMax: 40 }),
  ]);

const busiestShard = M.peak(["d1", "d2", "d3", "d4"], "Busiest shard");

const sharding: LessonScene = {
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

export default sharding;
