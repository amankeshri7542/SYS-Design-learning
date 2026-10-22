import type { Sim } from "../sim/engine";
import type { NodeSpec } from "../sim/types";
import { outage } from "./foundations";
import { M, bursts, choice, crash, knob, lane, range, scene, server, users, worker } from "./kit";
import type { Action, Lesson, Values } from "./types";

const bursty = { rate: bursts(6, 40, 2400, 500), keys: 50 };

const inline = () =>
  scene([
    users("u", [8, 50], bursty, "app"),
    server("app", [62, 50], { slots: 4, serviceMs: 250, queueMax: 10, label: "Sends the email itself" }),
  ]);

const queues: Lesson = {
  slug: "message-queues",
  code: "A1",
  line: "async",
  title: "Message queues",
  why: "Some work doesn't need to finish while the user waits. A queue accepts it instantly and lets workers catch up at their own pace.",
  figures: [
    {
      tone: "problem",
      short: "Inline",
      title: "Doing slow work while the user waits",
      caption:
        "Sign-ups arrive in bursts, and each one sends a slow welcome email before answering. During a burst the server's waiting line overflows and sign-ups fail.",
      metrics: [M.p95(), M.errors(), M.busy(["app"])],
      build: inline,
    },
    {
      tone: "fix",
      short: "Queue",
      title: "Put the job on a queue, answer at once",
      caption:
        "The app drops each email job on a queue (the small squares) and replies right away. Workers drain the queue at a steady pace, so a burst just makes the line longer for a while.",
      knobs: [knob("n", "Workers", 1, 6, 1, 4)],
      metrics: [M.p95(), M.errors(), M.queue(["q"], "Jobs waiting"), { id: "jobWait", label: "Email sent within", hint: "95% of email jobs finish within this time." }],
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
  takeaways: {
    use: "Use one for emails, image processing, payments to reconcile: anything the user doesn't need to watch finish.",
    catch: "The work now happens later, so failures need retries and a place to land. And the queue can grow without bound if the workers never catch up.",
    seen: "Amazon SQS, RabbitMQ, Sidekiq, Celery, and Kafka consumer groups.",
  },
};

const subs = [
  { id: "email", label: "Email", ms: 60, at: 16 },
  { id: "stock", label: "Inventory", ms: 40, at: 50 },
  { id: "stats", label: "Analytics", ms: 120, at: 84 },
];

const direct = () =>
  scene(
    [
      users("u", [6, 50], { rate: 10, keys: 50 }, "orders"),
      server("orders", [36, 50], { slots: 8, serviceMs: 30, label: "Order service", to: subs.map((s) => s.id) }),
      ...subs.map((s) => server(s.id, [86, s.at], { slots: 3, serviceMs: s.ms, queueMax: 20, label: s.label })),
    ],
    { script: outage("stats", "Analytics", 1400, 2900, 4200), wideH: 460 },
  );

const pubsub: Lesson = {
  slug: "publish-subscribe",
  code: "A2",
  line: "async",
  title: "Publish / subscribe",
  why: "When one event matters to many services, calling each in turn makes the user wait for all of them, and fail if any one fails.",
  figures: [
    {
      tone: "problem",
      short: "Direct calls",
      title: "The order service calls everyone",
      caption:
        "Each order calls email, then inventory, then analytics, one after another. The user waits for the sum of all three. When analytics crashes, orders fail too.",
      actions: [crash("stats", "analytics")],
      metrics: [M.p95(), M.errors()],
      build: direct,
    },
    {
      tone: "fix",
      short: "Pub/sub",
      title: "Publish one event and let subscribers listen",
      caption:
        "The order service publishes “order placed” once and answers. Each subscriber gets its own copy. If analytics is down, its copies pile up and wait. Orders don't notice.",
      actions: [crash("stats", "analytics")],
      metrics: [M.p95(), M.errors(), M.queue(["stats"], "Analytics backlog")],
      build: () =>
        scene(
          [
            users("u", [6, 50], { rate: 10, keys: 50 }, "orders"),
            server("orders", [32, 50], { slots: 8, serviceMs: 30, label: "Order service", to: ["topic"] }),
            { id: "topic", kind: "topic", label: "“Order placed”", at: [58, 50], to: subs.map((s) => s.id) } satisfies NodeSpec,
            ...subs.map((s) => worker(s.id, [88, s.at], { slots: 3, serviceMs: s.ms, label: s.label })),
          ],
          { script: outage("stats", "Analytics", 1400, 2900, 4200), wideH: 460 },
        ),
    },
  ],
  takeaways: {
    use: "Use it when several independent services react to the same event, and the publisher shouldn't care who they are.",
    catch: "Nobody waits for the subscribers, so you lose a single place to see the whole flow. Each subscriber must handle duplicates.",
    seen: "Amazon SNS, Google Pub/Sub, Kafka topics, Redis pub/sub.",
  },
};

const STALL = "The service stalls";
const UNSTALL = "The stall is over";

const stallScene = (strategy: number) => {
  const build = (v: Values): ReturnType<typeof scene> =>
    scene(
      [
        users("u", [10, 50], {
          rate: 22,
          keys: 50,
          timeoutMs: 500,
          retry:
            strategy === 0
              ? { mode: "now", max: 3 }
              : strategy === 1
                ? { mode: "backoff", max: 3, baseMs: 120 }
                : { mode: "backoff", max: 3, baseMs: 120, budget: 0.1 },
        }, "svc"),
        server("svc", [84, 50], { slots: v.stall ? 0 : 4, serviceMs: 100, queueMax: 300, label: "Service" }),
      ],
      {
        sloMs: 300,
        // Armed: the learner stalls the service (the break beat, or the fault button); it comes back 800 ms later.
        script: {
          loopMs: 7000,
          events: [
            { at: 1000, label: STALL, armed: true, node: "svc", run: (s: Sim) => s.reconfigure(build({ stall: 1 })) },
            { at: 1800, label: UNSTALL, armed: true, node: "svc", run: (s: Sim) => s.reconfigure(build({ stall: 0 })) },
          ],
        },
      },
    );
  return build({ stall: 0 });
};

const stall: Action = {
  id: "stall",
  label: "Stall the service",
  undo: "End the stall now",
  run: (sim, on) => void sim.fire(on ? STALL : UNSTALL),
  isOn: (sim) => sim.nodes.get("svc")?.spec.slots === 0,
};

const amplify = { id: "amplify" as const, label: "Load multiplier", hint: "Attempts sent per real request. ×1.0 means no extra load from retries." };
const answered = { id: "answered" as const, label: "Succeeded", hint: "Share of requests that eventually got an answer." };

const retries: Lesson = {
  slug: "retries-and-backoff",
  code: "A3",
  line: "async",
  title: "Retries & backoff",
  why: "Retrying a failed request once is smart. When every client retries instantly and all at once, a brief hiccup becomes a long outage.",
  level: "intermediate",
  minutes: 7,
  hook: "A service hiccups for one second. Why is it still down a minute later?",
  dots: ["req", "late", "ok", "gaveup"],
  figures: [
    {
      tone: "problem",
      short: "Retry now",
      title: "Retry at once",
      caption: "All calm: 22 in, 22 out. The service is about to stall for under a second.",
      actions: [stall],
      metrics: [answered, amplify, M.p95()],
      parts: [
        { node: "u", text: "Users: 22 a second; give up after 500 ms." },
        { node: "u", text: "Users: then retry at once, up to 3 times." },
        { node: "svc", text: "Service: 4 workers, 100 ms each.", sockets: true },
      ],
      beats: [
        {
          id: "calm",
          when: { at: 300 },
          text: "Response time {p95:problem}, target 300 ms. [[load-multiplier|Load multiplier]] {amplify:problem}: one attempt per request.",
          focus: { metric: "Load multiplier" },
          term: "load-multiplier",
        },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Stall the service.", focus: { action: "stall" }, pause: true },
        {
          id: "stalled",
          when: { note: STALL },
          text: "No worker takes anything. Watch the line in front of Service.",
          focus: { nodes: ["svc"], dots: "waiting" },
          pause: true,
        },
        {
          id: "ghost",
          when: { fx: "timeout" },
          text: "A hollow red ring: a user who gave up. Its request still waits: a [[ghost]].",
          focus: { nodes: ["svc"], dots: "gaveup" },
          pause: true,
          term: "ghost",
        },
        {
          id: "amplify",
          when: { metric: amplify, is: ">", value: 1.5 },
          text: "Each user who gave up retries at once. Load multiplier: {amplify:problem}.",
          focus: { metric: "Load multiplier" },
        },
        {
          id: "back",
          // Not the moment the stall ends: once the outage has reached the numbers, which is always after it ends.
          when: { metric: answered, is: "<", value: 0.1, forMs: 300 },
          text: "Service is back, but its line is ghosts and retries. Succeeded: {answered:problem}.",
          focus: { nodes: ["svc"], dots: "gaveup" },
        },
      ],
      predict: {
        prompt: "The stall lasts 0.8 s. After it ends, the service will…",
        options: ["recover within a second or two", "recover, but take several seconds", "never recover at this traffic"],
        answer: 2,
        before: "press",
        reveal: { beat: "back", text: "Succeeded fell from {before} to {after}. The hiccup is now an outage." },
        track: { metric: answered },
        // "Never" can't be seen at one moment: tests/lessons.test.ts also holds the problem at 0% for 20 s after a stall.
        holds: (before, after) => before !== null && before > 0.9 && after !== null && after < 0.1,
      },
      break: { action: "stall", beat: "press" },
      build: () => stallScene(0),
    },
    {
      tone: "fix",
      short: "Backoff",
      title: "Wait, spread out, cap it",
      caption: "Same users, same stall. Now each retry waits longer than the last, at random, and retries are capped.",
      knobs: [choice("s", "Retry strategy", ["At once", "Backoff + jitter", "+ retry budget"], 2)],
      actions: [stall],
      metrics: [answered, amplify, M.p95()],
      beats: [
        {
          id: "same",
          // The fault hit both worlds when it was pressed: this one has been recovering since.
          when: { note: STALL, since: "lesson" },
          text: "Same stall, same moment: this world stalled too. Watch it come back.",
          focus: { nodes: ["svc"], dots: "waiting" },
        },
        {
          id: "backoff",
          when: { wait: 0 },
          text: "Now a user who gives up waits longer each time: 120, 240, 480 ms. That's [[backoff]].",
          focus: { nodes: ["u"] },
          pause: true,
          term: "backoff",
        },
        {
          id: "jitter",
          when: { wait: 0 },
          text: "Each wait is randomised a little so users don't all retry in the same instant: [[jitter]].",
          focus: { link: ["u", "svc"] },
          term: "jitter",
        },
        {
          id: "budget",
          when: { wait: 0 },
          text: "Only 1 retry is allowed per 10 requests: a [[retry-budget|retry budget]]. Load multiplier stays near ×1.",
          focus: { metric: "Load multiplier" },
          term: "retry-budget",
        },
        {
          id: "drain",
          when: { metric: answered, is: ">", value: 0.9 },
          text: "The line drains. Succeeded climbs back to {answered:fix}.",
          focus: { nodes: ["svc"] },
        },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Switch the strategy to “At once” and stall again. Then try “Backoff + jitter”.", focus: { knob: "s" } }],
      headline: {
        metric: "Succeeded",
        sentence: "Same 0.8 s stall. Retrying at once: {answered:problem} succeeded, load {amplify:problem}. With backoff, jitter and a budget: {answered:fix}, load {amplify:fix}.",
      },
      build: (v) => stallScene(v.s),
    },
  ],
  checks: [
    {
      prompt: "Which retry turns a hiccup into an outage?",
      options: ["one retry after a short wait", "everyone retrying immediately", "no retries at all"],
      answer: 1,
      why: "Immediate retries arrive while the service is still full, so they only lengthen the line.",
      focus: { nodes: ["svc"], dots: "waiting" },
    },
    {
      prompt: "[[jitter|Jitter]] exists to…",
      options: ["make retries faster", "stop clients retrying in the same instant", "reduce the number of retries"],
      answer: 1,
      why: "Backoff alone makes everyone wait the same time and come back together; jitter spreads them out.",
      focus: { link: ["u", "svc"] },
    },
  ],
  takeaways: {
    use: "The failure might succeed next time (timeouts, 503s). Retry with backoff, jitter and a cap.",
    catch: "Retries multiply load exactly when the system is weakest. Retrying at every layer multiplies it again.",
    seen: "AWS SDK retry modes, gRPC retry policies, Envoy retry budgets.",
    rule: "Retry later, not louder.",
    interview: "I'd retry only idempotent calls, with exponential backoff, full jitter and a retry budget, and never at more than one layer.",
  },
};

export const asyncLessons = [queues, pubsub, retries];
