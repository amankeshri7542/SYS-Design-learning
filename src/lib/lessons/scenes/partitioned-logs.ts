import { armedCrash, balancer, choice, fault, queue, scene, users, worker } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec } from "../../sim/types";

// A7: 60 events a second from 126 accounts, each consumer handling about 40 a second. One partition with one consumer
// falls behind. Three consumers sharing one log keep up, but an account's later event can finish before an earlier one.
// Three partitions, chosen by account, each read by one consumer at a time, keep up and keep each account in order;
// when a consumer crashes, its partition moves to the next one in the group (its unacked event is handed out again).

const CRASH = "Consumer 2 crashes";
const BACK = "Consumer 2 restarts";
const crash2 = fault("crash-c2", "Crash consumer 2", "Restart consumer 2", CRASH, BACK, (s) => s.nodes.get("c2")?.up === false);
const CONSUMERS = ["c1", "c2", "c3"];

// 126 accounts, some much busier than others (skew 1): the fewest the hash spreads over three partitions without
// leaving one nearly empty, and busy enough that an account often has two events in flight at once.
const producer = (skew: number) => users("u", [8, 50], { rate: 60, keys: 126, skew }, "q", { label: "Events" });
const consumer = (id: string, i: number) => worker(id, [90, 20 + 30 * i], { label: `Consumer ${i + 1}`, slots: 1, serviceMs: 20 });
// Every log sits beside its consumers (3 ms), so a consumer is busy only while it works.
const near = (logs: string[]) => Object.fromEntries(logs.flatMap((l) => CONSUMERS.map((c) => [`${l}>${c}`, 3])));
const opts = { windowMs: 2000, seed: 27, script: armedCrash("c2", 1200, 1500, CRASH, BACK), links: near(["q", "p1", "p2", "p3"]) };

/** One partition, one consumer. */
const single = () => scene([producer(1), queue("q", [48, 50], ["c1"], { label: "Log" }), consumer("c1", 1)], opts);

/** One log, three consumers taking turns. */
const shared = () => scene([producer(1), queue("q", [48, 50], CONSUMERS, { label: "Log" }), ...CONSUMERS.map(consumer)], opts);

/** Three partitions by account; each is read by its own consumer, one event at a time, and by the next if it fails. */
const partitioned = (skew: number) => {
  const parts: NodeSpec[] = CONSUMERS.map((_, i) =>
    // Its own consumer first, then the next in the group: the one that takes over if it fails.
    queue(`p${i + 1}`, [58, 20 + 30 * i], [CONSUMERS[i], CONSUMERS[(i + 1) % 3]], {
      label: `Partition ${i + 1}`,
      consumers: "first",
      ack: { mode: "finish", visibilityMs: 400, ordered: true },
    }),
  );
  return scene(
    [{ ...producer(skew), to: ["router"] }, balancer("router", [30, 50], ["p1", "p2", "p3"], { label: "By account", algo: "hash" }), ...parts, ...CONSUMERS.map(consumer)],
    opts,
  );
};

const lag = { id: "queue" as const, label: "Waiting", nodes: ["q", "p1", "p2", "p3"], hint: "Events waiting in the log to be read, right now." };
const doneIn: MetricSpec = { id: "jobWait", label: "Event handled within", hint: "95% of events are handled within this time of arriving." };
const disorder: MetricSpec = { id: "reordered", label: "Out of order", hint: "Events handled before an earlier event for the same account, in the window." };
const metrics: MetricSpec[] = [doneIn, lag, disorder];

