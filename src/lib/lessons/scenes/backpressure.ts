import { M, armed, choice, queue, scene, users, worker } from "../kit";
import type { Action, LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// N15: a producer sends 30 jobs a second; the consumer handles 40 (2 workers, 50 ms each) until the break slows it to
// about 16. With no limit the queue grows by 14 a second until it runs out of memory and loses every job in it. Bounded
// at 20, a full queue makes the producer's sends wait (back-pressure), or turns new jobs away, or drops the oldest.

const SLOW = "The consumer slows down";
const FAST = "The consumer catches up";
const POLICIES = ["Producer waits", "Turn new away", "Drop oldest"];
const MODES = ["wait", "reject", "drop-oldest"] as const;

/** `policy`: an index into POLICIES, or -1 for no limit at all. */
const flow = (policy: number, slow = false): SceneSpec => {
  const limit: Partial<NodeSpec> =
    policy < 0 ? { overload: { queueAbove: 60, forMs: 300, restartMs: 400, warmMs: 1 } } : { backpressure: { high: 20, low: 12, mode: MODES[policy] } };
  return scene(
    [
      users("u", [10, 50], { rate: 30, keys: 50, timeoutMs: 3000 }, "q", { label: "Producer" }),
      queue("q", [48, 50], ["w"], limit),
      worker("w", [86, 50], { label: "Consumer", slots: 2, serviceMs: slow ? 120 : 50 }),
    ],
    {
      windowMs: 2000,
      seed: 23,
      script: armed({ node: "w", at: 1200, lastsMs: 4000, start: SLOW, end: FAST }, { start: (s) => s.reconfigure(flow(policy, true)), end: (s) => s.reconfigure(flow(policy)) }),
    },
  );
};

const slowDown: Action = {
  id: "slow",
  label: "Slow the consumer",
  undo: "Speed it up again",
  run: (sim, on) => void sim.fire(on ? SLOW : FAST),
  isOn: (sim) => (sim.nodes.get("w")?.spec.serviceMs ?? 0) > 100,
};

const lost: MetricSpec = { id: "lostJobs", label: "Jobs lost", hint: "Jobs accepted and then lost, in the window." };
const doneIn: MetricSpec = { id: "jobWait", label: "Job done within", hint: "95% of delivered jobs are done within this time of being sent." };
const producerWait = M.p95({ label: "Producer wait", hint: "95% of the producer's sends are accepted within this time." });
const metrics = [lost, doneIn, M.queue(["q"], "In the queue"), producerWait];

const backpressure: LessonScene = {
  hook: "What should happen when a consumer can't keep up with its producer?",
  dots: ["req", "late", "ok", "job"],
  figures: [
    {
      tone: "problem",
      short: "No limit",
      title: "An unbounded queue",
      caption: "The queue takes every job it's sent, as fast as the producer sends them, with no limit.",
      actions: [slowDown],
      metrics,
      parts: [
        { node: "u", text: "Producer: 30 jobs a second." },
        { node: "q", text: "Queue: holds every job, however many." },
        { node: "w", text: "Consumer: 2 workers, 40 jobs a second.", sockets: true },
      ],
      beats: [
        { id: "keeps", when: { at: 300 }, text: "Watch the consumer keep up: 40 a second against 30. The line stays short.", focus: { nodes: ["q"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Slow the consumer.", focus: { action: "slow" }, pause: true },
        { id: "grows", when: { metric: M.queue(["q"]), is: ">", value: 30 }, text: "Now it does 16 a second. The line grows by 14 every second.", focus: { nodes: ["q"], dots: "waiting" } },
        { id: "crash", when: { fx: "crash", node: "q" }, text: "Queue runs out of memory and crashes. Every job in it is lost.", focus: { nodes: ["q"] } },
        { id: "count", when: { wait: 0 }, text: "Count Jobs lost: {lostJobs}. The producer never knew it was sending too fast.", focus: { metric: "Jobs lost" } },
      ],
      predict: {
        prompt: "The consumer slows to 16 a second; the producer keeps sending 30. The queue will…",
        options: ["Settle at a longer line", "Grow until something breaks"],
        answer: 1,
        before: "press",
        reveal: { beat: "count", text: "Jobs lost: {before} before, {after} when the queue gave out." },
        track: { metric: lost },
        holds: (_, after) => after !== null && after > 10,
      },
      break: { action: "slow", beat: "press" },
      build: () => flow(-1),
    },
    {
      tone: "fix",
      short: "Bounded",
      title: "Bounded, and pushing back",
      caption: "The queue holds 20. Once full, the producer's sends wait for room. You choose what full means.",
      actions: [slowDown],
      knobs: [choice("policy", "When full", POLICIES, 0)],
      metrics,
      beats: [
        {
          id: "bound",
          when: { step: "enter" },
          text: "Now a full queue makes the producer wait for room: [[backpressure|back-pressure]].",
          focus: { nodes: ["q"] },
          term: "backpressure",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Jobs lost: {lostJobs:fix} here, {lostJobs:problem} with no limit.", focus: { metric: "Jobs lost" } },
        { id: "cost", when: { wait: 0 }, text: "The cost moves to the producer: its sends wait, so it slows to the consumer's pace.", focus: { metric: "Producer wait" } },
        { id: "drop", when: { wait: 600 }, text: "Switch When full to Drop oldest: no waiting, but jobs are lost.", focus: { knob: "policy" } },
      ],
      headline: { metric: "Jobs lost", sentence: "Consumer slowed: {lostJobs:problem} jobs lost with no limit, {lostJobs:fix} with back-pressure.", at: "count" },
      build: (v: Values) => flow(v.policy),
    },
  ],
  checks: [
    {
      prompt: "A consumer does 20 jobs a second and its producer sends 30. With no limit, the queue…",
      options: ["Settles at a longer line", "Grows by 10 a second until it breaks"],
      answer: 1,
      why: "Every second, 10 more arrive than leave. Nothing stops the line, until memory runs out.",
      focus: { nodes: ["q"] },
    },
    {
      prompt: "What does back-pressure do when the queue is full?",
      options: ["Drops jobs quietly", "Makes the producer slow down"],
      answer: 1,
      why: "The producer has to wait for room, so it sends at the pace the consumer can manage, and nothing is lost.",
      focus: { metric: "Producer wait" },
    },
  ],
  takeaways: {
    use: "Every queue between a fast producer and a slower consumer: bound it, and decide what a full queue does.",
    catch: "Waiting moves the slowness upstream, so the producer needs its own limits. Dropping keeps things fast but loses work.",
    seen: "TCP flow control, Reactive Streams, Kafka producer buffers, bounded channels in Go.",
    rule: "Bound every queue.",
    interview: "Say: “Every queue gets a bound, and when it's full we push back on producers instead of buffering forever.”",
  },
};

export default backpressure;
