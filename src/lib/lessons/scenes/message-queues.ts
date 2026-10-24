import { M, bursts, knob, lane, range, scene, server, users, worker } from "../kit";
import type { LessonScene, Values } from "../types";

// A burst every 2.4 s, the first one 1.4 s in: just after the parts have been introduced.
const burstEvery = bursts(6, 40, 2400, 500);
const bursty = { rate: (t: number) => burstEvery(t + 1000), keys: 50 };

const inline = () =>
  scene([
    users("u", [8, 50], bursty, "app"),
    server("app", [62, 50], { slots: 4, serviceMs: 250, queueMax: 6, label: "Sends the email itself" }),
  ]);

const appQueue = M.queue(["app"], "Waiting at the server");
const jobWait = { id: "jobWait" as const, label: "Email sent within", target: 2000, hint: "95% of email jobs finish within this time." };

const queues: LessonScene = {
  hook: "Why should a new sign-up wait for its welcome email to be sent?",
  dots: ["req", "late", "ok", "failed", "job"],
  figures: [
    {
      tone: "problem",
      short: "Inline",
      title: "Doing slow work while the user waits",
      caption: "Sign-ups arrive in bursts. Each one sends a slow welcome email before answering.",
      metrics: [M.p95(), M.errors(), M.busy(["app"])],
      parts: [
        { node: "u", text: "Users: 6 sign-ups a second, with bursts of 40." },
        { node: "app", text: "Server: 4 workers, each sending an email (250 ms).", sockets: true },
      ],
      beats: [
        { id: "slow", when: { at: 200 }, text: "Each sign-up holds a worker for the whole 250 ms email.", focus: { nodes: ["app"], sockets: true } },
        {
          id: "burst",
          when: { metric: appQueue, is: ">", value: 5 },
          text: "A burst arrives. The line in front of the server fills fast.",
          focus: { nodes: ["app"], dots: "waiting" },
          pause: true,
        },
        { id: "full", when: { fx: "drop", node: "app" }, text: "The line holds 6. Once it's full, new sign-ups fail: red diamonds.", focus: { nodes: ["app"], dots: "failed" } },
      ],
      predict: {
        prompt: "We hand each email to a queue and answer at once. During a burst, sign-ups will…",
        options: ["still fail", "answer fast", "wait even longer"],
        answer: 1,
        before: "end",
        reveal: { beat: "fast", text: "The slowest 1 in 20: {before} sending the email first, {after} with a queue." },
        track: { metric: M.p95(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.5 * before,
      },
      build: inline,
    },
    {
      tone: "fix",
      short: "Queue",
      title: "Put the job on a queue, answer at once",
      caption: "The app puts each email job on a queue and replies at once. Workers send the emails.",
      knobs: [knob("n", "Workers", 1, 6, 1, 4)],
      metrics: [M.p95(), M.errors(), M.queue(["q"], "Jobs waiting"), jobWait],
      parts: [
        { node: "api", text: "App: queues the job and answers at once." },
        { node: "q", text: "Email queue: holds jobs until a worker is free." },
        { node: ["w1", "w2", "w3", "w4"], text: "Workers: 4, each sending one email at a time." },
      ],
      beats: [
        { id: "fast", when: { wait: 0 }, text: "Sign-ups now answer in {p95:fix}: nobody waits for the email.", focus: { metric: "Response time" } },
        {
          id: "jobs",
          when: { metric: M.queue(["q"]), is: ">", value: 5 },
          text: "A burst lands on the queue as small squares: jobs.",
          focus: { nodes: ["q"] },
          pause: true,
        },
        { id: "backlog", when: { wait: 0 }, text: "Workers drain it at their own pace. The waiting jobs are a [[backlog]].", focus: { nodes: ["q"] }, term: "backlog" },
        { id: "later", when: { wait: 0 }, text: "The cost: an email may take {jobWait:fix} to go out.", focus: { metric: "Email sent within" } },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Workers to 1: the backlog grows faster than it drains.", focus: { knob: "n" } }],
      headline: {
        metric: "Response time",
        sentence: "Same bursts. Sending the email first, the slowest 1 in 20 waited {p95:problem}. With a queue: {p95:fix}.",
      },
      build: (v: Values) =>
        scene(
          [
            users("u", [8, 50], bursty, "api"),
            server("api", [32, 50], { slots: 6, serviceMs: 15, to: ["q"] }),
            { id: "q", kind: "queue", label: "Email queue", at: [60, 50], capacity: 300, to: range(v.n).map((i) => `w${i + 1}`) },
            ...range(v.n).map((i) => worker(`w${i + 1}`, [92, lane(v.n, i)], { serviceMs: 250, label: `Worker ${i + 1}` })),
          ],
          { wideH: v.n > 4 ? 520 : 460 },
        ),
    },
  ],
  checks: [
    {
      prompt: "With a queue, who waits for the email to be sent?",
      options: ["The user", "Nobody: a worker sends it later", "The database"],
      answer: 1,
      why: "The app answers once the job is queued; a worker sends the email afterwards.",
      focus: { nodes: ["q"] },
    },
    {
      prompt: "The workers can never catch up. What happens?",
      options: ["The queue empties", "The backlog grows without end", "Sign-ups fail at once"],
      answer: 1,
      why: "Jobs arrive faster than they are done, so the line only grows. Watch the backlog, and add workers.",
      focus: { nodes: ["q"] },
    },
  ],
  takeaways: {
    use: "Use one for emails, image processing, payments to reconcile: anything the user doesn't need to watch finish.",
    catch: "The work now happens later, so failures need retries and a place to land. And the queue can grow without bound if the workers never catch up.",
    seen: "Amazon SQS, RabbitMQ, Sidekiq, Celery, and Kafka consumer groups.",
    rule: "Answer now; do the slow work later.",
  },
};

export default queues;
