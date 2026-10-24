// Each live lesson's scenes, loaded with its page and fetched ahead for "Next stop". Every path is written out: the
// bundler gives a module a chunk of its own only for a literal import path. `npm run new-lesson` adds a line here, and
// tests/lessons.test.ts checks the map covers every live lesson.

import type { LessonScene } from "../types";

type Load = () => Promise<{ default: LessonScene }>;

export const SCENES: Record<string, Load> = {
  // Foundations
  "latency-and-throughput": () => import("./latency-and-throughput"),
  "scaling-up-vs-out": () => import("./scaling-up-vs-out"),
  "load-balancing": () => import("./load-balancing"),
  "health-checks": () => import("./health-checks"),
  "stateless-vs-stateful": () => import("./stateless-vs-stateful"),
  "nines-and-error-budgets": () => import("./nines-and-error-budgets"),
  // Caching
  caching: () => import("./caching"),
  cdn: () => import("./cdn"),
  "stale-data": () => import("./stale-data"),
  "cache-stampede": () => import("./cache-stampede"),
  "negative-caching": () => import("./negative-caching"),
  // Data
  "read-replicas": () => import("./read-replicas"),
  sharding: () => import("./sharding"),
  "consistent-hashing": () => import("./consistent-hashing"),
  "consistency-vs-availability": () => import("./consistency-vs-availability"),
  indexes: () => import("./indexes"),
  "connection-pools": () => import("./connection-pools"),
  failover: () => import("./failover"),
  // Async
  "message-queues": () => import("./message-queues"),
  "publish-subscribe": () => import("./publish-subscribe"),
  "retries-and-backoff": () => import("./retries-and-backoff"),
  idempotency: () => import("./idempotency"),
  "dead-letter-queues": () => import("./dead-letter-queues"),
  outbox: () => import("./outbox"),
  "partitioned-logs": () => import("./partitioned-logs"),
  // Resilience
  "rate-limiting": () => import("./rate-limiting"),
  "circuit-breakers": () => import("./circuit-breakers"),
  autoscaling: () => import("./autoscaling"),
  "load-shedding": () => import("./load-shedding"),
  bulkheads: () => import("./bulkheads"),
  "cascading-failures": () => import("./cascading-failures"),
  "cold-caches-and-herds": () => import("./cold-caches-and-herds"),
  // Networking
  "request-and-response": () => import("./request-and-response"),
  "latency-vs-bandwidth": () => import("./latency-vs-bandwidth"),
  "timeouts-and-deadlines": () => import("./timeouts-and-deadlines"),
  "pipelining-and-batching": () => import("./pipelining-and-batching"),
  "nearest-region-and-failover": () => import("./nearest-region-and-failover"),
  dns: () => import("./dns"),
  acknowledgements: () => import("./acknowledgements"),
  "delivery-guarantees": () => import("./delivery-guarantees"),
  backpressure: () => import("./backpressure"),
  "handshakes-and-keep-alive": () => import("./handshakes-and-keep-alive"),
  "windows-and-flow-control": () => import("./windows-and-flow-control"),
  "congestion-control": () => import("./congestion-control"),
  "head-of-line-blocking": () => import("./head-of-line-blocking"),
  "push-vs-poll": () => import("./push-vs-poll"),
  "l4-vs-l7": () => import("./l4-vs-l7"),
  heartbeats: () => import("./heartbeats"),
  // Operating
  "canary-rollouts": () => import("./canary-rollouts"),
  "graceful-shutdown": () => import("./graceful-shutdown"),
};

/**
 * A promise that records how it settled, the way React's `use` reads one: once a module fetched ahead has arrived, the
 * page renders with it at once instead of showing its fallback for a moment.
 */
export function settled<T>(p: Promise<T>): Promise<T> {
  const s = p as Promise<T> & { status: string; value?: T; reason?: unknown };
  s.status = "pending";
  p.then(
    (v) => Object.assign(s, { status: "fulfilled", value: v }),
    (e) => Object.assign(s, { status: "rejected", reason: e }),
  );
  return s;
}

const loaded = new Map<string, Promise<LessonScene>>();

/** A lesson's scenes, fetched once and kept: the lesson page reads it with `use`, and "Next stop" fetches it ahead. */
export function loadScene(slug: string): Promise<LessonScene> {
  let p = loaded.get(slug);
  if (!p) {
    p = settled(SCENES[slug]().then((m) => m.default));
    loaded.set(slug, p);
  }
  return p;
}
