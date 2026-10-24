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
  // Networking
  { key: "request", name: "Request", alias: "call, HTTP request", short: "A message asking a server for something. It has to travel there before any work starts.", show: { lesson: "request-and-response", focus: { link: ["u", "app"] } } },
  { key: "response", name: "Response", alias: "reply, answer", short: "The server's message back with the answer. It travels the same distance home.", show: { lesson: "request-and-response", focus: { link: ["u", "app"] } } },
  { key: "round-trip", name: "Round trip", alias: "RTT, round-trip time", short: "Out and back across a link: twice its one-way time, before any work is counted.", show: { lesson: "request-and-response", focus: { link: ["u", "app"] } } },
  { key: "bandwidth", name: "Bandwidth", alias: "throughput of a link, Mb/s", short: "How many bits a link sends each second. A big answer takes size ÷ bandwidth to send.", show: { lesson: "latency-vs-bandwidth", focus: { link: ["u", "app"] } } },
  { key: "latency", name: "Latency", alias: "delay, ping", short: "How long the first bit takes to arrive: set by distance and the route, not by link speed.", show: { lesson: "latency-vs-bandwidth", focus: { link: ["u", "app"] } } },
  { key: "bdp", name: "Bandwidth-delay product", alias: "BDP", short: "Bandwidth times round trip: how much data is on the wire at once when it is kept full." },
  { key: "deadline", name: "Deadline", alias: "deadline propagation, timeout budget", short: "The moment a request stops being worth answering. Passed along, every hop can drop work past it.", show: { lesson: "timeouts-and-deadlines", focus: { nodes: ["api", "db"] } } },
  { key: "n-plus-one", name: "N+1 problem", alias: "N+1 queries", short: "Fetching a list one item per call: each item costs a whole round trip, one after another.", show: { lesson: "pipelining-and-batching", focus: { link: ["app", "db"] } } },
  { key: "batching", name: "Batching", alias: "batch query, pipelining", short: "Sending many items in one request, so they share one round trip instead of paying one each.", show: { lesson: "pipelining-and-batching", focus: { metric: "Database trips" } } },
  { key: "anycast", name: "Anycast", alias: "geo routing, latency routing", short: "One address announced from many regions: the network delivers each user to the nearest one that answers.", show: { lesson: "nearest-region-and-failover", focus: { nodes: ["deu", "dus"] } } },
  { key: "dns", name: "DNS", alias: "Domain Name System, resolver", short: "The internet's phone book: it turns a name like example.com into the address of a server.", show: { lesson: "dns", focus: { nodes: ["root", "tld", "auth"] } } },
  // Foundations
  { key: "worker", name: "Worker", alias: "thread, connection", short: "One request a server can work on at a time. A server has a fixed number, drawn as sockets.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], sockets: true } } },
  { key: "queue", name: "Queue", alias: "waiting line, backlog", short: "Requests waiting their turn because every worker is busy. Waiting is most of what “slow” means.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], dots: "waiting" } } },
  { key: "latency-target", name: "Latency target", alias: "SLO", short: "The response time a system promises. A request still going after it runs late, drawn amber.", show: { lesson: "latency-and-throughput", focus: { dots: "late" } } },
  { key: "p95", name: "p95", alias: "95th percentile", short: "The time 95 of every 100 requests beat. Said plainly: the slowest 1 in 20 take this long or longer." },
  { key: "capacity", name: "Capacity", alias: "throughput ceiling", short: "The most a part can finish each second: its workers divided by the time each request takes.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], sockets: true } } },
  { key: "round-robin", name: "Round robin", short: "A balancer giving each server the next request in turn, whatever it is doing.", show: { lesson: "load-balancing", focus: { nodes: ["lb"] } } },
  { key: "health-check", name: "Health check", alias: "probe, ping", short: "A small request a balancer sends each server to see if it still answers.", show: { lesson: "health-checks", focus: { nodes: ["lb"] } } },
  // Caching
  { key: "hit", name: "Cache hit", short: "The cache had a copy, so the answer came back without asking the database.", show: { lesson: "caching", focus: { nodes: ["cache"] } } },
  { key: "miss", name: "Cache miss", short: "The cache had no copy: the read goes on to the database, and the answer is kept for next time.", show: { lesson: "caching", focus: { nodes: ["cache"], link: ["cache", "db"] } } },
  { key: "eviction", name: "Eviction", alias: "LRU", short: "A full cache drops the copy it used least recently, to make room for a new one.", show: { lesson: "caching", focus: { nodes: ["cache"] } } },
  { key: "edge", name: "Edge", alias: "CDN edge, point of presence", short: "A cache close to users. Many of them together make a content delivery network (CDN).", show: { lesson: "cdn", focus: { nodes: ["e-as"] } } },
  { key: "stale-read", name: "Stale read", short: "An answer from a copy that is older than the latest write.", show: { lesson: "stale-data", focus: { dots: "stale" } } },
  { key: "ttl", name: "Time to live", alias: "TTL, expiry", short: "How long a cached copy may be used before it must be fetched again.", show: { lesson: "stale-data", focus: { nodes: ["cache"] } } },
  { key: "invalidation", name: "Invalidation", alias: "purge", short: "Deleting a cached copy as soon as the source changes, so the next read fetches it fresh." },
  { key: "stampede", name: "Cache stampede", alias: "thundering herd", short: "Many requests missing on the same popular item at once and rushing the database together.", show: { lesson: "cache-stampede", focus: { nodes: ["db"], dots: "waiting" } } },
  { key: "coalescing", name: "Request coalescing", alias: "single-flight", short: "Letting one miss fetch an item while the others for the same item wait for its answer.", show: { lesson: "cache-stampede", focus: { nodes: ["cache"] } } },
  // Data
  { key: "replica", name: "Replica", alias: "read replica, secondary", short: "A copy of a database that takes the primary's writes a moment later and answers reads.", show: { lesson: "read-replicas", focus: { nodes: ["r1"] } } },
  { key: "replication-lag", name: "Replication lag", short: "The moment between a write landing on the primary and its copy reaching a replica.", show: { lesson: "read-replicas", focus: { dots: "stale" } } },
  { key: "shard", name: "Shard", alias: "partition", short: "One database's slice of the keys, when the data is split across several by key.", show: { lesson: "sharding", focus: { nodes: ["d1", "d2", "d3"] } } },
  { key: "consistent-hashing", name: "Consistent hashing", alias: "hash ring", short: "Placing keys and nodes on a ring, so a node joining or leaving moves only its neighbours' keys.", show: { lesson: "consistent-hashing", focus: { nodes: ["router"] } } },
  { key: "leader", name: "Leader", alias: "primary", short: "The one copy that decides: every write goes through it, and the others follow.", show: { lesson: "consistency-vs-availability", focus: { nodes: ["dbUS"] } } },
  // Async
  { key: "load-multiplier", name: "Load multiplier", alias: "retry amplification", short: "Attempts sent for every real request. Each retry adds one, so retries push it above ×1." },
  { key: "ghost", name: "Ghost request", short: "Work still waiting in a server's line for a user who already gave up. Serving it helps nobody.", show: { lesson: "retries-and-backoff", focus: { nodes: ["svc"], dots: "gaveup" } } },
  { key: "backoff", name: "Exponential backoff", alias: "backoff", short: "Wait before retrying, and wait twice as long after each failure." },
  { key: "jitter", name: "Jitter", short: "A random part of each wait, so clients that failed together don't all retry at the same instant." },
  { key: "retry-budget", name: "Retry budget", short: "A cap on retries, such as one for every ten requests, so retries can't swamp a struggling service." },
  { key: "backlog", name: "Backlog", short: "Work waiting on a queue for a worker. It grows when jobs arrive faster than they are done.", show: { lesson: "message-queues", focus: { nodes: ["q"] } } },
  { key: "pub-sub", name: "Publish/subscribe", alias: "pub/sub", short: "Announcing an event once; every service that listens gets its own copy.", show: { lesson: "publish-subscribe", focus: { nodes: ["topic"] } } },
  // Resilience
  { key: "token-bucket", name: "Token bucket", alias: "rate limit", short: "Each client earns tokens at a steady rate up to a small store; each request spends one.", show: { lesson: "rate-limiting", focus: { nodes: ["lim"] } } },
  { key: "circuit-breaker", name: "Circuit breaker", short: "Stops calling a failing dependency for a while after repeated failures, then tests it with one call.", show: { lesson: "circuit-breakers", focus: { nodes: ["shop"] } } },
];

export const GLOSSARY: ReadonlyMap<string, Term> = new Map(TERMS.map((t) => [t.key, t]));

export function termOf(key: string): Term | undefined {
  return GLOSSARY.get(key);
}
