import { armedCrash, fault, knob, ms, queue, scene, users, worker } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// N14: orders go into a queue that hands each job to one of two workers (2 at a time each, 500 ms a job). Acked on
// receipt, the queue forgets a job as soon as a worker takes it: crash worker 2 mid-job and the jobs it held are never
// done. Acked when done, a job no one acks within the visibility timeout is handed out again; a timeout shorter than a
// slow job hands it out twice, so the job is done twice unless the workers ignore repeats.

const CRASH = "Worker 2 crashes mid-job";
const BACK = "Worker 2 restarts";
const crash2 = fault("crash-w2", "Crash worker 2 mid-job", "Restart worker 2", CRASH, BACK, (s) => s.nodes.get("w2")?.up === false);

const jobs = (mode: "receive" | "finish", visibilityMs: number) =>
  scene(
    [
      users("u", [8, 50], { rate: 6, keys: 50 }, "q", { label: "Orders" }),
      queue("q", [42, 50], ["w1", "w2"], { ack: { mode, visibilityMs } }),
      worker("w1", [80, 26], { label: "Worker 1", slots: 2, serviceMs: 500, idempotent: false }),
      worker("w2", [80, 74], { label: "Worker 2", slots: 2, serviceMs: 500, idempotent: false }),
    ],
    { windowMs: 3000, seed: 22, script: armedCrash("w2", 1500, 800, CRASH, BACK) },
  );

const lost: MetricSpec = { id: "lostJobs", label: "Jobs lost", hint: "Jobs a worker took and then died with, never done, in the window." };
const twice: MetricSpec = { id: "duplicates", label: "Jobs done twice", hint: "Jobs a worker did a second time, in the window." };
const again: MetricSpec = { id: "redelivered", label: "Handed out again", hint: "Jobs the queue handed out again because no ack came in time." };
const doneIn: MetricSpec = { id: "jobWait", label: "Job done within", hint: "95% of jobs are done within this time of being queued." };
const metrics = [lost, twice, again, doneIn];

const guarantees: LessonScene = {
  hook: "A worker dies halfway through a job. Did the job happen?",
  dots: ["req", "ok", "job", "ack"],
  figures: [
    {
      tone: "problem",
      short: "Ack on receipt",
      title: "Ack it, then do it",
      caption: "Each worker acks a job the moment it takes it. The queue then forgets the job.",
      actions: [crash2],
      metrics,
      parts: [
        { node: "u", text: "Orders: 6 jobs a second into Queue." },
        { node: "q", text: "Queue: hands each job to a worker." },
        { node: ["w1", "w2"], text: "Workers: 2 jobs at a time, 500 ms each.", sockets: true },
      ],
      beats: [
        { id: "take", when: { at: 300 }, text: "Watch a worker take a job and ack it at once, before doing any of it.", focus: { nodes: ["w1", "w2"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash worker 2 mid-job.", focus: { action: "crash-w2" }, pause: true },
        { id: "dies", when: { note: CRASH }, text: "Worker 2 dies holding jobs it already acked. Queue has forgotten them.", focus: { nodes: ["w2"] } },
        {
          id: "count",
          when: { metric: lost, is: ">", value: 0 },
          text: "Count Jobs lost: {lostJobs}. Each job ran [[at-most-once|at most once]]: maybe never.",
          focus: { metric: "Jobs lost" },
          term: "at-most-once",
        },
      ],
      predict: {
        prompt: "Worker 2 crashes holding two jobs it has acked. Those jobs will…",
        options: ["Go to Worker 1", "Never be done"],
        answer: 1,
        before: "press",
        reveal: { beat: "count", text: "Jobs lost: {before} before the crash, {after} after it." },
        track: { metric: lost },
        holds: (_, after) => after !== null && after >= 1,
      },
      break: { action: "crash-w2", beat: "press" },
      build: () => jobs("receive", 1200),
    },
    {
      tone: "fix",
      short: "Ack when done",
      title: "Do it, then ack it",
      caption: "Workers ack a job only once it's done. A job not acked within 1.2 s is handed out again.",
      actions: [crash2],
      knobs: [knob("visibility", "Visibility timeout", 200, 2000, 100, 1200, ms)],
      metrics,
      beats: [
        {
          id: "later",
          when: { step: "enter" },
          text: "Now jobs are acked when done. Unacked for 1.2 s, one reappears: a [[visibility-timeout|visibility timeout]].",
          focus: { nodes: ["q"] },
          term: "visibility-timeout",
        },
        {
          id: "compare",
          when: { wait: 0 },
          text: "Compare Jobs lost: {lostJobs:fix} here. Every job runs [[at-least-once|at least once]].",
          focus: { metric: "Jobs lost" },
          term: "at-least-once",
        },
        { id: "twice", when: { wait: 600 }, text: "Drag Visibility timeout to 400 ms: slow jobs are handed out, and done, twice.", focus: { knob: "visibility" } },
        {
          id: "exactly",
          when: { wait: 0 },
          text: "So [[exactly-once|exactly once]] is at least once, plus workers that ignore repeats.",
          focus: { metric: "Jobs done twice" },
          term: "exactly-once",
        },
      ],
      headline: { metric: "Jobs lost", sentence: "Worker 2 crashed mid-job: {lostJobs:problem} jobs lost acking on receipt, {lostJobs:fix} acking when done.", at: "count" },
      build: (v: Values) => jobs("finish", v.visibility),
    },
  ],
  checks: [
    {
      prompt: "A worker acks a job, then crashes before doing it. Which guarantee is that?",
      options: ["At most once", "At least once"],
      answer: 0,
      why: "The queue forgot the job at the ack, so it runs once or not at all.",
      focus: { metric: "Jobs lost" },
    },
    {
      prompt: "With acks after the work, why can a job run twice?",
      options: ["Its ack came late, after it was handed out again", "The queue copies every job"],
      answer: 0,
      why: "If the work outlasts the visibility timeout, the job reappears and another worker does it too.",
      focus: { knob: "visibility" },
    },
  ],
  takeaways: {
    use: "Background jobs that must happen: ack after the work, set a visibility timeout longer than the work, and make workers idempotent.",
    catch: "At least once means sometimes twice. Without idempotent workers, a slow job charges, emails or ships twice.",
    seen: "Amazon SQS visibility timeouts, RabbitMQ manual acks, Kafka offsets committed after processing.",
    rule: "Ack after, and expect repeats.",
    interview: "Say: “Ack after processing with a visibility timeout, and make consumers idempotent: that's effectively exactly once.”",
  },
};

export default guarantees;
