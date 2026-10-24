import { M, armedCrash, database, fault, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { SceneSpec } from "../../sim/types";

// D8: a coordinator keeps three copies of every value. Each write goes to all three replicas, which store it 10, 120 and
// 250 ms later; it is answered once W of them have. Each read asks R replicas in turn and answers with the freshest
// copy. With W = 1 and R = 1 a read often asks a replica the latest write hasn't reached: stale. With W + R > 3 every read
// set overlaps every write set, so a read always finds the latest write, and one replica can die without stopping either.

const CRASH = "Replica 3 crashes";
const BACK = "Replica 3 is back";
const crash3 = fault("crash-r3", "Crash replica 3", "Restore replica 3", CRASH, BACK, (s) => s.nodes.get("r3")?.up === false);
const REPLICAS = ["r1", "r2", "r3"];

const store = (w: number, r: number): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 60, keys: 8, writes: 0.5 }, "co", { label: "Users" }),
      server("co", [36, 50], { label: "Coordinator", slots: 32, serviceMs: 2, blocking: true, quorum: { replicas: REPLICAS, w, r }, callTimeoutMs: 1200 }),
      ...REPLICAS.map((id, i) => database(id, [82, 16 + 34 * i], { label: `Replica ${i + 1}`, slots: 8, serviceMs: 4, lagMs: [10, 120, 250][i] })),
    ],
    { links: { "co>r1": 8, "co>r2": 8, "co>r3": 8 }, windowMs: 2000, seed: 59, script: armedCrash("r3", 2200, 3000, CRASH, BACK) },
  );

const stale = M.stale({ hint: "Share of reads that missed a write already confirmed to its user." });
const writeTime = M.p95({ op: "write", label: "Write time", hint: "95% of writes are confirmed faster than this (the p95)." });
const metrics = [stale, writeTime, M.errors()];

const quorums: LessonScene = {
  hook: "With three copies, how many must agree before you answer?",
  dots: ["req", "ok", "stale", "copy", "failed"],
  figures: [
    {
      tone: "problem",
      short: "One and one",
      title: "Write one, read one",
      caption: "Three replicas store each write 10, 120 and 250 ms after it is sent. A write waits for one; a read asks one.",
      metrics,
      parts: [
        { node: "u", text: "Users: 60 a second, half of them writes." },
        { node: "co", text: "Coordinator: every write to all three replicas." },
        { node: REPLICAS, text: "Replicas: store each copy 10, 120, 250 ms later." },
      ],
      beats: [
        { id: "copies", when: { at: 300 }, text: "Watch each write leave as three copies, landing at different times.", focus: { nodes: REPLICAS } },
        {
          id: "w1",
          when: { wait: 0 },
          text: "It's answered once one replica has it: a write [[quorum]] of one.",
          focus: { nodes: ["co"] },
          term: "quorum",
        },
        { id: "stale", when: { metric: stale, is: ">", value: 0.05 }, text: "Read Stale reads: {stale}. A read asked a replica the write hadn't reached.", focus: { metric: "Stale reads" } },
      ],
      predict: {
        prompt: "Next, writes wait for two replicas and reads ask two. Stale reads will…",
        options: ["Drop to zero", "Fall a little"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Stale reads: {before} with one and one, {after} with two and two." },
        track: { metric: stale, world: 0, afterWorld: 1, same: true },
        holds: (_, after) => after !== null && after === 0,
      },
      build: () => store(1, 1),
    },
    {
      tone: "fix",
      short: "Two and two",
      title: "Write two, read two",
      caption: "The same replicas. A write waits for two of them, and a read asks two and keeps the fresher copy.",
      actions: [crash3],
      knobs: [knob("w", "Write waits for", 1, 3, 1, 2), knob("r", "Read asks", 1, 3, 1, 2)],
      metrics,
      beats: [
        { id: "overlap", when: { step: "enter" }, text: "Now W = 2, R = 2: every read set overlaps every write set.", focus: { nodes: REPLICAS } },
        { id: "compare", when: { metric: stale, is: "<", value: 0.01 }, text: "Compare Stale reads: {stale:fix} here, {stale:problem} with one and one.", focus: { metric: "Stale reads" } },
        { id: "cost", when: { wait: 0 }, text: "The cost: Write time {p95:fix}, waiting for the second copy.", focus: { metric: "Write time" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash replica 3.", focus: { action: "crash-r3" }, pause: true },
        { id: "survive", when: { note: CRASH }, text: "Two replicas are still enough for both: nothing fails. Try Write waits for 3.", focus: { nodes: ["r1", "r2"] } },
      ],
      break: { action: "crash-r3", beat: "press" },
      headline: { metric: "Stale reads", sentence: "Replicas 10–250 ms apart: {stale:problem} of reads stale writing one and reading one, {stale:fix} with two and two." },
      build: (v: Values) => store(v.w, v.r),
    },
  ],
  checks: [
    {
      prompt: "Why does W + R > N guarantee a read sees the latest write?",
      options: ["Every read set shares at least one replica with every write set", "Replicas copy faster"],
      answer: 0,
      why: "Two of three written and two of three read can't miss each other: one replica is in both, and it has the write.",
      focus: { nodes: REPLICAS },
    },
    {
      prompt: "W = 3 makes every read fresh with R = 1. What does it cost?",
      options: ["Any one replica down stops all writes", "Nothing"],
      answer: 0,
      why: "Waiting for every replica means waiting for the slowest, and failing whenever one is down.",
      focus: { knob: "w" },
    },
  ],
  takeaways: {
    use: "Replicated stores that must choose per request between speed and freshness: tune W and R against N.",
    catch: "W + R > N costs latency (the slower copies) and availability (more replicas must be up); sloppy quorums weaken it.",
    seen: "Cassandra and ScyllaDB consistency levels, DynamoDB, Riak, etcd and ZooKeeper majorities.",
    rule: "Write and read quorums must overlap.",
    interview: "Say: “With N replicas, W + R > N gives read-your-writes; W = R = majority survives one failure in three.”",
  },
};

export default quorums;
