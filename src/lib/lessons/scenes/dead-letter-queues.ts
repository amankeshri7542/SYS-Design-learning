import { M, knob, queue, scene, users, worker } from "../kit";
import type { Action, LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// A5: an ordered queue hands out one job at a time and waits for its ack. The break slips in a poison job: the worker
// fails it every time, so no ack comes, and after the visibility timeout the queue hands it out again, forever, while
// every job behind it waits. With a limit of 3 tries the queue moves the job to a dead-letter queue and the line moves.

const POISON = "A poison job arrives";

/** The break: one poison job, the same in every world. The button stays on while it is in the line or out with Worker. */
const inject: Action = {
  id: "poison",
  label: "Inject a poison job",
  undo: "Wait for it to clear",
  run: (sim, on) => {
    if (on) sim.fire(POISON);
  },
  isOn: (sim) => {
    const q = sim.nodes.get("q");
    return !!q && (q.queue.some((j) => j.poison) || [...q.inflight.values()].some((e) => e.job.poison));
  },
};

/** `tries`: how many times a job may be handed out (0: no limit). */
const line = (tries: number): SceneSpec =>
  scene(
    [
      users("u", [8, 40], { rate: 8, keys: 50 }, "q", { label: "Orders" }),
      queue("q", [44, 40], ["w"], { ack: { mode: "finish", visibilityMs: 300, ordered: true, maxDeliveries: tries || undefined, deadLetter: tries ? "dlq" : undefined } }),
      worker("w", [84, 40], { label: "Worker", slots: 1, serviceMs: 60 }),
      ...(tries ? [queue("dlq", [84, 84], [], { label: "Dead letters" })] : []),
    ],
    {
      // Worker sits beside its queue: each job is a short hop out and an ack back, so the line keeps up until poisoned.
      links: { "q>w": 5 },
      windowMs: 2000,
      seed: 25,
      script: {
        loopMs: 60_000,
        events: [
          {
            at: 1200,
            label: POISON,
            armed: true,
            node: "u",
            run: (s) => {
              const u = s.nodes.get("u");
              if (u) s.spawn(u, 0, "write", s.t, 0, 1, { poison: true });
            },
          },
        ],
      },
    },
  );

const waiting = M.queue(["q"], "In line");
const again: MetricSpec = { id: "redelivered", label: "Handed out again", hint: "Jobs handed out again because no ack came in time, in the window." };
const dead: MetricSpec = { id: "deadLettered", label: "Dead-lettered", hint: "Jobs given up on and moved to the dead-letter queue, in the window." };
const doneIn: MetricSpec = { id: "jobWait", label: "Job done within", hint: "95% of jobs are done within this time of arriving." };
const metrics = [waiting, doneIn, again, dead];

const deadLetters: LessonScene = {
  hook: "One job always fails. Why does every job behind it stop?",
  dots: ["req", "ok", "job", "ack", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Retry forever",
      title: "One bad job holds the line",
      caption: "The queue hands out one job at a time, in order, and hands a job out again until it's acked.",
      actions: [inject],
      metrics,
      parts: [
        { node: "u", text: "Orders: 8 jobs a second into Queue." },
        { node: "q", text: "Queue: one job out at a time, in order." },
        { node: "w", text: "Worker: 60 ms a job, acks when done.", sockets: true },
      ],
      beats: [
        { id: "order", when: { at: 300 }, text: "Watch Queue hand out one job, wait for its ack, then hand out the next.", focus: { nodes: ["q"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Inject a poison job.", focus: { action: "poison" }, pause: true },
        {
          id: "fails",
          when: { fx: "redeliver", node: "q" },
          text: "Worker fails it, no ack comes, and Queue hands it out again: a [[poison-message|poison message]].",
          focus: { nodes: ["q", "w"] },
          term: "poison-message",
        },
        { id: "stuck", when: { metric: waiting, is: ">", value: 20 }, text: "Count the line behind it: {queue:q} jobs waiting, and growing.", focus: { nodes: ["q"], dots: "waiting" } },
      ],
      predict: {
        prompt: "One job that always fails reaches the front of the line. The jobs behind it will…",
        options: ["Go around it", "Wait behind it, for good"],
        answer: 1,
        before: "press",
        reveal: { beat: "stuck", text: "In line: {before} before the poison job, {after} behind it." },
        track: { metric: waiting },
        holds: (_, after) => after !== null && after > 15,
      },
      break: { action: "poison", beat: "press" },
      build: () => line(0),
    },
    {
      tone: "fix",
      short: "Dead letters",
      title: "Three tries, then set it aside",
      caption: "After 3 tries, Queue sets a job aside in a queue of its own, where it waits for someone to look at it.",
      actions: [inject],
      knobs: [knob("tries", "Tries", 1, 6, 1, 3)],
      metrics,
      beats: [
        {
          id: "dlq",
          when: { step: "enter" },
          text: "Now three failed tries send a job to a [[dead-letter-queue|dead-letter queue]].",
          focus: { nodes: ["dlq"] },
          term: "dead-letter-queue",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare In line: {queue:q:fix} here, {queue:q:problem} stuck behind the poison job.", focus: { metric: "In line" } },
        { id: "aside", when: { wait: 0 }, text: "The poison job waits in Dead letters, out of the way, for a person to inspect.", focus: { nodes: ["dlq"] } },
        { id: "more", when: { wait: 600 }, text: "Drag Tries to 6: each poison job holds the line longer before it's set aside.", focus: { knob: "tries" } },
      ],
      headline: { metric: "In line", sentence: "After one poison job: {queue:q:problem} jobs stuck in line retrying forever, {queue:q:fix} with a dead-letter queue.", at: "stuck" },
      build: (v: Values) => line(v.tries),
    },
  ],
  checks: [
    {
      prompt: "Why does one failing job stop an ordered queue?",
      options: ["Each job waits for the one before it", "The worker crashes"],
      answer: 0,
      why: "In order means one at a time. A job that never succeeds is handed out again and again, and nothing behind it moves.",
      focus: { nodes: ["q"] },
    },
    {
      prompt: "What should happen to jobs in the dead-letter queue?",
      options: ["Someone inspects them, fixes the cause, and replays them", "They're deleted automatically"],
      answer: 0,
      why: "They're evidence of a bug or bad data. Alert on them, fix the cause, then send them back through.",
      focus: { nodes: ["dlq"] },
    },
  ],
  takeaways: {
    use: "Every queue with retries: cap the tries, move what still fails to a dead-letter queue, and alert on it.",
    catch: "A dead-letter queue nobody watches is just a slower way to lose work.",
    seen: "Amazon SQS redrive policies, RabbitMQ dead-letter exchanges, Kafka retry and DLQ topics.",
    rule: "Cap the tries, set the rest aside.",
  },
};

export default deadLetters;
