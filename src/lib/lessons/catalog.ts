// The course catalog: every lesson and story, built or planned, as metadata only. The home page, the route map, the
// static params and each page's metadata read it; scenes live in `scenes/<slug>.ts` and load with their lesson page.
// Each entry's one-line why and search tags are in `words.ts`, so lesson pages don't carry every entry's words.
//
// Codes were assigned once, in docs/plan-v3.md §6.2 and §6.3 row order (each line in level order), and are frozen:
// `tests/catalog.snapshot.json` records them. A line shows gaps until its planned lessons go live. `npm run new-lesson
// -- <slug>` turns a planned entry into a live lesson.
//
// No imports but types: `next.config.ts` reads the aliases from here.

import type { LessonMeta, Line } from "./types";

/** The lines, in the map's order: topics as rows. Stories ride several lines, so they are journeys, not a row. */
export const LINES: Line[] = [
  { id: "networking", letter: "N", name: "Networking", blurb: "What crosses the wire between machines, and what goes wrong on the way." },
  { id: "foundations", letter: "F", name: "Foundations", blurb: "How a request is served, and what happens when there are too many." },
  { id: "caching", letter: "C", name: "Caching", blurb: "Answer from a nearby copy instead of doing the work again." },
  { id: "data", letter: "D", name: "Data", blurb: "Copying and splitting data across machines, and what that costs." },
  { id: "async", letter: "A", name: "Async", blurb: "Do the work later, elsewhere, and survive the hiccups." },
  { id: "resilience", letter: "R", name: "Resilience", blurb: "Stay up when clients misbehave, dependencies hang and traffic swings." },
  { id: "operating", letter: "O", name: "Operating", blurb: "Change a running system without breaking it: deploys, rollbacks and draining." },
  { id: "stories", letter: "★", name: "Journeys", blurb: "Real systems, built up stage by stage under growing traffic and failures." },
];

const live = { kind: "lesson", status: "live" } as const;
const planned = { kind: "lesson", status: "planned" } as const;
const story = { kind: "story", line: "stories", minutes: 20 } as const;

