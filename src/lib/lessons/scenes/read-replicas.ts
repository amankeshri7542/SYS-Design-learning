import { M, database, knob, ms, range, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

const readHeavy = { rate: 50, keys: 30, skew: 0.8, writes: 0.1 };

const oneDb = () =>
  scene([
    users("u", [6, 50], readHeavy, "app"),
    server("app", [34, 50], { slots: 12, serviceMs: 15, to: ["primary"] }),
    database("primary", [70, 50], { slots: 3, serviceMs: 80, queueMax: 40, label: "Database" }),
  ]);

const dbBusy = M.busy(["primary"], "Database busy");
const staleD1 = M.stale();

const replicas: LessonScene = {
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

export default replicas;
