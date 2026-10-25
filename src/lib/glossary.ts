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
  { key: "handshake", name: "Handshake", alias: "TCP handshake, SYN/ACK", short: "The round trip that opens a connection before any request can travel on it.", show: { lesson: "handshakes-and-keep-alive", focus: { link: ["u", "app"] } } },
  { key: "tls", name: "TLS", alias: "HTTPS, SSL, encryption", short: "Encryption agreed when a connection opens: one more round trip with TLS 1.3, two with TLS 1.2.", show: { lesson: "handshakes-and-keep-alive", focus: { link: ["u", "app"] } } },
  { key: "keep-alive", name: "Keep-alive", alias: "persistent connection, connection reuse", short: "Keeping a connection open after an answer, so the next request skips the handshake.", show: { lesson: "handshakes-and-keep-alive", focus: { nodes: ["u"] } } },
  { key: "stop-and-wait", name: "Stop-and-wait", alias: "one in flight", short: "Sending one message and waiting for its answer before the next: one message per round trip.", show: { lesson: "windows-and-flow-control", focus: { link: ["u", "r"] } } },
  { key: "sliding-window", name: "Sliding window", alias: "TCP window, in-flight limit", short: "How many messages a sender may have out unanswered at once. Each answer lets the next one go.", show: { lesson: "windows-and-flow-control", focus: { link: ["u", "r"] } } },
  { key: "flow-control", name: "Flow control", alias: "receive window, rwnd", short: "The receiver telling the sender how much room it has, so it is never sent more than it can hold.", show: { lesson: "windows-and-flow-control", focus: { nodes: ["r"] } } },
  { key: "congestion", name: "Congestion", alias: "network congestion", short: "More traffic than a shared link can carry: it queues in the link's buffer, then overflows and is lost.", show: { lesson: "congestion-control", focus: { link: ["rt", "s"] } } },
  { key: "congestion-collapse", name: "Congestion collapse", short: "A full network carrying mostly resent copies of late messages, so almost nothing useful gets through.", show: { lesson: "congestion-control", focus: { metric: "Goodput" } } },
  { key: "aimd", name: "AIMD", alias: "additive increase, multiplicative decrease, slow start", short: "Grow the sending window by one per round trip; halve it on a loss. It shares a link fairly.", show: { lesson: "congestion-control", focus: { metric: "Window" } } },
  { key: "head-of-line-blocking", name: "Head-of-line blocking", alias: "HOL blocking", short: "Everything in line waiting behind the one at the front that is slow or lost.", show: { lesson: "head-of-line-blocking", focus: { link: ["u", "app"] } } },
  { key: "multiplexing", name: "Multiplexing", alias: "HTTP/2 streams", short: "Many requests sharing one connection at once, their pieces interleaved.", show: { lesson: "head-of-line-blocking", focus: { link: ["u", "app"] } } },
  { key: "quic", name: "QUIC", alias: "HTTP/3", short: "A transport over UDP where each stream is delivered on its own, so one loss stalls only its stream.", show: { lesson: "head-of-line-blocking", focus: { link: ["u", "app"] } } },
  { key: "polling", name: "Polling", alias: "short polling", short: "Asking a server again and again whether anything new has happened. Most answers say no.", show: { lesson: "push-vs-poll", focus: { link: ["u", "app"] } } },
  { key: "websocket", name: "WebSocket", alias: "server push, server-sent events, long polling", short: "A connection kept open so the server can send news the moment it has some.", show: { lesson: "push-vs-poll", focus: { nodes: ["u"] } } },
  { key: "reconnect-storm", name: "Reconnect storm", alias: "thundering herd of reconnects", short: "Every client reconnecting in the same instant after a server drops them, swamping whatever is left.", show: { lesson: "push-vs-poll", focus: { nodes: ["app"] } } },
  { key: "layer-4", name: "Layer 4 balancer", alias: "L4, network load balancer, TCP proxy", short: "A balancer that forwards whole connections without reading them: fast, but blind to what's inside.", show: { lesson: "l4-vs-l7", focus: { nodes: ["lb"] } } },
  { key: "layer-7", name: "Layer 7 gateway", alias: "L7, API gateway, reverse proxy, application load balancer", short: "A front door that reads every request and routes it by path, header or user, at a small cost.", show: { lesson: "l4-vs-l7", focus: { nodes: ["lb"] } } },
  { key: "heartbeat", name: "Heartbeat", alias: "keepalive, ping/pong", short: "A small message sent on a timer so silence becomes a signal: no answer means something is wrong.", show: { lesson: "heartbeats", focus: { link: ["u", "lb"] } } },
  { key: "dns", name: "DNS", alias: "Domain Name System, resolver", short: "The internet's phone book: it turns a name like example.com into the address of a server.", show: { lesson: "dns", focus: { nodes: ["root", "tld", "auth"] } } },
  { key: "ack", name: "Acknowledgement", alias: "ack", short: "A small reply that only says “got it”. Without one, a sender can't know a message arrived.", show: { lesson: "acknowledgements", focus: { link: ["u", "r"] } } },
  { key: "retransmit", name: "Retransmission", alias: "resend", short: "Sending a message again because its ack didn't arrive in time.", show: { lesson: "acknowledgements", focus: { nodes: ["u"] } } },
  { key: "at-most-once", name: "At-most-once delivery", short: "A message is handled once or not at all: nothing is repeated, but some can be lost.", show: { lesson: "delivery-guarantees", focus: { metric: "Jobs lost" } } },
  { key: "at-least-once", name: "At-least-once delivery", short: "A message is handled until someone confirms it: nothing is lost, but some run twice.", show: { lesson: "delivery-guarantees", focus: { nodes: ["q"] } } },
  { key: "exactly-once", name: "Exactly-once processing", short: "At-least-once delivery plus a receiver that ignores repeats, so each message has its effect once.", show: { lesson: "delivery-guarantees", focus: { metric: "Jobs done twice" } } },
  { key: "visibility-timeout", name: "Visibility timeout", short: "How long a queue hides a job it handed out. Unacked by then, the job is handed out again.", show: { lesson: "delivery-guarantees", focus: { nodes: ["q"] } } },
  { key: "backpressure", name: "Back-pressure", alias: "backpressure, flow control", short: "A full queue pushing back on its producer, which waits instead of piling on more.", show: { lesson: "backpressure", focus: { nodes: ["q"] } } },
  // Foundations
  { key: "worker", name: "Worker", alias: "thread, connection", short: "One request a server can work on at a time. A server has a fixed number, drawn as sockets.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], sockets: true } } },
  { key: "queue", name: "Queue", alias: "waiting line, backlog", short: "Requests waiting their turn because every worker is busy. Waiting is most of what “slow” means.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], dots: "waiting" } } },
  { key: "latency-target", name: "Latency target", alias: "SLO", short: "The response time a system promises. A request still going after it runs late, drawn amber.", show: { lesson: "latency-and-throughput", focus: { dots: "late" } } },
  { key: "p95", name: "p95", alias: "95th percentile", short: "The time 95 of every 100 requests beat. Said plainly: the slowest 1 in 20 take this long or longer." },
  { key: "capacity", name: "Capacity", alias: "throughput ceiling", short: "The most a part can finish each second: its workers divided by the time each request takes.", show: { lesson: "latency-and-throughput", focus: { nodes: ["app"], sockets: true } } },
  { key: "round-robin", name: "Round robin", short: "A balancer giving each server the next request in turn, whatever it is doing.", show: { lesson: "load-balancing", focus: { nodes: ["lb"] } } },
  { key: "health-check", name: "Health check", alias: "probe, ping", short: "A small request a balancer sends each server to see if it still answers.", show: { lesson: "health-checks", focus: { nodes: ["lb"] } } },
  { key: "sticky-session", name: "Sticky session", alias: "session affinity", short: "A balancer sending each user to the same server every time, usually because their session lives there.", show: { lesson: "stateless-vs-stateful", focus: { nodes: ["lb"] } } },
  { key: "stateless", name: "Stateless server", short: "A server that keeps nothing about users between requests, so any server can serve anyone.", show: { lesson: "stateless-vs-stateful", focus: { nodes: ["store"] } } },
  { key: "availability", name: "Availability", alias: "uptime, SLI", short: "The share of requests answered well and on time, over a long window such as a month.", show: { lesson: "nines-and-error-budgets", focus: { metric: "Answered on time" } } },
  { key: "error-budget", name: "Error budget", alias: "SLO budget", short: "The failures a target still allows: 99.9% over a month leaves about 43 minutes.", show: { lesson: "nines-and-error-budgets", focus: { metric: "Error budget left" } } },
  // Caching
  { key: "hit", name: "Cache hit", short: "The cache had a copy, so the answer came back without asking the database.", show: { lesson: "caching", focus: { nodes: ["cache"] } } },
  { key: "miss", name: "Cache miss", short: "The cache had no copy: the read goes on to the database, and the answer is kept for next time.", show: { lesson: "caching", focus: { nodes: ["cache"], link: ["cache", "db"] } } },
  { key: "eviction", name: "Eviction", alias: "LRU", short: "A full cache drops the copy it used least recently, to make room for a new one.", show: { lesson: "caching", focus: { nodes: ["cache"] } } },
  { key: "edge", name: "Edge", alias: "CDN edge, point of presence", short: "A cache close to users. Many of them together make a content delivery network (CDN).", show: { lesson: "cdn", focus: { nodes: ["e-as"] } } },
  { key: "stale-read", name: "Stale read", short: "An answer from a copy that is older than the latest write.", show: { lesson: "stale-data", focus: { dots: "stale" } } },
  { key: "ttl", name: "Time to live", alias: "TTL, expiry", short: "How long a cached copy may be used before it must be fetched again.", show: { lesson: "stale-data", focus: { nodes: ["cache"] } } },
  { key: "invalidation", name: "Invalidation", alias: "purge", short: "Deleting a cached copy as soon as the source changes, so the next read fetches it fresh." },
  { key: "thundering-herd", name: "Thundering herd", alias: "cold start, restart storm", short: "Everyone acting at the same instant, like every read missing an empty cache: a spike nothing was sized for.", show: { lesson: "cold-caches-and-herds", focus: { link: ["c", "db"] } } },
  { key: "cache-warming", name: "Cache warming", alias: "pre-warming, priming", short: "Loading a cache with what users will ask for before it takes their traffic.", show: { lesson: "cold-caches-and-herds", focus: { nodes: ["c"] } } },
  { key: "stampede", name: "Cache stampede", alias: "thundering herd", short: "Many requests missing on the same popular item at once and rushing the database together.", show: { lesson: "cache-stampede", focus: { nodes: ["db"], dots: "waiting" } } },
  { key: "coalescing", name: "Request coalescing", alias: "single-flight", short: "Letting one miss fetch an item while the others for the same item wait for its answer.", show: { lesson: "cache-stampede", focus: { nodes: ["cache"] } } },
  { key: "penetration", name: "Cache penetration", short: "Requests for things that don't exist: they miss every time and all reach the database.", show: { lesson: "negative-caching", focus: { link: ["cache", "db"] } } },
  { key: "negative-cache", name: "Negative caching", short: "Keeping a “not found” answer for a short while, so the same missing id isn't looked up again.", show: { lesson: "negative-caching", focus: { nodes: ["cache"] } } },
  { key: "existence-check", name: "Existence check", alias: "Bloom filter", short: "A compact list of every id that exists. It answers “no” at once, and “maybe” when unsure.", show: { lesson: "negative-caching", focus: { nodes: ["cache"] } } },
  // Data
  { key: "connection-pool", name: "Connection pool", alias: "pool, PgBouncer", short: "A few connections kept open and lent out to requests, instead of opening one per request.", show: { lesson: "connection-pools", focus: { nodes: ["a1", "a2"] } } },
  { key: "failover", name: "Failover", alias: "promotion, switchover", short: "Making a replica the new primary when the primary dies, so writes can carry on.", show: { lesson: "failover", focus: { nodes: ["r1"] } } },
  { key: "quorum", name: "Quorum", alias: "W and R, majority", short: "How many copies must answer before a write or read counts. W + R > N means they always overlap.", show: { lesson: "quorums", focus: { nodes: ["co"] } } },
  { key: "split-brain", name: "Split brain", alias: "two leaders", short: "A cut network leaving a leader on each side, both taking writes: two versions of the truth.", show: { lesson: "leader-election", focus: { nodes: ["a"] } } },
  { key: "consensus", name: "Consensus", alias: "Raft, Paxos, majority vote", short: "Copies agreeing by majority vote on one leader and one order of writes, so a cut can't make two.", show: { lesson: "leader-election", focus: { nodes: ["a", "b", "c"] } } },
  { key: "double-booking", name: "Double booking", alias: "race condition, lost update", short: "Two requests each checking that something is free, then both taking it, because neither saw the other.", show: { lesson: "locks-and-double-booking", focus: { nodes: ["seats"] } } },
  { key: "compare-and-set", name: "Compare-and-set", alias: "CAS, conditional write, optimistic locking", short: "A write that succeeds only if the value is still what it was when read; otherwise it is refused.", show: { lesson: "locks-and-double-booking", focus: { nodes: ["seats"] } } },
  { key: "replica", name: "Replica", alias: "read replica, secondary", short: "A copy of a database that takes the primary's writes a moment later and answers reads.", show: { lesson: "read-replicas", focus: { nodes: ["r1"] } } },
  { key: "replication-lag", name: "Replication lag", short: "The moment between a write landing on the primary and its copy reaching a replica.", show: { lesson: "read-replicas", focus: { dots: "stale" } } },
  { key: "shard", name: "Shard", alias: "partition", short: "One database's slice of the keys, when the data is split across several by key.", show: { lesson: "sharding", focus: { nodes: ["d1", "d2", "d3"] } } },
  { key: "consistent-hashing", name: "Consistent hashing", alias: "hash ring", short: "Placing keys and nodes on a ring, so a node joining or leaving moves only its neighbours' keys.", show: { lesson: "consistent-hashing", focus: { nodes: ["router"] } } },
  { key: "leader", name: "Leader", alias: "primary", short: "The one copy that decides: every write goes through it, and the others follow.", show: { lesson: "consistency-vs-availability", focus: { nodes: ["dbUS"] } } },
  { key: "table-scan", name: "Table scan", alias: "full scan", short: "Reading every row of a table to find the ones you want. Its cost grows with the table.", show: { lesson: "indexes", focus: { nodes: ["db"] } } },
  { key: "index", name: "Index", alias: "B-tree", short: "A sorted structure that points straight at rows by a column's value. Reads get fast; writes do a little more.", show: { lesson: "indexes", focus: { nodes: ["db"] } } },
  // Async
  { key: "load-multiplier", name: "Load multiplier", alias: "retry amplification", short: "Attempts sent for every real request. Each retry adds one, so retries push it above ×1." },
  { key: "ghost", name: "Ghost request", short: "Work still waiting in a server's line for a user who already gave up. Serving it helps nobody.", show: { lesson: "retries-and-backoff", focus: { nodes: ["svc"], dots: "gaveup" } } },
  { key: "backoff", name: "Exponential backoff", alias: "backoff", short: "Wait before retrying, and wait twice as long after each failure." },
  { key: "jitter", name: "Jitter", short: "A random part of each wait, so clients that failed together don't all retry at the same instant." },
  { key: "retry-budget", name: "Retry budget", short: "A cap on retries, such as one for every ten requests, so retries can't swamp a struggling service." },
  { key: "backlog", name: "Backlog", short: "Work waiting on a queue for a worker. It grows when jobs arrive faster than they are done.", show: { lesson: "message-queues", focus: { nodes: ["q"] } } },
  { key: "pub-sub", name: "Publish/subscribe", alias: "pub/sub", short: "Announcing an event once; every service that listens gets its own copy.", show: { lesson: "publish-subscribe", focus: { nodes: ["topic"] } } },
  { key: "idempotency-key", name: "Idempotency key", short: "A unique id a client sends with an operation and reuses on every retry, so the server does it once.", show: { lesson: "idempotency", focus: { nodes: ["u"] } } },
  { key: "poison-message", name: "Poison message", alias: "poison pill", short: "A message that fails every time it's handled, so retrying it never helps.", show: { lesson: "dead-letter-queues", focus: { nodes: ["q", "w"] } } },
  { key: "dead-letter-queue", name: "Dead-letter queue", alias: "DLQ", short: "A side queue for messages that failed too many times, kept for a person to inspect.", show: { lesson: "dead-letter-queues", focus: { nodes: ["dlq"] } } },
  { key: "dual-write", name: "Dual write", short: "Writing the same change to two systems one after the other. If the second write fails, they disagree.", show: { lesson: "outbox", focus: { nodes: ["app"] } } },
  { key: "outbox", name: "Transactional outbox", alias: "outbox pattern", short: "Saving an event in the same transaction as the data, then relaying it, so it can't be lost.", show: { lesson: "outbox", focus: { nodes: ["db"] } } },
  { key: "consumer-lag", name: "Consumer lag", short: "How far a log's readers are behind its writers: events waiting to be read.", show: { lesson: "partitioned-logs", focus: { nodes: ["q"], dots: "waiting" } } },
  { key: "partition", name: "Partition", alias: "shard of a log", short: "One slice of a log. Events with the same key always land in the same partition, in order.", show: { lesson: "partitioned-logs", focus: { nodes: ["p1", "p2", "p3"] } } },
  { key: "consumer-group", name: "Consumer group", short: "Readers sharing a log's partitions, one reader per partition, rebalancing when one leaves.", show: { lesson: "partitioned-logs", focus: { nodes: ["p2", "c3"] } } },
  { key: "saga", name: "Saga", alias: "compensating transaction", short: "A multi-step job where each step has an undo, run in reverse when a later step fails.", show: { lesson: "sagas", focus: { nodes: ["orders"] } } },
  // Resilience
  { key: "token-bucket", name: "Token bucket", alias: "rate limit", short: "Each client earns tokens at a steady rate up to a small store; each request spends one.", show: { lesson: "rate-limiting", focus: { nodes: ["lim"] } } },
  { key: "circuit-breaker", name: "Circuit breaker", short: "Stops calling a failing dependency for a while after repeated failures, then tests it with one call.", show: { lesson: "circuit-breakers", focus: { nodes: ["shop"] } } },
  { key: "load-shedding", name: "Load shedding", alias: "admission control", short: "Turning some requests away at once when overloaded, so the ones you keep are still served on time.", show: { lesson: "load-shedding", focus: { nodes: ["app"] } } },
  { key: "bulkhead", name: "Bulkhead", alias: "pool isolation", short: "A separate pool of workers for one kind of work, so a slow dependency can't take them all.", show: { lesson: "bulkheads", focus: { nodes: ["app"], sockets: true } } },
  { key: "cascade", name: "Cascading failure", alias: "domino failure", short: "One part fails, its load lands on the others, and they fail too, one after another.", show: { lesson: "cascading-failures", focus: { nodes: ["s2", "s3", "s4"] } } },
  { key: "headroom", name: "Headroom", alias: "N+1 capacity", short: "Spare capacity, so losing one server leaves enough for everyone.", show: { lesson: "cascading-failures", focus: { metric: "Answered" } } },
  { key: "tail-latency", name: "Tail latency", alias: "p99, stragglers", short: "The slowest few percent of responses. When a page waits on many servers, the tail becomes the usual case.", show: { lesson: "hedged-requests", focus: { metric: "Page within" } } },
  { key: "hedged-request", name: "Hedged request", alias: "speculative retry, backup request", short: "A second copy of a request, sent once the first is late. The first answer wins; the other is cancelled.", show: { lesson: "hedged-requests", focus: { nodes: ["page"] } } },
  // Operating
  { key: "canary", name: "Canary release", alias: "canary deployment", short: "Sending a small share of traffic to a new version first, so a bad one hurts only a few users.", show: { lesson: "canary-rollouts", focus: { nodes: ["c"] } } },
  { key: "rollback", name: "Rollback", short: "Going back to the previous version. Automatic when a canary's errors pass a limit.", show: { lesson: "canary-rollouts", focus: { nodes: ["lb", "c"] } } },
  { key: "draining", name: "Draining", alias: "graceful shutdown, connection draining", short: "A server leaves the rotation, finishes the work it has, and only then stops.", show: { lesson: "graceful-shutdown", focus: { nodes: ["s1", "s2", "s3"] } } },
];

export const GLOSSARY: ReadonlyMap<string, Term> = new Map(TERMS.map((t) => [t.key, t]));

export function termOf(key: string): Term | undefined {
  return GLOSSARY.get(key);
}