const partitions: LessonScene = {
  hook: "How do you read a log faster without mixing up each account's events?",
  dots: ["req", "ok", "job", "ack"],
  figures: [
    {
      tone: "problem",
      short: "One reader",
      title: "One log, one consumer",
      caption: "60 events a second from 126 accounts go into one log, read by one consumer, one event at a time.",
      metrics,
      parts: [
        { node: "u", text: "Events: 60 a second, from 126 accounts." },
        { node: "q", text: "Log: keeps events in the order they came." },
        { node: "c1", text: "Consumer: one at a time, about 40 a second.", sockets: true },
      ],
      beats: [
        { id: "order", when: { at: 300 }, text: "Watch Consumer read events in order, one at a time: about 40 a second.", focus: { nodes: ["c1"] } },
        {
          id: "lag",
          when: { metric: lag, is: ">", value: 20 },
          text: "60 arrive, 40 leave: the line grows. That's [[consumer-lag|consumer lag]].",
          focus: { nodes: ["q"], dots: "waiting" },
          term: "consumer-lag",
        },
        { id: "rising", when: { wait: 0 }, text: "Read Event handled within: {jobWait}, and climbing every second.", focus: { metric: "Event handled within" } },
      ],
      predict: {
        prompt: "Next, three consumers share the same log. An account's events will be handled…",
        options: ["Still in order", "Sometimes out of order"],
        answer: 1,
        before: "end",
        reveal: { beat: "mixed", text: "Out of order: {before} with one consumer, {after} with three sharing the log." },
        track: { metric: disorder, world: 0, afterWorld: 1, same: true },
        holds: (_, after) => after !== null && after > 0,
      },
      build: () => single(),
    },
    {
      tone: "fix",
      short: "Three readers",
      title: "Three consumers, one log",
      caption: "Three consumers take turns reading the same log, so three events are handled at once.",
      actions: [crash2],
      metrics,
      beats: [
        { id: "fast", when: { step: "enter" }, text: "Now three consumers share the log: 120 a second, and the line clears.", focus: { nodes: CONSUMERS } },
        { id: "mixed", when: { metric: disorder, is: ">", value: 0 }, text: "But an account's later event can finish first: {reordered} out of order.", focus: { metric: "Out of order" } },
        { id: "matters", when: { wait: 0 }, text: "Fine for counting page views; wrong for a bank balance.", focus: { metric: "Out of order" } },
      ],
      build: () => shared(),
    },
    {
      tone: "fix",
      short: "Partitions",
      title: "Split by account, one reader each",
      caption: "A router sends each account's events to one of three logs, always the same one. Each log has one reader at a time.",
      actions: [crash2],
      knobs: [choice("skew", "Accounts", ["Typical", "One very busy"], 0)],
      metrics,
      beats: [
        {
          id: "split",
          when: { step: "enter" },
          text: "Now an account always lands in one [[partition]], read by one consumer: in order.",
          focus: { nodes: ["p1", "p2", "p3"] },
          term: "partition",
        },
        { id: "both", when: { wait: 0 }, text: "Compare: {reordered:3} out of order, and events handled within {jobWait:3}.", focus: { metric: "Out of order" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash consumer 2.", focus: { action: "crash-c2" }, pause: true },
        {
          id: "rebalance",
          when: { note: CRASH },
          text: "Partition 2 moves to Consumer 3, still one reader at a time: a [[consumer-group|consumer group]].",
          focus: { nodes: ["p2", "c3"] },
          term: "consumer-group",
        },
        { id: "hot", when: { wait: 600 }, text: "Switch Accounts to One very busy: its partition lags while the others idle.", focus: { knob: "skew" } },
      ],
      break: { action: "crash-c2", beat: "press" },
      headline: { metric: "Event handled within", sentence: "60 events a second: handled within {jobWait:1} by one consumer, {jobWait:3} by three partitions, {reordered:3} out of order." },
      build: (v: Values) => partitioned(v.skew ? 1.8 : 1),
    },
  ],
  checks: [
    {
      prompt: "Why does each account go to the same partition every time?",
      options: ["So one consumer handles its events in order", "To spread accounts evenly"],
      answer: 0,
      why: "Order is kept only within a partition. Same account, same partition, same reader, so its events stay in order.",
      focus: { nodes: ["p1", "p2", "p3"] },
    },
    {
      prompt: "One account sends most of the events. What happens?",
      options: ["Its partition lags behind the others", "The load spreads evenly anyway"],
      answer: 0,
      why: "All of a key's events share one partition, so a hot key can't be spread out. Its partition becomes the bottleneck.",
      focus: { knob: "skew" },
    },
  ],
  takeaways: {
    use: "Streams that need both speed and per-key order: partition by key, with one consumer per partition in a group.",
    catch: "Order holds only within a partition, and a hot key overloads its partition. You can't have more busy readers than partitions.",
    seen: "Kafka partitions and consumer groups, Kinesis shards, Pulsar key-shared subscriptions.",
    rule: "Order per key, not overall.",
    interview: "Say: “Partition by the key that needs ordering; one consumer per partition; plan for hot keys.”",
  },
};

export default partitions;