export const CATALOG: LessonMeta[] = [
  // ------------------------------------------------------------------------------------------ N · Networking
  { ...live, slug: "request-and-response", code: "N1", line: "networking", level: "beginner", minutes: 4, title: "A request and a response" },
  { ...live, slug: "acknowledgements", code: "N2", line: "networking", level: "beginner", minutes: 4, title: "Acknowledgements", requires: ["request-and-response"] },
  { ...live, slug: "latency-vs-bandwidth", code: "N3", line: "networking", level: "beginner", minutes: 4, title: "Latency vs bandwidth", requires: ["request-and-response"] },
  { ...live, slug: "handshakes-and-keep-alive", code: "N4", line: "networking", level: "beginner", minutes: 4, title: "Handshakes and keep-alive", requires: ["request-and-response"] },
  { ...live, slug: "dns", code: "N5", line: "networking", level: "beginner", minutes: 4, title: "DNS: finding the server", requires: ["request-and-response"] },
  { ...live, slug: "windows-and-flow-control", code: "N6", line: "networking", level: "intermediate", minutes: 7, title: "Windows and flow control", requires: ["acknowledgements", "latency-vs-bandwidth"] },
  { ...live, slug: "push-vs-poll", code: "N7", line: "networking", level: "intermediate", minutes: 7, title: "Long polling, SSE and WebSockets", requires: ["handshakes-and-keep-alive", "publish-subscribe"] },
  { ...live, slug: "timeouts-and-deadlines", code: "N8", line: "networking", level: "intermediate", minutes: 7, title: "Timeouts and deadline propagation", requires: ["request-and-response", "latency-and-throughput"] },
  { ...live, slug: "congestion-control", code: "N9", line: "networking", level: "intermediate", minutes: 7, title: "Congestion control", requires: ["windows-and-flow-control"] },
  { ...live, slug: "head-of-line-blocking", code: "N10", line: "networking", level: "intermediate", minutes: 7, title: "Head-of-line blocking and multiplexing", requires: ["handshakes-and-keep-alive", "acknowledgements"] },
  { ...live, slug: "l4-vs-l7", code: "N11", line: "networking", level: "intermediate", minutes: 7, title: "L4 vs L7: balancers, proxies, gateways", requires: ["load-balancing", "handshakes-and-keep-alive"] },
  { ...live, slug: "heartbeats", code: "N12", line: "networking", level: "intermediate", minutes: 7, title: "Heartbeats and keepalives", requires: ["push-vs-poll", "health-checks"] },
  { ...live, slug: "pipelining-and-batching", code: "N13", line: "networking", level: "intermediate", minutes: 7, title: "Pipelining and batching", requires: ["request-and-response", "latency-vs-bandwidth"] },
  { ...live, slug: "delivery-guarantees", code: "N14", line: "networking", level: "advanced", minutes: 10, title: "At-most-once, at-least-once, exactly-once", requires: ["acknowledgements", "message-queues"] },
  // N15's curriculum prerequisites are N6 and A1; N6 joins once it is live (M8).
  { ...live, slug: "backpressure", code: "N15", line: "networking", level: "advanced", minutes: 10, title: "Backpressure", requires: ["windows-and-flow-control", "message-queues"] },
  { ...live, slug: "nearest-region-and-failover", code: "N16", line: "networking", level: "advanced", minutes: 10, title: "Nearest region and failover", requires: ["dns", "cdn", "health-checks"] },

  // ------------------------------------------------------------------------------------------ F · Foundations
  { ...live, slug: "latency-and-throughput", code: "F1", line: "foundations", level: "beginner", minutes: 6, title: "Latency & throughput", requires: ["request-and-response"] },
  { ...live, slug: "scaling-up-vs-out", code: "F2", line: "foundations", level: "beginner", minutes: 6, title: "Scaling up vs scaling out", requires: ["latency-and-throughput"] },
  { ...live, slug: "load-balancing", code: "F3", line: "foundations", level: "beginner", minutes: 6, title: "Load balancing", requires: ["scaling-up-vs-out"] },
  { ...live, slug: "health-checks", code: "F4", line: "foundations", level: "beginner", minutes: 6, title: "Health checks & failover", requires: ["load-balancing"] },
  { ...live, slug: "stateless-vs-stateful", code: "F5", line: "foundations", level: "beginner", minutes: 4, title: "Stateless servers and sessions", requires: ["scaling-up-vs-out", "load-balancing"] },
  { ...live, slug: "nines-and-error-budgets", code: "F6", line: "foundations", level: "beginner", minutes: 4, title: "Nines, SLOs and error budgets", requires: ["scaling-up-vs-out", "health-checks"] },

  // ------------------------------------------------------------------------------------------ C · Caching
  { ...live, slug: "caching", code: "C1", line: "caching", level: "beginner", minutes: 6, title: "Caching", requires: ["latency-and-throughput"] },
  { ...live, slug: "cdn", code: "C2", line: "caching", level: "beginner", minutes: 6, title: "Content delivery networks", requires: ["caching"] },
  { ...live, slug: "stale-data", code: "C3", line: "caching", level: "intermediate", minutes: 6, title: "Expiry & stale data", requires: ["caching"] },
  { ...live, slug: "cache-stampede", code: "C4", line: "caching", level: "intermediate", minutes: 6, title: "Cache stampede", requires: ["stale-data"] },
  { ...live, slug: "negative-caching", code: "C5", line: "caching", level: "intermediate", minutes: 7, title: "Misses that never hit", requires: ["caching", "cache-stampede"] },
  { ...live, slug: "cache-write-strategies", code: "C6", line: "caching", level: "intermediate", minutes: 7, title: "Write-through, write-behind, cache-aside", requires: ["caching", "stale-data"] },

  // ------------------------------------------------------------------------------------------ D · Data
  { ...live, slug: "indexes", code: "D1", line: "data", level: "beginner", minutes: 4, title: "Indexes", requires: ["latency-and-throughput"] },
  { ...live, slug: "read-replicas", code: "D2", line: "data", level: "intermediate", minutes: 6, title: "Read replicas", requires: ["indexes", "caching"] },
  { ...live, slug: "sharding", code: "D3", line: "data", level: "intermediate", minutes: 6, title: "Sharding", requires: ["read-replicas"] },
  { ...live, slug: "consistent-hashing", code: "D4", line: "data", level: "intermediate", minutes: 7, title: "Consistent hashing", requires: ["sharding"] },
  { ...live, slug: "connection-pools", code: "D5", line: "data", level: "intermediate", minutes: 7, title: "Connection pools", requires: ["handshakes-and-keep-alive", "latency-and-throughput"] },
  { ...live, slug: "failover", code: "D6", line: "data", level: "intermediate", minutes: 7, title: "Primary failover", requires: ["read-replicas", "health-checks"] },
  // D7's curriculum prerequisites are D2 and N2; N2 joins once it is live.
  { ...live, slug: "consistency-vs-availability", code: "D7", line: "data", level: "advanced", minutes: 8, title: "Consistency vs availability", requires: ["read-replicas", "acknowledgements"] },
  { ...live, slug: "quorums", code: "D8", line: "data", level: "advanced", minutes: 10, title: "Quorum reads and writes", requires: ["read-replicas", "consistency-vs-availability"] },
  { ...live, slug: "leader-election", code: "D9", line: "data", level: "advanced", minutes: 10, title: "Leader election (Raft)", requires: ["consistency-vs-availability", "failover", "heartbeats"] },
  { ...live, slug: "locks-and-double-booking", code: "D10", line: "data", level: "advanced", minutes: 10, title: "Locks and double booking", requires: ["latency-and-throughput", "sharding"] },

  // ------------------------------------------------------------------------------------------ A · Async
  { ...live, slug: "message-queues", code: "A1", line: "async", level: "beginner", minutes: 6, title: "Message queues", requires: ["latency-and-throughput"] },
  { ...live, slug: "publish-subscribe", code: "A2", line: "async", level: "intermediate", minutes: 6, title: "Publish / subscribe", requires: ["message-queues"] },
  // A3's curriculum prerequisites are N2 and F1; N2 joins once it is live.
  { ...live, slug: "retries-and-backoff", code: "A3", line: "async", level: "intermediate", minutes: 7, title: "Retries & backoff", requires: ["latency-and-throughput", "acknowledgements"] },
  { ...live, slug: "idempotency", code: "A4", line: "async", level: "intermediate", minutes: 7, title: "Idempotency keys", requires: ["retries-and-backoff", "acknowledgements"] },
  { ...live, slug: "dead-letter-queues", code: "A5", line: "async", level: "intermediate", minutes: 7, title: "Poison messages and dead-letter queues", requires: ["message-queues", "delivery-guarantees"] },
  { ...live, slug: "outbox", code: "A6", line: "async", level: "advanced", minutes: 10, title: "The outbox pattern", requires: ["publish-subscribe", "idempotency"] },
  { ...live, slug: "partitioned-logs", code: "A7", line: "async", level: "advanced", minutes: 10, title: "Partitions, ordering and consumer groups", requires: ["message-queues", "sharding"] },
  { ...live, slug: "stream-windows", code: "A8", line: "async", level: "advanced", minutes: 10, title: "Windows and aggregation", requires: ["partitioned-logs"] },
  { ...live, slug: "sagas", code: "A9", line: "async", level: "advanced", minutes: 10, title: "Sagas: multi-step work that fails halfway", requires: ["outbox", "locks-and-double-booking"] },

  // ------------------------------------------------------------------------------------------ R · Resilience
  { ...live, slug: "rate-limiting", code: "R1", line: "resilience", level: "intermediate", minutes: 6, title: "Rate limiting", requires: ["latency-and-throughput"] },
  // R2's curriculum prerequisite is N8 (timeouts and deadlines), added once it is live.
  { ...live, slug: "circuit-breakers", code: "R2", line: "resilience", level: "intermediate", minutes: 7, title: "Circuit breakers", requires: ["timeouts-and-deadlines"] },
  { ...live, slug: "autoscaling", code: "R3", line: "resilience", level: "intermediate", minutes: 7, title: "Autoscaling", requires: ["load-balancing", "health-checks"] },
  { ...live, slug: "load-shedding", code: "R4", line: "resilience", level: "intermediate", minutes: 7, title: "Load shedding and priority", requires: ["latency-and-throughput", "timeouts-and-deadlines"] },
  { ...live, slug: "bulkheads", code: "R5", line: "resilience", level: "intermediate", minutes: 7, title: "Bulkheads", requires: ["circuit-breakers"] },
  { ...live, slug: "cascading-failures", code: "R6", line: "resilience", level: "advanced", minutes: 10, title: "Cascading failures", requires: ["load-shedding", "scaling-up-vs-out", "autoscaling"] },
  { ...live, slug: "cold-caches-and-herds", code: "R7", line: "resilience", level: "advanced", minutes: 10, title: "Cold caches and thundering herds", requires: ["caching", "cache-stampede", "health-checks"] },
  { ...live, slug: "hedged-requests", code: "R8", line: "resilience", level: "advanced", minutes: 10, title: "Hedged requests: beating tail latency", requires: ["load-balancing", "timeouts-and-deadlines"] },

  // ------------------------------------------------------------------------------------------ O · Operating
  { ...live, slug: "canary-rollouts", code: "O1", line: "operating", level: "intermediate", minutes: 7, title: "Canary rollouts", requires: ["load-balancing", "health-checks"] },
  { ...live, slug: "graceful-shutdown", code: "O2", line: "operating", level: "intermediate", minutes: 7, title: "Graceful shutdown and draining", requires: ["health-checks"] },

  // ------------------------------------------------------------------------------------------ ★ Journeys
  // A story's `requires` are the lessons it rides, in the order it rides them: its stops on the map and its card.
  { ...story, status: "live", slug: "capstone", code: "S0", level: "intermediate", title: "Keep a URL shortener alive", requires: ["caching", "load-balancing", "health-checks", "read-replicas", "rate-limiting"] },
  { ...story, status: "live", slug: "web-crawler", code: "S1", level: "advanced", title: "Crawl the web", requires: ["message-queues", "delivery-guarantees", "dead-letter-queues"] },
  { ...story, status: "live", slug: "video-premiere", code: "S2", level: "advanced", title: "Serve a premiere to the world", requires: ["cdn", "cache-stampede", "nearest-region-and-failover"] },
  { ...story, status: "live", slug: "chat", code: "S3", level: "advanced", title: "Keep a chat live", requires: ["push-vs-poll", "l4-vs-l7", "heartbeats"] },
  { ...story, status: "live", slug: "flash-sale", code: "S4", level: "advanced", title: "Sell 1,000 seats to 100,000 people", requires: ["caching", "locks-and-double-booking", "rate-limiting"] },
  { ...story, status: "live", slug: "ride-matching", code: "S5", level: "advanced", title: "Match a rider to the nearest driver", requires: ["pipelining-and-batching", "locks-and-double-booking", "nearest-region-and-failover"] },
  { ...story, status: "live", slug: "news-feed", code: "S6", level: "advanced", title: "Build a news feed", requires: ["sharding", "hedged-requests", "publish-subscribe"] },
  { ...story, status: "live", slug: "payments", code: "S7", level: "advanced", title: "Charge exactly once", requires: ["idempotency", "sagas", "locks-and-double-booking"] },
  { ...story, status: "live", slug: "click-counting", code: "S8", level: "advanced", title: "Count a billion clicks", requires: ["sharding", "stream-windows", "delivery-guarantees"] },
];

