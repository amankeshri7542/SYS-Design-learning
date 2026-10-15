import type { Sim } from "../sim/engine";
import type { NodeSpec } from "../sim/types";
import { outage } from "./foundations";
import { M, bursts, choice, crash, knob, lane, range, scene, server, users, worker } from "./kit";
import type { Lesson, Values } from "./types";

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
        script: {
          loopMs: 7000,
          events: [
            { at: 1000, label: "The service stalls for a moment", run: (s: Sim) => s.reconfigure(build({ stall: 1 })) },
            { at: 1800, label: "The stall is over", run: (s: Sim) => s.reconfigure(build({ stall: 0 })) },
          ],
        },
      },
    );
  return build({ stall: 0 });
};

const amplify = { id: "amplify" as const, label: "Load multiplier", hint: "Attempts sent per real request. ×1.0 means no extra load from retries." };
const answered = { id: "answered" as const, label: "Succeeded", hint: "Share of requests that eventually got an answer." };

const retries: Lesson = {
  slug: "retries-and-backoff",
  code: "A3",
  line: "async",
  title: "Retries & backoff",
  why: "Retrying a failed request once is smart. When every client retries instantly and all at once, a brief hiccup becomes a long outage.",
  figures: [
    {
      tone: "problem",
      short: "Retry now",
      title: "Clients retry immediately",
      caption:
        "The service stalls for under a second. Clients give up after half a second and retry at once, but their abandoned requests are still in the queue (hollow ghosts). The load quadruples and it never recovers.",
      metrics: [answered, amplify, M.p95()],
      build: () => stallScene(0),
    },
    {
      tone: "fix",
      short: "Backoff",
      title: "Back off, add jitter, cap the retries",
      caption:
        "Wait longer after each failure, randomise the wait so clients don't retry in sync, and allow only a small budget of retries. The queue drains and the service recovers.",
      knobs: [choice("s", "Retry strategy", ["At once", "Backoff + jitter", "+ retry budget"], 2)],
      metrics: [answered, amplify, M.p95()],
      build: (v) => stallScene(v.s),
    },
  ],
  takeaways: {
    use: "Retry only failures that might succeed next time (timeouts, 503s), with exponential backoff, jitter, and a cap.",
    catch: "Retries multiply load exactly when the system is weakest. Retrying at every layer multiplies it again.",
    seen: "AWS SDK retry modes, gRPC retry policies, Envoy retry budgets.",
  },
};

export const asyncLessons = [queues, pubsub, retries];
