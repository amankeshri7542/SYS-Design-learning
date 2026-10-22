// The course's vocabulary. Lessons mark a term in their text as [[key|plain words]]: the plain words show, with a dotted
// underline, and a tap opens the short definition here. Each term is named once, by a beat, after the scene has shown it.

import type { Focus } from "./lessons/beats";

export interface Term {
  key: string;
  /** The name people use. */
  name: string;
  /** Other names the learner will meet in the wild. */
  alias?: string;
  /** ≤20 words, plain. */
  short: string;
  /** "Show me": the lesson that shows it best, and what to point at there. */
  show?: { lesson: string; focus: Focus };
}

const TERMS: Term[] = [
  // Foundations
  { key: "worker", name: "Worker", alias: "thread, connection", short: "One request a server can work on at a time. A server has a fixed number, drawn as sockets.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], sockets: true } } },
  { key: "queue", name: "Queue", alias: "waiting line, backlog", short: "Requests waiting their turn because every worker is busy. Waiting is most of what “slow” means.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], dots: "waiting" } } },
  { key: "latency-target", name: "Latency target", alias: "SLO", short: "The response time a system promises. A request still going after it runs late, drawn amber.", show: { lesson: "latency-and-throughput", focus: { dots: "late" } } },
  { key: "p95", name: "p95", alias: "95th percentile", short: "The time 95 of every 100 requests beat. Said plainly: the slowest 1 in 20 take this long or longer." },
  { key: "capacity", name: "Capacity", alias: "throughput ceiling", short: "The most a part can finish each second: its workers divided by the time each request takes.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], sockets: true } } },
  // Caching
  { key: "hit", name: "Cache hit", short: "The cache had a copy, so the answer came back without asking the database.", show: { lesson: "caching", focus: { nodes: ["cache"] } } },
  { key: "miss", name: "Cache miss", short: "The cache had no copy: the read goes on to the database, and the answer is kept for next time.", show: { lesson: "caching", focus: { nodes: ["cache"], link: ["cache", "db"] } } },
  { key: "eviction", name: "Eviction", alias: "LRU", short: "A full cache drops the copy it used least recently, to make room for a new one.", show: { lesson: "caching", focus: { nodes: ["cache"] } } },
  // Async
  { key: "load-multiplier", name: "Load multiplier", alias: "retry amplification", short: "Attempts sent for every real request. Each retry adds one, so retries push it above ×1." },
  { key: "ghost", name: "Ghost request", short: "Work still waiting in a server's line for a user who already gave up. Serving it helps nobody.", show: { lesson: "retries-and-backoff", focus: { nodes: ["svc"], dots: "gaveup" } } },
  { key: "backoff", name: "Exponential backoff", alias: "backoff", short: "Wait before retrying, and wait twice as long after each failure." },
  { key: "jitter", name: "Jitter", short: "A random part of each wait, so clients that failed together don't all retry at the same instant." },
  { key: "retry-budget", name: "Retry budget", short: "A cap on retries, such as one for every ten requests, so retries can't swamp a struggling service." },
];

export const GLOSSARY: ReadonlyMap<string, Term> = new Map(TERMS.map((t) => [t.key, t]));

export function termOf(key: string): Term | undefined {
  return GLOSSARY.get(key);
}