/**
 * The recommended path (docs/plan-v3.md §6.5): beginner, then intermediate, then advanced, with the lines interleaved
 * so each lesson comes just before the ones it unlocks. "Next stop" follows it, skipping what isn't live yet.
 */
export const PATH: string[] = [
  // Band 1: a request and a server
  "request-and-response", "latency-vs-bandwidth", "latency-and-throughput", "handshakes-and-keep-alive", "dns",
  "scaling-up-vs-out", "load-balancing", "health-checks", "stateless-vs-stateful",
  "caching", "cdn", "indexes", "message-queues", "acknowledgements", "nines-and-error-budgets",
  // Band 2: the classic interview core
  "timeouts-and-deadlines", "windows-and-flow-control", "backpressure",
  "stale-data", "cache-stampede", "read-replicas", "sharding", "consistent-hashing",
  "publish-subscribe", "push-vs-poll", "retries-and-backoff", "delivery-guarantees", "idempotency", "dead-letter-queues",
  "rate-limiting", "circuit-breakers", "autoscaling",
  "connection-pools", "failover", "heartbeats", "load-shedding", "bulkheads", "canary-rollouts", "graceful-shutdown",
  "capstone",
  // Band 3: distributed data, streams and real time
  "l4-vs-l7", "head-of-line-blocking", "pipelining-and-batching", "cache-write-strategies", "negative-caching", "congestion-control",
  "partitioned-logs", "stream-windows", "outbox",
  "consistency-vs-availability", "quorums", "leader-election", "locks-and-double-booking",
  "cold-caches-and-herds", "hedged-requests", "nearest-region-and-failover", "sagas", "cascading-failures",
  "web-crawler", "video-premiere", "flash-sale", "payments", "chat", "news-feed", "ride-matching", "click-counting",
];

/** The interview fast lane (curriculum §5): the canon, in order. The home page lists the live ones. */
export const FAST_LANE: string[] = [
  "latency-and-throughput", "scaling-up-vs-out", "load-balancing", "health-checks",
  "caching", "cdn", "stale-data", "cache-stampede",
  "read-replicas", "sharding", "consistent-hashing", "consistency-vs-availability", "quorums", "locks-and-double-booking",
  "message-queues", "publish-subscribe", "retries-and-backoff", "idempotency", "dead-letter-queues",
  "rate-limiting", "circuit-breakers", "autoscaling", "load-shedding", "canary-rollouts",
  "capstone", "flash-sale", "chat", "news-feed",
];
