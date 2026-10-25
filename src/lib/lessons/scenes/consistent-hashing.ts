import type { Algo } from "../../sim/types";
import { M, armed, balancer, cache, database, fault, lane, range, scene, users } from "../kit";
import type { LessonScene, Values } from "../types";

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

const consistent: LessonScene = {
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

export default consistent;
