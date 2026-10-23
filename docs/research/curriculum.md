<!-- Research report, 2026-10-22. Produced by a curriculum research agent for the v3 plan (docs/plan-v3.md). Codes here are working codes; M5 assigns the final display codes. Nothing here is implemented yet; the plan decides what ships and when. -->

# System Lab: curriculum roadmap (research and catalog proposal)

Date: 2026-10-22. Research only.

**Repo files read:**
- `README.md` and `docs/plan.md`
- `src/lib/lessons/{types,kit,index,caching,resilience,capstone,foundations,data,async}.ts`
- `src/lib/sim/{types,metrics}.ts`
- the node behaviours in `src/lib/sim/engine.ts`
- `tests/lessons.test.ts`

**What the tests require today:**
- 19 entries.
- Two figures per lesson, with tones `problem,fix`, `problem,explore` or `tradeoff,tradeoff`.
- At most 2 knobs and 4 metrics per figure, and captions under 60 words.
- Every non-explore second figure beats the first by more than 8% on `fix.metrics[0]`.

## 0. Summary

- **Today:** 18 lessons on 5 lines, plus 1 capstone.
  - All 18 stay.
  - The Data line is renumbered (old D1–D4 become D2–D5) so a beginner "Indexes" lesson can come first.
  - Slugs, and therefore URLs and localStorage visit records, don't change.
- **Proposed: 8 lines.**
  - N · Networking (new, 18 lessons, graded beginner to advanced, centred on request, response and acknowledgement)
  - F · Foundations (7)
  - C · Caching (9)
  - D · Data (14)
  - A · Async (10)
  - R · Resilience (11)
  - O · Operating (4, new, SRE-flavoured)
  - ★ Stories: the existing capstone plus 8 new multi-stage stories
- **Counts:** 73 concept lessons are specified.
  - 41 are P1 (18 existing and 23 new), 16 are P2 and 16 are P3.
  - The recommended build is **P1 + P2 = 57 lessons**, which is inside the 45–60 target even with the Networking line.
  - P3 is a backlog of variants and deep dives.
- **The engine capabilities stories need most often:**
  - NC11 + NC12: queue ack semantics (ack on receive vs ack when done, visibility timeout, redelivery, attempt count, dead-letter queue, worker crash mid-job) plus idempotency-key dedupe on a server. They appear in 6 of the 8 new stories.
  - NC27: a lock/lease node with a TTL and a conditional write (S1, S5, and the double-booking lessons).
  - NC8: held connections with push fan-out (long-poll, SSE, WebSocket), for S2, S3, N11 and N12.
  - Each story still needs one or two other capabilities, listed per stage in section 4.
- **Topics that can't be shown as moving dots** are flagged and kept out of P1:
  - back-of-envelope estimation, SQL vs NoSQL, B-tree vs LSM
  - monitoring and alerting, tracing UI
  - TLS cryptography, NAT, IP addressing and BGP
  - clock skew, CRDT/OT merging
  - Each either gets an `explore` figure with a computed panel, or stays as a sentence in a neighbouring lesson.

## 1. Research

### 1.1 What canonical curricula cover, and in what order

| Source | Sequence (as published) | What it tells us |
|---|---|---|
| System Design Primer (donnemartin), https://github.com/donnemartin/system-design-primer | Performance vs scalability → latency vs throughput → availability vs consistency (CAP, CP/AP) → consistency patterns (weak, eventual, strong) → availability patterns (fail-over, replication, "availability in numbers") → DNS → CDN (push/pull) → load balancer (active-passive, active-active, L4/L7, horizontal scaling) → reverse proxy → application layer (microservices, service discovery) → database (RDBMS: master-slave, master-master, federation, sharding, denormalisation, SQL tuning; NoSQL: key-value, document, wide-column, graph) → cache (where; cache-aside, write-through, write-behind, refresh-ahead) → asynchronism (message queues, task queues, back pressure) → communication (TCP, UDP, RPC, REST) → security → appendix (powers of two, latency numbers). Exercises: Pastebin/Bit.ly, Twitter timeline and search, web crawler, Mint, social graph, KV store for search, Amazon sales rank, scaling to millions on AWS. | This is the de facto ordering. Against it, we're missing DNS, L4/L7 and reverse proxies, fail-over, consistency patterns (quorum), cache write policies, back pressure and TCP/UDP basics. |
| ByteByteGo "System Design 101", https://github.com/ByteByteGoHq/system-design-101 | API and web: polling/SSE/WebSocket, LB use cases, gRPC, HTTP/1 → 2 → 3, reverse proxy vs API gateway vs LB, webhooks, pagination. Database and storage: read replica, locking, delivery semantics, Kafka, isolation levels, CDC, B-tree vs LSM, sharding, CAP, consistent hashing. Caching: CDN, eviction, "cache miss attack", "how can cache systems go wrong", latency numbers. Payments: "how to avoid double payment", reconciliation, "hotspot accounts". Cloud and distributed: idempotency, failure detection, retry strategies, distributed lock, unique ID. "How it works": email, chat, Google Docs, maps, stock exchange, notifications. | It confirms the interview canon. It also names the failure modes people search for: cache miss attack, double payment, hotspot accounts, "can Kafka lose messages". |
| Alex Xu, *System Design Interview* vol. 1 and 2. Ch. 1: https://bytebytego.com/courses/system-design-interview/scale-from-zero-to-millions-of-users. KV chapter: https://bytebytego.com/courses/system-design-interview/design-a-key-value-store. Chapter lists: https://www.goodreads.com/book/show/204607255-system-design-interview-an-insider-s-guide | **Vol. 1 ch. 1:** single server → separate DB → vertical vs horizontal → LB → DB replication → cache → CDN → stateless web tier → data centres → message queue → logging/metrics/automation → sharding. **Vol. 1, rest:** back-of-envelope, interview framework, then rate limiter, consistent hashing, KV store, unique ID, URL shortener, web crawler, notification system, news feed, chat, autocomplete, YouTube, Google Drive. **Vol. 2:** proximity, nearby friends, Google Maps, distributed message queue, metrics monitoring, ad-click aggregation, hotel reservation, email, S3-like storage, gaming leaderboard, payment, digital wallet, stock exchange. | Chapter 1 is literally a 12-stage story, which makes it the template for the stories line. The KV chapter supplies the quorum rules D8 uses: "If W + R > N, strong consistency is guaranteed" and "Usually N = 3, W = R = 2". It also covers sloppy quorum, hinted handoff, gossip failure detection and Merkle anti-entropy. |
| Grokking the System Design Interview (DesignGurus), https://www.designgurus.io/course/grokking-the-system-design-interview | **Trade-offs chapter:** latency vs throughput; horizontal vs vertical; proxy vs reverse proxy; CDN vs direct; LB vs API gateway; token bucket vs leaky bucket; stateful vs stateless; REST vs RPC; sync vs async; push vs pull; polling vs long-polling vs WebSockets vs webhooks; batch vs stream; SQL vs NoSQL; ACID vs BASE; strong vs eventual; primary-replica vs peer-to-peer; read- vs write-heavy; cache-aside/read-through/write-through/write-back. **Problems:** TinyURL, Pastebin, Instagram, Dropbox, Messenger, Twitter, YouTube, typeahead, rate limiter, Twitter search, crawler, newsfeed, Yelp, Uber, Ticketmaster. **Glossary:** LB algorithms, proxies, caching, indexes, partitioning, consistent hashing, replication, CAP, PACELC, quorum, leader and follower, heartbeat, checksum, Bloom filters, long-polling vs WebSockets vs SSE. | The trade-offs chapter is a ready-made list of tradeoff-pair lessons. Heartbeat, quorum, leader/follower, Bloom filters and indexes are all missing from our catalog today. |
| Educative "Grokking Modern System Design", https://www.educative.io/courses/grokking-the-system-design-interview | **Building blocks:** DNS, load balancers, databases, KV store, CDN, sequencer, monitoring, distributed cache, messaging queue, pub-sub, rate limiter, blob store, search, logging, task scheduler, sharded counters. **Problems:** YouTube, Quora, Maps, Yelp, Uber, Twitter, newsfeed, Instagram, TinyURL, crawler, WhatsApp, typeahead, Google Docs, deployment system, payment system. | "Building blocks, then problems" has the same shape as "lines, then stories". DNS is their first block. |
| Hello Interview: https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction and https://www.hellointerview.com/learn/system-design/core-concepts/networking-essentials | **Core concepts:** networking essentials, API design, data modelling, caching, sharding, consistent hashing, CAP, indexing, numbers to know. Networking essentials covers layers, DNS, TCP vs UDP, HTTP/REST/gRPC, SSE/WebSockets/WebRTC, L4 vs L7, health checks, timeouts, backoff with jitter, idempotency keys and circuit breakers. **Patterns:** real-time updates, dealing with contention, multi-step processes, scaling reads, scaling writes, large blobs, long-running tasks. **Breakdowns:** Bitly, Dropbox, Gopuff, Ticketmaster, FB news feed, Tinder, LeetCode, WhatsApp, rate limiter, YouTube, live comments, Top-K, Uber, crawler, ad-click aggregator, post search, Yelp, Instagram, Strava, distributed cache, auction, job scheduler, news aggregator, price tracker, notifications, Robinhood, Google Docs, payment, metrics monitoring, chess, ChatGPT, flash sale. **Numbers:** same region is under 1 ms; New York to London is about 80 ms in practice and 56 ms in theory. | This is the most current interview-oriented list. Its patterns map onto our lessons: contention to D10, multi-step processes to A9, scaling writes to A7/A8/D3, long-running tasks to N15/A5. |
| *Designing Data-Intensive Applications* (Kleppmann; 2nd edition with Riccomini, O'Reilly 2026): https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/ch01.html, .../ch08.html, .../ch13.html | **1st edition:** reliability/scalability/maintainability → data models → storage and retrieval → encoding → replication → partitioning → transactions → the trouble with distributed systems → consistency and consensus → batch → stream. **2nd edition, confirmed:** ch. 1 "Trade-offs in Data Systems Architecture", ch. 8 "Transactions", ch. 13 "A Philosophy of Streaming Systems". | Replication → partitioning → transactions → consensus is our Data line's order (D2 → D3/D4 → D10 → D9). The batch and stream chapters justify A7 and A8. |
| Google SRE book: https://sre.google/sre-book/table-of-contents/, https://sre.google/sre-book/handling-overload/, https://sre.google/sre-book/addressing-cascading-failures/, https://sre.google/sre-book/availability-table/ | **Principles:** risk, SLOs, toil, monitoring, release engineering. **Practices:** frontend and datacenter load balancing. **Handling overload:** per-customer limits; client-side throttling once requests reach about 2× accepts; four criticality levels; utilisation signals; at most 3 attempts per request; a per-client retry budget of about 10%; retry at one layer only. **Cascading failures:** overload, resource exhaustion, queue management, load shedding and graceful degradation, deadlines and their propagation, bimodal latency, slow startup and cold caching, and triggers (process death, rollouts, organic growth). **Availability table:** 99% = 3.65 days/yr, 99.9% = 8.76 h, 99.99% = 52.6 min, 99.999% = 5.26 min. | Source for R4, R7, R8, N13, O1, O2 and F6. |
| AWS Well-Architected: https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html and https://docs.aws.amazon.com/wellarchitected/latest/framework/reliability.html | Six pillars: operational excellence, security, reliability, performance efficiency, cost optimisation, sustainability. Reliability's best-practice areas are foundations, workload architecture, change management and failure management. Its design principles include automatic recovery, testing recovery, scaling horizontally, stopping guessing capacity, and managing change through automation. | These map to F2, R3, O1, O2 and D7. |
| roadmap.sh, https://roadmap.sh/system-design | The page FAQ lists databases, CDNs, load balancers, caches, proxies, queues, web/app servers, search, logging and monitoring, and scaling. I couldn't retrieve the node data file, so the exact order isn't reproduced. | Same canon as the Primer. |
| MIT 6.824/6.5840 (2025), https://pdos.csail.mit.edu/6.824/schedule.html | MapReduce → RPC and threads → GFS → Paxos → Raft (×2) → linearizability → ZooKeeper → distributed transactions → Spanner → chain replication → optimistic concurrency (FaRM) → verification → Memcached at Facebook → AWS Lambda → Ray → SUNDR → Bitcoin → BFT. Labs: MapReduce, KV server, Raft, KV on Raft, sharded KV. | This is the advanced spine: D9 (Raft), D8 (linearizability and quorums), D10/D12 (transactions, OCC), C7/C8/R8 (Memcache paper), and R3 warm-up (Lambda). |
| Kleppmann's 8-lecture Cambridge *Distributed Systems*: https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf (index at https://www.classcentral.com/course/youtube-distributed-systems-lecture-series-53062) | RPC → system models (two generals, Byzantine generals, fault tolerance) → physical and logical time → broadcast → replication and quorums → consensus and Raft → 2PC, linearizability, eventual consistency → collaboration software and Spanner. | "Two generals" is the theory behind N2. Quorums come before Raft, matching D8 → D9. |
| YouTube. Gaurav Sen's playlist (26 videos, per https://learnwithpath.com/blog/is-gaurav-sen-enough-to-learn-system-design and https://www.designgurus.io/answers/detail/best-youtube-channels-and-podcasts-for-system-design-interview-tutorials). Jordan Has No Life (playlist index not retrievable; sample video https://yt.chop.dev/en/v/bwt09KXDH94). | Gaurav Sen covers load balancing, consistent hashing, sharding, CAP and queues, then case studies (Instagram, WhatsApp, Netflix). Jordan's deeper "2.0" sequence is only known second-hand: replication, consensus, 2PC, Kafka/Flink, LSM, CRDTs. I couldn't verify it. | This audience wants LB → consistent hashing → sharding → CAP → queues first, which is our beginner and intermediate band. |

**Cross-source observations:**

- **Every curriculum opens with the same six:** latency vs throughput, vertical vs horizontal, load balancing, caching, replication and sharding. We already have all six. The new on-ramp work comes *before* them (networking, the anatomy of a request), and the growth comes *after* them.
- **There's a consensus second ring:**
  - CAP and consistency patterns, queues and pub/sub, rate limiting, CDN
  - DNS, L4/L7, indexes, cache write policies
  - idempotency, back pressure, fail-over, quorum, leader election, transactions and locks
  - We cover five of these today.
- **Transport-level ideas are the most dot-shaped topics in the field**, yet they're missing from the interview curricula. That makes the Networking line a differentiator rather than a detour.
  - Acks, retransmission, windows, congestion and handshakes are the heart of Stanford CS144 (https://cs144.github.io/). Its lectures include "Reliability from unreliability", "TCP I", and "Why/What/How congestion control".
  - The same ideas are the chapter 3 interactives of Kurose and Ross (https://gaia.cs.umass.edu/kurose_ross/interactive/):
    - rdt 2.2 and 3.0
    - "TCP sequence and ACK numbers, with segment loss"
    - "TCP RTT and timeout"
    - "TCP congestion window evolution"
    - "TCP retransmissions (reliable data transmission with ACK loss)"

### 1.2 The most-taught real-world problems, their components and failure modes

Taught by: Xu1/Xu2 = Alex Xu vol. 1/2, GR = Grokking, ED = Educative, HI = Hello Interview, PR = Primer.

| Problem | Taught by | Canonical components | Canonical failure modes (what the dots must show) |
|---|---|---|---|
| URL shortener / Pastebin | Xu1, GR, ED, HI, PR | ID generator, write API, read-heavy redirect path, cache, replicas, rate limiter | hot link, miss storm, bot abuse, DB at 100% (the current capstone) |
| Rate limiter | Xu1, GR, ED, HI | token bucket or sliding window, shared counter store, gateway placement | limits too tight hurt users; per-server counters multiply the limit; counter-store latency |
| Chat (WhatsApp, Messenger). https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp | Xu1, GR, ED, HI | WebSocket servers behind an L4 LB; pub/sub or a registry routing to the server holding a user; message store; per-recipient inbox of undelivered messages; client ACK clears the inbox; heartbeats | chat-server crash causing a reconnect thundering herd; silently dead TCP connections; pub/sub is "at most once", so write durably first; duplicates; ordering |
| News feed | Xu1, GR, ED, HI, PR | fan-out on write to inbox caches vs fan-out on read; fan-out queue; ranking; a celebrity hybrid | celebrity write amplification, hot keys, slow ranking dependency |
| Video (YouTube, Netflix) | Xu1, GR, ED, HI | upload → queue → transcoding workers → renditions → object store → CDN, with adaptive bitrate | premiere stampede at the edge, origin overload, region outage, thin client bandwidth |
| Web crawler. https://www.hellointerview.com/learn/system-design/problem-breakdowns/web-crawler | Xu1, GR, ED, HI, PR | frontier queue (SQS), fetchers, DNS cache, parser, blob store, URL and content dedupe, per-domain politeness (about 1 req/s, robots.txt) | dead or slow sites; worker crash mid-fetch (visibility timeout); synchronised retries (add jitter); crawler traps (depth cap 15–20); DNS bottleneck; dead-letter after 5 tries |
| Typeahead | Xu1, GR, ED | trie or prefix index, top-k per prefix, cache | mostly a data structure. **Flagged.** |
| Notification system | Xu1, HI | a queue per channel, workers, provider limits, retries, dedupe | provider down, duplicates, retry storms |
| Key-value store / distributed cache | Xu1, ED, HI, PR | ring, N replicas, W/R quorum, vector clocks, gossip, hinted handoff | stale reads with small quorums, node loss, hot keys, resharding |
| Dropbox / Google Drive | Xu1, GR, HI | chunked upload, pre-signed URLs, metadata DB, sync queue, hash dedupe | large blobs through the app tier. Partly dot-shaped. |
| Ticketmaster / hotel / flash sale / auction. https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster | GR, HI, Xu2 | event service, seat-map cache, booking service, DB with row locks or OCC, Redis lock `SET NX EX` with TTL, virtual waiting queue (sorted set), SSE seat updates | double booking; lock expiry mid-payment; herd at sale open; webhook retries need idempotency |
| Uber. https://www.hellointerview.com/learn/system-design/problem-breakdowns/uber | GR, ED, HI | location ingest (10M drivers every 5 s ≈ 2M writes/s), in-memory geo store, matcher, per-driver lock (10 s TTL), notifications, queue partitioned by region | double assignment; driver doesn't respond (timeout, then next driver); peak drops; stuck locks after restart; stale locations; FIFO head-of-line blocking |
| Proximity / Yelp / Maps / nearby friends | Xu2, GR, ED, HI | geohash or quadtree, hot-cell caching, pub/sub of locations | the spatial index isn't dot-shaped (**flagged**); region sharding is |
| Ad-click aggregation / metrics. https://www.hellointerview.com/learn/system-design/problem-breakdowns/ad-click-aggregator | Xu2, HI | click processor, Kafka sharded by AdId, Flink event-time windows, OLAP upserts, raw archive plus reconciliation, signed impression-id dedupe | hot ads (salted AdId:0–N), processor crash and replay, out-of-order events, duplicates when the dedupe cache fails |
| Payment / wallet. Idempotency: https://docs.stripe.com/api/idempotent_requests | Xu2, HI, ED | payment service, PSP with webhooks, ledger, idempotency keys (the same key returns the saved response; kept at least 24 h; use V4 UUIDs), outbox, reconciliation | double charge on retry, PSP timeout or hang, dual-write loses events, multi-step order needs compensation |
| Leaderboard / Top-K | Xu2, HI | sorted set, stream aggregation | hot key, windowed counts |
| Live comments. https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-live-comments | HI | comment service; pub/sub to SSE servers; L7 LB hashing on video id; replay by Last-Event-ID; sampling or CDN snapshots for huge streams | polling waste (rejected), per-server connection limits, disconnect replay, hot-video fan-out |
| Collaborative editing | ED, HI | OT/CRDT, WebSocket fan-out, snapshots | merging isn't dot-shaped (**flagged**); the fan-out is |
| Stock exchange / Robinhood | Xu2, HI | matching engine, sequencer, market-data fan-out | ordering and latency. Partly dot-shaped. |
| Message queue / email / object storage / unique ID / job scheduler | Xu2, ED, HI | replicated log, retention, consumer groups; scheduler; sequencer | log replication and consumer lag are dot-shaped; ID generation isn't |

### 1.3 Beginner on-ramps

| Need | Source | Becomes |
|---|---|---|
| What a request and response are, and where the time goes (propagation, transmission, processing, queuing) | HPBN ch. 1, https://hpbn.co/primer-on-latency-and-bandwidth/. Light in fibre ≈ 200,000 km/s. NY–SF: 4,148 km, 21 ms one way, 42 ms RTT. NY–London: 28/56 ms. NY–Sydney: 80/160 ms. Last mile: 10–65 ms. "Latency, not bandwidth, is the performance bottleneck for most websites." Kurose and Ross ch. 1 interactives cover one-hop transmission delay, queuing delay and end-to-end delay. | N1, N4, F1 |
| Client/server loop, DNS, the HTTP lifecycle | Hello Interview networking essentials. MDN, https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_domain_name: local cache → DNS server → authoritative; answers are cached, then refreshed. Xu ch. 1. | N9, N7 |
| Latency numbers | https://gist.github.com/jboner/2841832: memory 100 ns, SSD 4 KB random 150 µs, datacenter round trip 500 µs, disk seek 10 ms, CA→NL→CA 150 ms | captions in N1, C1, D1 |
| Stateless vs stateful | Xu ch. 1 "stateless web tier"; Grokking trade-offs | F5 |
| What a database does, and indexes | Grokking glossary "Indexes"; Hello Interview "Database indexing" | D1 |
| Vertical vs horizontal | every source | F2 (exists) |
| Nines, SLOs, error budgets | SRE ch. 3–4 and Appendix A | F6 |
| Back-of-envelope estimation | Xu ch. 2, Grokking ch. 1, Educative | F7 (**flagged**: an explore panel) |
| How a system grows | Xu ch. 1, 12 steps | the shape of every story |

### 1.4 Networking sources behind the N line

**HPBN (Grigorik), https://hpbn.co/**
- **TCP** (https://hpbn.co/building-blocks-of-tcp/):
  - A handshake costs a full RTT before any data (56 ms NY–London).
  - The receive window: a zero window pauses the sender.
  - Slow start begins at 10 segments and doubles each RTT.
  - 64 KB over a new connection takes 264 ms, against 96 ms on a reused one.
  - AIMD halves the window on loss, which gives the "sawtooth".
  - Bandwidth-delay product = bandwidth × RTT. A 16 KB window at 100 ms caps throughput at about 1.31 Mbps, and filling 10 Mbps at 100 ms needs about 122 KB in flight.
  - Head-of-line blocking: one lost packet holds up the later ones.
- **TLS** (https://hpbn.co/transport-layer-security-tls/):
  - A full handshake adds 2 RTT (+112 ms in the example).
  - TLS 1.3 needs 1 RTT, and 0 RTT on resumption.
  - Session tickets and False Start bring it to "at most one extra roundtrip".
  - Terminating TLS at the edge shortens every handshake.
- **HTTP/1.x** (https://hpbn.co/http1x/):
  - Keep-alive saves (N−1)×RTT.
  - Pipelining is off in browsers because "a single slow response blocks all requests behind it".
  - Browsers open up to 6 connections per host.
  - Every sharded hostname costs a DNS lookup plus handshakes.
- **Ch. 15–17:** polling, long-polling, SSE, WebSocket.

**Cloudflare**
- HTTP/3, https://blog.cloudflare.com/http3-the-past-present-and-future/:
  - HTTP/1.1 serialises requests on each connection.
  - HTTP/2 multiplexes on one connection, but "all requests and responses are equally affected by packet loss".
  - QUIC streams "are delivered independently", and the transport and TLS 1.3 handshakes are combined.
- Anycast, https://blog.cloudflare.com/a-brief-anycast-primer/: one IP is announced from many sites and routed to the nearest; traffic fails over automatically when a site goes down, and DDoS load is spread.
- The learning-centre pages returned 403.

**Courses**
- Stanford CS144, https://cs144.github.io/: "Reliability from unreliability", TCP, "Why/What/How congestion control"; the labs build a TCP receiver and sender.
- Kurose and Ross interactives, https://gaia.cs.umass.edu/kurose_ross/interactive/:
  - ch. 1: delays and throughput
  - ch. 2: DNS iterative vs recursive, DNS and HTTP delays, browser caching
  - ch. 3: checksum, rdt 2.2/3.0, sequence/ACK with loss, RTT and timeout, cwnd evolution, retransmission with ACK loss

**Sam Rose (house style)**
- Retries, https://encore.dev/blog/retries: tight-loop retries crash servers; fixed delays; backoff from 0.5 s × 1.5; ±50% jitter.
- Queueing, https://encore.dev/blog/queueing: drops; bounded queue; hollow timed-out dots still get processed; FIFO vs LIFO; priority; RED/WRED. The author argues LIFO suits most HTTP workloads.
- Index: https://samwho.dev/.

**Julia Evans, "Networking! ACK!"**, https://wizardzines.com/zines/networking/: framed around "what happens when you download a picture?". The zine itself was too large to fetch, so I used it for tone only.

**Queues, deadlines and delivery**
- SQS visibility timeout, https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html:
  - A received message turns invisible; if it isn't deleted before the timeout, it reappears and is redelivered.
  - Default 30 s, maximum 12 h.
  - Delivery is at-least-once.
  - Long jobs heartbeat-extend the timeout.
  - A dead-letter queue catches messages after repeated failures.
- gRPC deadlines, https://grpc.io/docs/guides/deadlines/ and https://grpc.io/blog/deadlines/:
  - Without a deadline a client waits "effectively forever".
  - Java and Go pass the remaining time to outgoing calls by default.
  - The server is cancelled once the client's deadline passes and should stop its work.
- Reactive Manifesto, https://www.reactivemanifesto.org/glossary: backpressure, "since it can't cope and it can't fail it should communicate the fact that it is under stress to upstream components".
- Delivery semantics, https://blog.bytebytego.com/p/at-most-once-at-least-once-exactly: at-most-once loses messages; at-least-once duplicates them; "exactly once" in practice is at-least-once plus idempotent consumers.
- Kafka, https://kafka.apache.org/intro: the same key goes to the same partition, and a consumer of a partition "will always read that partition's events in exactly the same order".
- Patterns: https://microservices.io/patterns/data/transactional-outbox.html and https://microservices.io/patterns/data/saga.html.

### 1.5 The "is it dots?" test

A topic earns a lesson when something visibly does one of these, so the Without/With table actually moves:
- queues, travels, races or fails
- copies, splits or expires
- is turned away

Topics that fail the test are marked **FLAG**.

## 2. Engine capability map

**In the engine today** (`src/lib/sim/types.ts`, `engine.ts`):
- **Clients:** constant or time-varying rate, keys, Zipf skew, hot share, writes, heavy requests, timeout, retry (none/now/backoff with a budget), tag.
- **lb:** round-robin, random, least, hash and ring; health probes; autoscaler.
- **server:** slots, serviceMs, queueMax, sequential per-op calls, blocking workers, callTimeoutMs, breaker, sink/worker, down mode refuse/hang.
- **cache:** LRU, TTL, coalesce, delete-on-write.
- **db:** replicaOf + lagMs, peer/leader CP/AP, regions under a partition.
- **Others:** queue, topic, limiter.
- **Scene and controls:** link latencies and labels, scripts, `setUp`, `setPartition`, `expire`, `reconfigure`.
- **Metrics:** p50/p95, errors, rejected, stale, fallback, throughput, hit, util, peak, load, inRotation, queue, servers, moved, amplify, conflicts, answered, jobWait, unsynced.

**New capabilities.** The lesson tables refer to these by ID.

| ID | New capability | Used by |
|---|---|---|
| NC1 | Link model: per-link loss %, bandwidth (a dot's transmission time = size ÷ bandwidth, drawn as a stretched dot), a bounded link buffer with tail-drop, RTT jitter | N2–N6, N8, S7 |
| NC2 | Explicit ack dot back to the sender; retransmit timer (fixed or RTT-estimated); duplicate-delivery counter | N2, N3 |
| NC3 | Windowed sender: max in flight, receiver buffer and drain rate, zero-window pause, slow start, AIMD back-off on loss | N5, N6 |
| NC4 | Connection setup: 1–3 handshake RTTs per new connection, keep-alive, pool size, max connections on a server or db, 0-RTT resumption | N7, N8, N10, N11, D6, R8, S7 |
| NC5 | Connection modes: serial lanes (HTTP/1.1 × k), one multiplexed stream that stalls on loss (HTTP/2), independent streams (HTTP/3) | N8 |
| NC6 | A cached address that can go stale and point at a dead or moved node | N9, N18 |
| NC7 | L7 gateway (route by op/path/tag, per-request parse cost); L4 mode pins whole connections | N10, S2 |
| NC8 | Held connections and push: subscribe via long-poll/SSE/WebSocket, a connection cap per server, topic push to subscribers, reconnect storm after a crash | N11, N12, S2, S3 |
| NC9 | Heartbeats on a held connection (interval, misses allowed) | N12, D9, S2 |
| NC10 | Deadline propagation: a request carries its remaining budget; downstream work is cancelled once it's exceeded; "wasted work" metric | N13, R4, R9, S1, S5, S6, S8 |
| NC11 | Queue ack semantics: ack on receive vs ack when done, visibility timeout, redelivery, attempt count, dead-letter-queue node, worker crash mid-job, job failure outcome; "lost jobs" and "duplicates" metrics | N14, N15, A5, S1, S2, S4, S5, S6, S8 |
| NC12 | Idempotency-key dedupe on a server: key → saved result, replay within a window; "duplicate effects" metric | A4, S1, S2, S4, S6 |
| NC13 | Batching and pipelining: n logical requests in one dot costing f(n); pipelined send | N16, S5 |
| NC14 | Backpressure: on-full policy (drop newest, drop oldest, signal); a credit signal that throttles the producer | N17, S1, S4, S5, S8 |
| NC15 | Geo routing: nearest healthy region (anycast-like) vs a cached address with TTL; region health | N18, S2, S5, S7 |
| NC16 | Session state: per-server session memory lost on a crash; sticky-by-client balancing; a shared session store | F5 |
| NC17 | Index cost model: a db `rows` knob; scan cost grows linearly with rows, index lookup with log rows; each index adds write cost | D1 |
| NC18 | SLO metrics: availability over a long window, downtime clock, error budget remaining | F6 |
| NC19 | Derived-number panel beside the knobs (UI only) | F7 |
| NC20 | Cache write modes: write-through, write-behind with a dirty buffer that's lost on a crash, write-around | C5 |
| NC21 | LFU/2Q eviction and a sequential-scan client | C6 |
| NC22 | Non-existent keys, a negative cache, a Bloom-style existence check | C7, S8 |
| NC23 | Hot-key replication across cache shards | C8, S3 |
| NC24 | Failover: a detector promotes a replica (role change); sync vs async replication acks; "acknowledged writes lost" metric (built on `unsynced`) | D7, S0 stage 5 |
| NC25 | Quorum group: N copies, W and R acks, versioned values (staleness via the existing global write sequence) | D8 |
| NC26 | Consensus group: heartbeats, election timeout, votes, terms, majority; split-brain counter | D9 |
| NC27 | Lock/lease node: acquire/release with TTL, waiters, fencing token; conditional write (compare-and-set); "double bookings" metric | D10–D12, S1, S5 |
| NC28 | Outbox table in the db, relay publisher, publish-failure injection; "lost events" metric | A6, S6 |
| NC29 | Partitioned log: per-partition order, keyed routing, one consumer per partition, offsets; lag metric | A7, A8, S2, S3, S4 |
| NC30 | Stream processor: keyed windows, emits aggregates, late events, replay | A8, S4 |
| NC31 | Workflow/saga: multi-step with compensations on failure; "inconsistent orders" metric | A9, S6 |
| NC32 | Priority and shedding: a request priority tag; queue discipline FIFO/LIFO/priority; reject above a utilisation threshold; "timed-out work still processed" metric | R4, R7, S1, S5 |
| NC33 | Bulkheads: a separate worker pool per downstream | R5, S3 |
| NC34 | Overload crash: crash when the queue or utilisation stays above a threshold; restart delay; cold-restart ramp | R7, R8, N18, S5, S7 |
| NC35 | Scatter-gather and hedging: fan out to k and wait for all; hedge after a delay; cancel the loser | R9, D13, S3, S4 |
| NC36 | Versions and canary: per-server version with its own error rate and latency; weighted routing; rollout and rollback script | O1 |
| NC37 | Drain mode: stop new requests, finish in-flight, then stop; readiness gate | O2 |
| NC38 | Stale-on-error and refresh-ahead: serve an expired copy when the origin fails, or refresh before expiry (uses the existing `fallback` and `stale` results) | C9, R6, S3, S7 |

## 3. The catalog

**Column key:**
- Lvl: B / I / A.
- Pri: P1 must, P2 should, P3 could.
- Existing lessons show their old code in parentheses.
- "Engine today" names existing features the lesson uses.
- "New" names NC IDs.
- Prereqs use the new codes.

### 3.1 N · Networking (new line: request, response, acknowledgement)

| Lvl | Code | Slug | Title | Why | PROBLEM scene | FIX scene | Headline metric | Knobs | Fault button | Scripted event | Engine today | New | Prereqs | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B | N1 | request-and-response | A request and a response | Every click is a message out and a message back, and most of its time is travel, not work. | "Far away": one user, one server 5,000 km apart. Each dot spends about 90% of its life on the wire while the server idles. A wire/wait/work bar shows where the time went. | tone `explore`, "Where the time goes": round trip = 2 × one-way + work. Drag the server closer and the bar flips. | p50, with a wire/wait/work breakdown | distance (0–300 ms one way), server time | none | none | links, msPerUnit, linkLabels, p50 | per-request time breakdown in `done` records (small addition) | none | P1 |
| B | N2 | acknowledgements | Acknowledgements | A sender can't know a message arrived unless the receiver says so. | "Fire and forget": sender → receiver over a link that loses 5%. Sent and received counts drift apart and nobody notices. | "Ack and resend": the receiver returns a tiny hollow ack and the sender resends after a timer, so delivered reaches 100%. A lost *ack* means the receiver gets a message twice (duplicate marker). This is the "two generals" seed of A4. | delivered share (answered); duplicates | loss %, ack timer | "Cut the link for a moment" (burst loss) | none | client timeout plus retry "now" approximates the timer; answered, amplify | NC1, NC2 | N1 | P1 |
| I | N3 | retransmission-timers | Retransmission timers | Too short a timer floods the link with repeats; too long leaves it idle after a loss. | "Fixed timer": round trips vary, and a short fixed timer fires before the ack lands, so most messages are sent twice (load ×2). | "Timer from measured RTT": estimate the round trip plus a margin, and resend only on real loss. | load multiplier (amplify) | timer, RTT jitter | "Add jitter to the link" | none | amplify, retry | NC1, NC2 (adaptive timer) | N2 | P3 |
| B | N4 | latency-vs-bandwidth | Latency vs bandwidth | Bandwidth is how much per second; latency is how long until the first byte. They fail in different ways. | tone `tradeoff`, "Thin pipe": a 1 MB response over 10 Mb/s next door. The dot stretches into a stream. Double the bandwidth and the time halves; moving closer does nothing. | tone `tradeoff`, "Long pipe": a 2 KB response across an ocean. Time ≈ RTT. More bandwidth does nothing; moving closer halves it. Caption: bandwidth × RTT is the bandwidth-delay product. | transfer time (p50) | bandwidth, distance | none | none | links, heavy (size) | NC1 (bandwidth) | N1 | P1 |
| I | N5 | windows-and-flow-control | Windows and flow control | Waiting for each ack before sending the next leaves the pipe empty. A window keeps several messages in flight. | "One at a time" (stop-and-wait): one dot in flight, so throughput = 1 ÷ RTT (about 18/s at 56 ms) however fat the pipe. | "A window": N messages in flight, so throughput rises with N until bandwidth × RTT. Past that the receiver's buffer fills and it signals "zero window", or drops. | throughput | window size, receiver speed | "Slow the receiver" | none | throughput, queue | NC3 | N2, N4 | P1 |
| I | N6 | congestion-control | Congestion control | Many senders share one link. If everyone sends a full window, the buffer overflows and everyone loses. | "Everyone at full window": 4 senders feed a shared link with a small buffer. Overflow, loss and resends follow, and goodput collapses. | "Slow start, back off on loss": start at 1, double each RTT, halve on loss. You see the sawtooth; the link stays near full with little loss and roughly fair shares. FLAG: the fairness maths stays in the caption. | goodput; loss % | senders, link buffer | "Add a greedy sender (never backs off)" | none | throughput, load | NC1 (buffer), NC3 (AIMD) | N5 | P2 |
| B | N7 | handshakes-and-keep-alive | Handshakes and keep-alive | Before the first byte, TCP needs a round trip and TLS one or two more. Reusing the connection skips all of them. | "New connection per request": each dot does a 1–3 RTT handshake before carrying the request, so p50 ≈ 3–4 × RTT. Caption: UDP skips the handshake and the acks, which is why voice and games use it. | "Keep-alive and a pool": the first request pays the handshake and later ones reuse the open line. A knob for TLS cost and pool size. | p50 | TLS extra RTTs (0, 1 = TLS 1.3, 2 = TLS 1.2), pool size | "Restart the server" (every connection resets: a handshake storm) | none | links, p50 | NC4 | N1 | P1 |
| I | N8 | head-of-line-blocking | Head-of-line blocking and multiplexing | One connection doing one request at a time means a slow response blocks everything behind it. | "One lane per connection (HTTP/1.1)": 24 assets over 6 connections; one slow asset blocks its whole lane. | "Multiplexed": a choice of HTTP/1.1 × 6, HTTP/2 (one connection, interleaved, but one lost packet stalls every stream) or HTTP/3 (independent streams). A loss knob exposes HTTP/2's weakness. | page complete (p95) | protocol, loss % | none | "A packet is lost" (periodic) | heavy | NC1, NC4, NC5 | N7, N2 | P2 |
| B | N9 | dns | DNS: finding the server | Before any request, the name has to become an address. That lookup is its own round trips, and caching makes it vanish. | "Look it up every time": the browser node asks resolver → root → TLD → authoritative before the real request (about +100 ms). | "Cache the answer": a resolver cache with a TTL means one lookup, then none until it expires. The catch: move the server and cached answers point at the old address until the TTL runs out. | p50; errors after a move | TTL | "Move the server (new address)" | none | server sequential calls (browser → dns → app), cache TTL, `expire`, `setUp` | NC6 | N1 | P1 |
| I | N10 | l4-vs-l7 | L4 vs L7: balancers, proxies, gateways | A balancer can forward connections blindly, or read each request and route by what it asks for, at a cost. | "L4 pins connections": with keep-alive or WebSockets it spreads *connections*, not requests. Chatty connections pile onto one server, and `/pay` can't be sent to the payments pool. | "L7 gateway": reads each request, routes by path, and can retry and rate-limit. It costs a few ms per request and is a new hot spot (run two). | busiest server (peak); p95 | layer (L4/L7), gateway cost | "Crash the gateway" | none | lb algos, health, limiter | NC4, NC7 | F3, N7 | P2 |
| I | N11 | push-vs-poll | Long polling, SSE and WebSockets | When the server has news, the client either keeps asking or keeps a line open. | "Ask every second": 300 clients poll and about 95% of answers are "nothing new" (slate). The server is busy answering nothing, and news arrives half an interval late on average. | "Keep a line open" (long-poll / SSE / WebSocket): the server pushes the moment news arrives, and load drops. Each held line uses a socket, so a per-server cap forces fan-out through a topic to several push servers. | news delivered within (p95, event to client); server busy | mode, poll interval | "Crash the push server" (reconnect storm) | none | topic fan-out, util | NC4, NC8 | N7, A2 | P1 |
| I | N12 | heartbeats | Heartbeats and keepalives | A dead connection looks exactly like a quiet one. A heartbeat turns silence into a signal. | "Silence looks like quiet": push server 1 hangs while holding connections, and its clients wait forever (ghosts). | "Heartbeat": a tiny beat every X ms. After N misses the client declares the server dead and reconnects to a healthy one. Too eager flaps; too lazy waits. | answered share; p95 | interval, misses allowed | "Freeze server 1" | none | downMode hang, health probes (the balancer-side twin, F4) | NC8, NC9 | N11, F4 | P2 |
| I | N13 | timeouts-and-deadlines | Timeouts and deadline propagation | A request crossing three services needs one deadline, not three, or the back end keeps working for a client that has already left. | "Every hop its own clock": client 1 s, API 1 s, DB 1 s. The client leaves at 1 s but the chain works on for up to 3 s; ghosts hold workers and everyone slows down. | "One deadline travels": each hop gets the remaining time, and work past the deadline is cancelled. Wasted work drops to about zero. | wasted work (ghost share); p95 | client deadline, hops | "Slow the database" | none | callTimeoutMs, blocking, ghosts | NC10 | N1, F1 | P1 |
| I | N14 | sync-vs-async | Sync vs async: who acknowledges what | In request-reply the reply is the ack. With a broker, the broker's ack is a promise. | "Reply is the ack": client → A → B, blocking, so B's outage is A's outage. | "The broker acks": A hands the work to a queue and answers. A broker that acks before writing to disk loses jobs when it crashes (durable-ack knob). FLAG: mostly duplicates A1, so it's recommended as A1's opening caption unless built as the durable-ack variant. | errors during B's outage; lost jobs | durable ack (on/off) | "Crash the broker" | B outage loop | queue, crash | NC11 | A1, N2 | P3 |
| A | N15 | delivery-guarantees | At-most-once, at-least-once, exactly-once | If a worker dies mid-job, did the job happen? It depends on when the ack was sent. | "Ack on receive": a worker takes a job, acks, then crashes mid-job, and the job is gone (lost-jobs counter). | "Ack when done": with a visibility timeout, a crashed worker's job reappears and another worker finishes it. A slow job that outlives the timeout is delivered twice (duplicates), so consumers must be idempotent (A4). "Exactly once" = at-least-once + dedupe. | lost jobs; duplicates | visibility timeout, job time | "Crash worker 2 mid-job" | none | queue, workers, crash, jobWait | NC11 | N2, A1 | P1 |
| I | N16 | pipelining-and-batching | Pipelining and batching | Round trips are the expensive part, so send many requests per trip. | "One item per trip": a page needs 20 items and fetches them one by one (the N+1 problem): 20 serial round trips. | "One trip": batch the 20 into one request (a bigger dot, a bit more service time), or pipeline them (send all, answers stream back). | page assembled within (p95) | batch size, distance | none | none | heavy | NC13 | N1, N4 | P2 |
| A | N17 | backpressure | Backpressure | When a consumer can't keep up, the queue in front of it grows forever unless the producer is told to slow down. | "Unbounded queue": producer 50/s, consumer 30/s. Depth and latency climb, the memory bar fills, then everything is dropped at once. | "Bounded and signalled": a queue of 20. When it's full, drop newest, drop oldest, or slow the producer with credits. The system settles at 30/s with a short line. | p95 of delivered; queue depth | bound, policy | "Slow the consumer" | none | queue capacity (drops) | NC14 | N5, A1 | P1 |
| A | N18 | nearest-region-and-failover | Nearest region and failover | Send each user to the closest healthy region. When a region dies, the next one must absorb its users without drowning. | "One address, long TTL": DNS-style routing with a 5-minute TTL. Region A dies, and users keep going there until their cached address expires. | "Nearest healthy region": anycast-like, health-aware routing moves traffic in seconds. A headroom knob for region B: without spare capacity, B drowns (see R7). | answered share | TTL, headroom in B | "Take region A offline" | none | regions, links, partition, health, crash | NC6, NC15, NC34 | N9, C2, F4 | P2 |

**Networking topics flagged as not dots** (caption or recap only):
- TLS cryptography, certificates and the chain of trust (N7 shows the round trips, not the maths)
- NAT, IP addressing and subnets, BGP (N18 shows the effect of anycast, not the routing protocol)
- the OSI layer model itself (N1's caption names the layers)
- congestion-control fairness maths (N6)
- WebRTC/STUN/TURN
- checksums

**Covered by captions rather than their own lesson:**
- UDP (N7 caption)
- the bandwidth-delay product (N4 caption, demonstrated in N5)
- reverse proxy vs API gateway naming (N10)
- connection pools (N7 for HTTP, D6 for databases)

### 3.2 F · Foundations

| Lvl | Code | Slug | Title | Why | PROBLEM | FIX | Headline | Knobs | Fault | Script | Engine today | New | Prereqs | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B | F1 (F1) | latency-and-throughput | Latency and throughput | (existing) | one server, rising traffic | `explore`: workers ÷ time per request | p95 | traffic, workers | none | none | existing | none | N1 | P1 |
| B | F2 (F2) | scaling-up-vs-out | Scaling up vs scaling out | (existing) | one big server crashes | four small servers behind a balancer | errors | servers | crash | outage loop | existing | none | F1 | P1 |
| B | F3 (F3) | load-balancing | Load balancing | (existing) | each region stuck with one server | one balancer: round robin / random / least busy | p95 | strategy | none | none | existing | none | F2 | P1 |
| B | F4 (F4) | health-checks | Health checks and failover | (existing) | the balancer can't tell server 2 is dead | probes take it out after two misses | errors | check interval | crash server 2 | outage loop | existing | none | F3 | P1 |
| B | F5 | stateless-vs-stateful | Stateless servers and sessions | If a server keeps your session in its own memory, you're stuck with it, and you lose everything when it dies. | "Sticky sessions": the balancer pins each user to a server by id. Server 2 crashes and its users are logged out (red), and one server runs hotter than the rest. | "Shared session store": sessions live in a cache or db node, so any server can serve anyone. A crash costs capacity, not users. | errors (sessions lost) on a crash; busiest server | balancing (sticky / round robin) | "Crash server 2" | outage loop | lb hash, cache node as store, crash | NC16 | F2, F3 | P1 |
| B | F6 | nines-and-error-budgets | Nines, SLOs and error budgets | "Up" is a number: the share of requests answered on time. Every outage spends a budget. | "One server, occasional crashes": the gauge reads 99.0%, which the caption translates to about 14 minutes a day; a downtime clock accumulates. | "Two servers and health checks": 99.95%, so the budget is spent 20× more slowly. FLAG: semi-visual, since the lesson is the gauge and the dots repeat F2/F4. | availability over a long window; budget left | SLO target (99 / 99.9 / 99.99), crash frequency | "Crash server 1" | crash loop | answered, crash, health | NC18 | F2, F4 | P2 |
| B | F7 | back-of-envelope | Back-of-envelope estimation | A design starts with a number: how many requests a second, and how many machines that takes. | "Sized for the average": a fleet sized for a mean of 20/s drowns at the 3× peak. | tone `explore`, "Estimate, then watch": the panel shows daily users × requests ÷ 86,400 × peak and feeds the scene. The learner sizes servers ≈ rate × service time ÷ workers ÷ 0.6. FLAG: arithmetic, not dots. | p95 | daily users, peak multiplier | none | none | wave rate, util | NC19 | F1 | P3 |

### 3.3 C · Caching

| Lvl | Code | Slug | Title | Why | PROBLEM | FIX | Headline | Knobs | Fault | Script | Engine today | New | Prereqs | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B | C1 (C1) | caching | Caching | (existing) | every read hits the database | a cache in front | p95 | size | none | none | existing | none | F1, N9 | P1 |
| B | C2 (C2) | cdn | Content delivery networks | (existing) | origin only, across oceans | an edge cache per region | typical response | edge size | none | none | existing | none | N1, C1 | P1 |
| I | C3 (C3) | stale-data | Expiry and stale data | (existing) | copies never expire | TTL plus delete on write | stale reads | TTL, purge | none | none | existing | none | C1 | P1 |
| I | C4 (C4) | cache-stampede | Cache stampede | (existing) | a hot item expires and a crowd hits the DB | request coalescing | p95 | coalesce | none | none | existing | none | C3 | P1 |
| I | C5 | cache-write-strategies | Write-through, write-behind, cache-aside | Reads are easy to cache. What you do on a write decides staleness, write speed, and what a crash loses. | "Write-behind, no durability": writes are answered from the cache and flushed later. The cache crashes and the unflushed writes vanish (lost-writes counter). | "Write-through": every write goes to the cache and the DB before the answer. Slower writes, nothing lost. The choice also offers cache-aside. | lost writes; write p95 | strategy, flush interval | "Crash the cache" | crash loop | cache invalidate, writes | NC20 | C1, C3 | P2 |
| I | C6 | eviction-policies | Eviction: LRU vs LFU | A full cache has to throw something out, and which item it picks decides the hit rate. | "A report walks every row": a periodic sequential scan flushes the LRU cache's popular items, and hits collapse after each sweep. | "Frequency wins": with LFU (or 2Q), keys touched once never push out frequent ones. | hit ratio | policy, size | none | "Nightly report scans all items" | LRU, skew | NC21 | C1 | P3 |
| I | C7 | negative-caching | Misses that never hit | Requests for things that don't exist always miss the cache and always reach the database. | "Cache penetration": a bot asks for random missing ids, so every request misses and the DB searches for nothing. | "Remember 'not found'": a negative cache with a short TTL, or an existence check (Bloom-style) in front. The bot is turned away at the cache. | DB load; users' p95 | share of missing keys, negative TTL | none | none | bot client with tag | NC22 | C1, C4 | P2 |
| A | C8 | hot-keys | Hot keys and local caches | One key can be so popular that the single shard holding it melts, however many shards you add. | "One shard on fire": ten cache shards on a ring; a celebrity key puts one at 100% while the rest idle. | "A tiny cache in every server": a per-server L1 with a short TTL in front of the shared L2, or replicate the hot key to every shard. | busiest cache; p95 | hot share, L1 TTL | none | "A post goes viral" | hot, ring, per-server cache via sequential calls | NC23 | C1, D4 | P3 |
| I | C9 | refresh-ahead | Serve stale, refresh early | Instead of letting a hot item expire, refresh it before it does, and serve the old copy while you fetch. | "Hard expiry": C4's crowd at every expiry. | "Refresh ahead / stale-while-revalidate": one background fetch near expiry; readers get the old copy (briefly violet) and never wait. Recommended as a third option on C4's knob. | p95; stale reads | refresh lead time | none | none | TTL, coalesce | NC38 | C4 | P3 |

### 3.4 D · Data (renumbered: old D1–D4 are now D2–D5)

| Lvl | Code | Slug | Title | Why | PROBLEM | FIX | Headline | Knobs | Fault | Script | Engine today | New | Prereqs | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B | D1 | indexes | Indexes | Without an index the database reads every row to find one, and that work grows with the table. | "Table scan": a rows knob from 1k to 1M; each read takes longer as the table grows (dots linger in the cylinder) and throughput collapses. | "An index": lookup cost stays nearly flat (it grows with log rows). The catch: every write also updates each index, so writes cost more. | p95 | rows, write share | none | "The table doubles" | db slots/serviceMs | NC17 | F1 | P1 |
| I | D2 (D1) | read-replicas | Read replicas | (existing) | one database does everything | writes to the primary, reads from replicas, with lag | p95 | replicas, lag | none | none | existing | none | D1, C1 | P1 |
| I | D3 (D2) | sharding | Sharding | (existing) | every write lands on one database | hash to shards; celebrity knob | p95 | shards, celebrity | none | none | existing | none | D2 | P1 |
| I | D4 (D3) | consistent-hashing | Consistent hashing | (existing) | hash % N moves most keys | hash ring | hit ratio | none | none | node joins/leaves | existing | none | D3 | P1 |
| A | D5 (D4) | consistency-vs-availability | Consistency vs availability | (existing, tradeoff pair) | consistent: refuse when cut off | available: answer stale, conflicts later | answered | none | cut network | partition loop | existing | none | D2, N2 | P1 |
| I | D6 | connection-pools | Connection pools | Opening a DB connection costs a handshake, and a DB accepts only so many. A pool shares a few open lines. | "A connection per request": each request pays the handshake, and the DB refuses past its connection cap (red). | "A pool of N": requests borrow an open line and wait briefly for one, so the cap is never hit. A pool that's too small is the new bottleneck. | p95; errors | pool size, DB max connections | "Spike" | burst | heavy, queue | NC4 | N7, F1 | P2 |
| I | D7 | failover | Primary failover | Replicas copy the data, but when the primary dies someone has to promote one, and no writes land in the gap. | "No failover": the primary crashes; reads survive on replicas, writes fail for the whole outage. | "Automatic failover": heartbeats miss, a replica is promoted, writes resume. The catch: writes acknowledged but not yet copied are lost (the existing `unsynced` metric), unless replication is synchronous and therefore slower. | write errors; acknowledged writes lost | detection time, replication (async/sync) | "Crash the primary" | outage loop | replicaOf, lagMs, unsynced, health | NC24 | D2, F4 | P1 |
| A | D8 | quorums | Quorum reads and writes | With three copies, how many must agree before you answer? W + R > N guarantees a fresh read; smaller numbers are faster but may be stale. | "N = 3, W = 1, R = 1": fast, but a read right after a write can be stale (violet), and a write lives on one node only. | "W = 2, R = 2": no stale reads and survives one node down, at a higher p95. Try W = 3, and one crash stops writes. | stale reads; answered | W, R | "Crash replica 3" | none | stale detection (global write sequence), crash | NC25 | D2, D5 | P1 |
| A | D9 | leader-election | Leader election (Raft) | A group of copies needs one boss at a time. When it dies, the rest must agree on a new one without electing two. | "Fixed leader, or two": the leader crashes and writes stop until a human steps in. A naive "anyone can lead" setup ends with two leaders and conflicting writes under a partition. | "Consensus": followers miss heartbeats, time out and ask for votes; a majority elects a leader in about a second. The minority side of a partition can't elect, so there's no split brain. | write errors; conflicting writes | election timeout, group size (3/5) | "Crash the leader", "Cut the network" | partition loop | partition, region, conflicts | NC9, NC26 | D5, D7, N12 | P1 |
| A | D10 | locks-and-double-booking | Locks and double booking | Two people click "buy" on the last seat at the same moment. Without a lock, both succeed. | "Read, check, write": both read "available" and both write "sold"; the double-bookings counter climbs. | "Lock or compare-and-set": a lease per seat, or a conditional write. The second request waits or is turned away. | double bookings | hold time, shoppers per seat | none | "Sale opens" burst | hot key, writes | NC27 | F1, D3 | P1 |
| A | D11 | leases-that-expire | Leases that expire | A lock that's never released freezes everyone. A lock with a TTL can expire while its owner is still working. | "No TTL": the holder crashes and the seat is frozen forever. | "Lease with TTL": the crash frees the seat. But a slow holder that outlives the TTL means two holders, so the DB checks a fencing token. | frozen seats; double bookings | TTL, job time | "Crash the holder mid-job" | none | crash | NC27 (fencing) | D10, N15 | P3 |
| A | D12 | optimistic-vs-pessimistic | Optimistic vs pessimistic concurrency | Locking first is safe but slow. Checking a version at write time is fast until everyone collides. | tone `tradeoff`, "Pessimistic": lock, then work. Under low contention, time is wasted waiting. | tone `tradeoff`, "Optimistic": work, then compare the version. Under high contention there are many retries (amplify). | p95; retries | contention | none | none | retry, amplify | NC27 (CAS) | D10 | P3 |
| A | D13 | hot-partitions | Hot partitions and salting | A celebrity key melts one shard. Spread its writes over several, and gather them on read. | "One shard melts": D3's celebrity at 60%. | "Salt the key": writes go to key:0…k, and reads scatter-gather k shards. | busiest shard; read p95 | salt count | none | "A post goes viral" | hash router, hot | NC35 | D3 | P3 |
| A | D14 | storage-engines | B-tree vs LSM | Writes can be cheap now and expensive later, or the reverse. FLAG: only "buffer then flush in batches" can be shown; read amplification across levels can't. | "Write in place (B-tree)": every write seeks the disk (about 10 ms). | "Append, then compact (LSM)": writes land in memory and flush in batches; reads check several levels. | write p95; read p95 | memtable size | none | compaction loop | queue as buffer | caption-level only | D1 | P3 |

### 3.5 A · Async

| Lvl | Code | Slug | Title | Why | PROBLEM | FIX | Headline | Knobs | Fault | Script | Engine today | New | Prereqs | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B | A1 (A1) | message-queues | Message queues | (existing) | slow work while the user waits | queue and workers | p95 | workers | none | none | existing | none | F1 | P1 |
| I | A2 (A2) | publish-subscribe | Publish / subscribe | (existing) | the order service calls everyone | topic fan-out | p95 | none | crash analytics | outage loop | existing | none | A1 | P1 |
| I | A3 (A3) | retries-and-backoff | Retries and backoff | (existing) | retry at once | backoff, jitter, budget | succeeded | strategy | none | stall loop | existing | none | N2, F1 | P1 |
| I | A4 | idempotency | Idempotency keys | A retry is only safe if doing the thing twice has the same effect as doing it once. | "Charged twice": a payment request times out after the server has charged the card. The client retries and the customer pays twice (duplicate-charges counter). | "Remember the key": the client sends an idempotency key, and the server stores the result per key and replays it on a retry. | duplicate charges | timeout, key window | "Slow the payments service" | stall loop | retry, ghosts, writes | NC12 | A3, N2 | P1 |
| I | A5 | dead-letter-queues | Poison messages and dead-letter queues | A job that always fails gets retried forever and blocks the jobs behind it. | "A poison job": one job at the head of a FIFO queue always errors. The worker retries it endlessly while the backlog grows and good jobs wait. | "Max attempts, then the side queue": after N attempts the job moves to a dead-letter queue and the line moves again. | job wait (p95) | max attempts, poison share | "Inject a poison job" | none | queue, workers, jobWait | NC11 | A1, N15 | P1 |
| A | A6 | outbox | The outbox pattern | Saving to the DB and publishing an event are two writes. If the second fails, the world never hears about the first. | "Dual write": commit, then publish. The publish fails x% of the time (or the broker is down), so downstream never sees the order (lost-events counter). | "Write the event with the data": the event goes into an outbox table in the same transaction, and a relay publishes from it. It's at-least-once, so consumers dedupe (A4). | lost events | publish failure %, relay interval | "Crash the broker" | outage loop | topic, db, writes | NC28 | A2, A4 | P2 |
| A | A7 | partitioned-logs | Partitions, ordering and consumer groups | Splitting a log into partitions gives parallelism, with order kept only within a partition. A hot key makes one partition the bottleneck. | "One partition, one consumer": throughput is capped and lag grows. | "More partitions and a consumer group": one consumer per partition, and the same key always lands in the same partition, so per-key order holds. A skewed key leaves one partition lagging. | consumer lag; throughput | partitions, key skew | "Crash consumer 2" (rebalance) | none | queue, hash router, skew | NC29 | A1, D3 | P2 |
| A | A8 | stream-windows | Windows and aggregation | Counting clicks per ad per minute at scale means summing the stream as it flows, not updating a row per click. | "A row per click": every click increments a DB row, and the hot row saturates the DB. | "Aggregate in the stream": a processor sums per key per window and writes one row per window. Late events land in the right window, and it replays after a crash. | DB load; result freshness | window size, hot-ad share | "Crash the processor" (replay) | none | hot, db | NC29, NC30 | A7 | P2 |
| A | A9 | sagas | Sagas: multi-step work that fails halfway | An order touches payment, stock and shipping. If the third step fails, the first two must be undone. | "Three calls, no undo": step 3 fails, leaving money taken, stock reserved and nothing shipped (inconsistent-orders counter). | "Orchestrated saga": steps run in order, and on failure compensations run in reverse (refund, release). The catch: nothing is isolated while it runs. FLAG: moderately visual, with dots walking back along the chain. | inconsistent orders | step-3 failure rate | "Crash shipping" | outage loop | sequential calls, errors | NC31 | A6, D10 | P2 |
| I | A10 | scheduled-jobs | Scheduled jobs and the midnight burst | Every server running the same cron at the same minute is a self-inflicted spike. | "Midnight on every server": N servers fire the same job at once. | "One scheduler, spread out": a scheduler fans the jobs over a window, with jitter. | p95 at midnight | spread window | none | midnight loop | bursts, queue | script-driven only | A1, A3 | P3 |

### 3.6 R · Resilience

| Lvl | Code | Slug | Title | Why | PROBLEM | FIX | Headline | Knobs | Fault | Script | Engine today | New | Prereqs | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| I | R1 (R1) | rate-limiting | Rate limiting | (existing) | a scraper floods the API | a token bucket per client | users' p95 | limit | none | none | existing | none | F1 | P1 |
| I | R2 (R2) | circuit-breakers | Circuit breakers | (existing) | waiting on a hanging dependency | trip after failures, cool down | browsing p95 | cool-down | none | hang loop | existing | none | N13 | P1 |
| I | R3 (R3) | autoscaling | Autoscaling | (existing) | a fixed fleet | scale to a target utilisation | p95 | target busy | none | none | existing | none | F3, F4 | P1 |
| I | R4 | load-shedding | Load shedding and priority | When you can't serve everyone, choose who to fail, and do it early and fast. | "First come, all served late": under overload the FIFO line grows and everyone is slow; timed-out ghosts are still processed (wasted work). | "Shed early, serve what matters": a bounded line that rejects when busier than X (instant slate squares), with checkout ahead of browsing. LIFO and CoDel are options. | checkout p95; wasted work | shed threshold, discipline (FIFO/LIFO/priority) | "Traffic spike" | burst | queueMax, ghosts | NC10, NC32 | F1, N13 | P1 |
| I | R5 | bulkheads | Bulkheads | One slow dependency can eat every worker. Give each dependency its own pool. | "One pool for everything": recommendations slow down, their calls hold every worker, and checkout starves. | "A pool per dependency": the recommendations pool fills while the checkout pool is untouched. | checkout p95 | pool split | "Slow recommendations" | stall loop | blocking workers, calls | NC33 | R2 | P1 |
| I | R6 | fallbacks | Fallbacks and graceful degradation | When a part is down, a worse answer beats no answer. | "Down means error": recommendations are down and the page fails. | "Serve the stale copy": the breaker's fallback reads the last cached answer (violet, not red). Recommended as a knob on R2 unless it's built separately. | errors | stale allowed | "Crash recommendations" | outage loop | breaker fallback, cache | NC38 | R2, C3 | P3 |
| A | R7 | cascading-failures | Cascading failures | One server dies, its load lands on the others, and they die too. | "Dominoes": four servers at 80%. One crashes, the other three hit about 107% and crash from overload, and restarts come back cold and die again (crash loop). | "Headroom and shedding": N+1 at 60%, plus R4's shedding, plus a slow ramp on restart. The fleet bends and recovers. | answered share | utilisation target, shedding (on/off) | "Crash server 1" | none | crash, util, health | NC32, NC34 | R4, F2, R3 | P1 |
| A | R8 | cold-caches-and-herds | Cold caches and thundering herds | Anything that makes everyone act at the same instant creates a spike you never sized for. | "Cache restart": the cache comes back empty, every request misses, the DB drowns, and the app tier times out. | "Warm before serving, ramp slowly": pre-fill the cache, ramp traffic in at the balancer, and jitter client reconnects. | p95 during the restart; DB busy | warm-up share, ramp time | "Restart the cache" | restart loop | cache, coalesce, health, autoscale warm-up | NC4, NC34 | C1, C4, F4 | P2 |
| A | R9 | hedged-requests | Hedged requests: beating tail latency | When a page fans out to many servers, one straggler makes it slow. Send a backup request once the 95th percentile has passed. | "The tail at scale": a page fans out to 10 shards, each slow 5% of the time, so the page is slow about 40% of the time (1 − 0.95¹⁰). | "Hedge after X ms": a second copy goes to another replica, the first answer wins and the other is cancelled. p95 collapses for about 5% extra load. | p95; load multiplier | hedge delay, slow share | none | none | amplify, replicas | NC10, NC35 | F3, N13 | P2 |
| I | R10 | limiter-algorithms | Token bucket vs sliding window | Different limiters let different bursts through. Recommended as a third option on R1's knob. | "Fixed window": twice the limit gets through at the window edge. | "Sliding window / token bucket": smooth. | bot turned away; users' p95 | algorithm | none | none | limiter | limiter modes | R1 | P3 |
| I | R11 | distributed-rate-limits | Rate limits across many servers | A counter on each server multiplies the limit by the number of servers. | "Local counters": a 10/s limit across 4 servers lets 40/s through. | "Shared counter": a counter store costs an extra hop but enforces 10/s. | bot requests reaching servers | servers | none | none | limiter, lb | limiter with a shared store | R1, F3 | P3 |

### 3.7 O · Operating (new line)

| Lvl | Code | Slug | Title | Why | PROBLEM | FIX | Headline | Knobs | Fault | Script | Engine today | New | Prereqs | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| I | O1 | canary-rollouts | Canary rollouts | Every deploy is a change that can break things. Send 5% of traffic to the new version first. | "Deploy to everyone": v2 has a bug, every server flips at once, and errors hit 100% until rollback. | "Canary": v2 on one server in ten (or 5% of traffic). Errors stay near 5%, and it rolls back automatically when the canary's error rate exceeds the baseline. | errors | canary share, rollback threshold | none | "Deploy v2 (buggy)" loop | lb, health, errors | NC36 | F3, F4 | P1 |
| I | O2 | graceful-shutdown | Graceful shutdown and draining | Killing a server with requests in flight turns a deploy into an outage. | "Kill and restart": a rolling restart kills servers mid-request, with red diamonds at every restart. | "Drain": the balancer stops sending (readiness off), in-flight requests finish, then the process stops. | errors during deploys | drain time | none | rolling-restart loop | health, inRotation, crash | NC37 | F4 | P1 |
| I | O3 | headroom-and-n-plus-one | Headroom and N + 1 | Size capacity for the day one machine is missing at the peak. It overlaps R7. | "Exactly enough": N servers at the daily peak; lose one and the rest drown. | "N + 1 at 60%": lose one and nothing changes. | p95 at the peak with one server down | servers | "Crash one at the peak" | daily wave + crash | wave, crash, util | none | F2, R3 | P3 |
| I | O4 | tracing-a-request | Tracing a request | Where did the 800 ms go? Follow one request through every hop. FLAG: this is a stage feature (click a dot to see its waterfall), not a scene. | "A number with no story": p95 is bad and nobody knows which hop. | "A trace": one dot's waterfall of hops, with wire/wait/work per hop. | none (UI) | none | none | none | N1's per-request breakdown | dot picking and a waterfall panel (UI) | N1, N13 | P3 |

### 3.8 Networking prerequisites for existing lessons, and where the line sits

| Existing lesson | Networking prerequisite and why |
|---|---|
| F1 Latency and throughput | N1: a request is a trip, and the server is one stop on it. |
| C2 CDN | N1 and N4: the round trip is the cost a CDN removes. N7 adds the second reason: TLS and TCP end at the edge. |
| C1 Caching | N9: DNS is the first cache a beginner meets, with a TTL and a visible stale-after-change failure. |
| A1 Message queues | N15 and N17: A1's recap ("failures need retries and a place to land; the queue can grow without bound") is exactly what they show. |
| A2 Publish/subscribe | N11: fan-out to held connections is pub/sub's last mile. |
| A3 Retries and backoff | N2: acks come before retries. A retry is a retransmission one layer up, and the duplicate from a lost ack is why A4 exists. |
| R2 Circuit breakers | N13: timeouts and deadlines come before breakers. R2's `callTimeoutMs` is N13's per-hop timeout. |
| R1 Rate limiting | N10: shows where the limiter lives, at the L7 gateway. |
| F4 Health checks | N12: a probe is a heartbeat from the balancer's side; N12 is the client's side. |
| D5 Consistency vs availability | N18: region routing is what sends EU users to the EU copy in the first place. |
| R3 Autoscaling | N17: backpressure is the alternative to scaling the consumer. |

**Placement.** The Networking line runs as a spine through the path, not as one block:
- **Beginner band, opening the course:** N1, N4, N7, N9, N2.
- **Intermediate band, each just before the lesson it unlocks:** N13, N5, N17, N11, N15, N12.
- **Late band:** N10, N8, N16, N6, N18. Interview-focused learners can skip these.

## 4. Stories (multi-stage, like the URL shortener)

Each story reuses the capstone shell (`src/components/capstone.tsx`):
- an `Arch` the learner grows
- a brief per stage
- a target that must hold for N seconds
- a price per component, so the cheapest design that holds wins

Targets use the same form as the current capstone: p95 and error share for a tag.

**S0 (existing): Keep a URL shortener alive.** Keep it as is. With NC24, a fifth stage, "the primary dies" (promote a replica and hold the write target), becomes possible.

### S1 Sell 1,000 seats to 100,000 people (flash sale / ticketing)
Grows into: users → gateway + admission queue → seat-map service + cache → booking service → lock store → database → payments (external) → email queue.

| Stage | Traffic / failure | Target to hold | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 Tickets on sale, quietly | 20/s seat-map reads, 1/s bookings | p95 < 300 ms, errors < 1% | nothing yet: watch the DB | F1, C1 | none |
| 2 Doors open | 2,000/s reads at T+0, 200/s bookings | same | a seat-map cache; an admission queue (virtual waiting room) that lets bookings in at the rate the DB can take | C4, R1, R4, N17 | NC14, NC32 |
| 3 The last seats | 50 shoppers per remaining seat | double bookings = 0 | a lease per seat, or compare-and-set | D10, D11 | NC27 |
| 4 Payments hang | the provider hangs for 3 s at a time | checkout errors < 2%, browsing p95 holds | one propagated deadline, a breaker, a bulkhead, idempotency keys on retries, and a lease TTL longer than the payment deadline | N13, R2, R5, A4 | NC10, NC12 |
| 5 Confirmation emails | the email provider rejects 10% | every email sent once, queue wait < 5 s | an ack-when-done queue, backoff, a dead-letter queue | A1, N15, A3, A5 | NC11 |

### S2 Deliver every message once (chat)
Grows into: clients ↔ L4 balancer ↔ chat servers holding connections ↔ routing topic ↔ message store + per-recipient inbox.

| Stage | Traffic / failure | Target | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 A thousand users polling | 1,000 clients poll every second | delivered within 1 s, server busy < 70% | switch to push (WebSocket) | N11 | NC8 |
| 2 A million users | connections exceed one server's cap | everyone connected, delivery < 1 s | more push servers, a topic that routes to the right server, L4 balancing by connection | N10, A2 | NC7, NC8 |
| 3 A server dies | chat server 2 crashes and its clients go silent | answered > 99% within 10 s of the crash, no reconnect storm | heartbeats, jittered reconnect, an inbox for undelivered messages | N12, A3, N15 | NC9, NC11 |
| 4 Once, and in order | lost acks cause duplicates | duplicates = 0, per-chat order kept | client acks with an idempotent inbox; partition by chat id | A4, A7 | NC12, NC29 |
| 5 The ocean splits | EU and US are partitioned | EU-to-EU chat keeps working; cross-region messages queue and drain | AP for presence, queued cross-region delivery, region routing | D5, N18 | NC15 |

### S3 Build a news feed (fan-out on write vs on read)
Grows into: posts → fan-out queue → per-user inbox caches ↔ feed service ↔ ranking service, with live push.

| Stage | Traffic / failure | Target | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 Reading the feed | each feed read scatters to 200 followed authors | feed p95 < 400 ms | a recent-posts cache per author | C1, R9 | NC35 |
| 2 Fan-out on write | posts/s climb and reads are still slow | read p95 < 300 ms, post ack < 100 ms | a fan-out job queue writing into per-user inbox caches | A1, A2 | none |
| 3 A celebrity posts | one author with 10M followers | fan-out backlog drains in < 30 s, p95 holds | a hybrid (celebrities pulled at read time), hot-key local caches, partitions by author | C8, A7, D13 | NC23, NC29 |
| 4 Ranking hangs | the ranking service hangs | feed p95 holds (unranked fallback) | a bulkhead, a breaker, a chronological fallback | R5, R2, R6 | NC33, NC38 |
| 5 Live updates | users want new posts without refreshing | delivered < 2 s, server busy < 70% | SSE push with fan-out through a topic | N11 | NC8 |

### S4 Count a billion clicks (ad-click / metrics pipeline)
Grows into: click endpoints → partitioned log → stream processors (windows) → aggregates store ← dashboards.

| Stage | Traffic / failure | Target | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 A row per click | 2,000 clicks/s on one table | DB busy < 80% | shard the table, then find that a hot ad row still melts | D3 | none |
| 2 Aggregate in motion | 20,000 clicks/s | freshness < 1 min, DB load small | a log partitioned by ad id, windowed sums, one write per ad per minute | A7, A8 | NC29, NC30 |
| 3 The hot ad | one ad is 40% of clicks | busiest partition < 80% | salt the key and merge on read | D13 | NC35 |
| 4 A processor dies | processor 2 crashes mid-window | no lost counts, duplicates = 0 | replay from the log with ack-when-done, and an idempotent sink keyed by click id | N15, A4 | NC11, NC12 |
| 5 The store slows | the aggregates store runs at half speed | lag bounded, nothing dropped | bounded buffers that slow the consumers instead of dropping | N17 | NC14 |

### S5 Match a rider to the nearest driver (ride-hailing)
Grows into: driver apps → batched location ingest → in-memory location store sharded by city → matcher → driver offers; riders → ride service.

| Stage | Traffic / failure | Target | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 Location pings | 10k drivers ping every 5 s | ingest p95 < 100 ms | batched pings; an in-memory store instead of the DB | N16, C1 | NC13 |
| 2 Two riders, one driver | matching races at the peak | double assignments = 0 | a lease per driver with a TTL | D10, D11 | NC27 |
| 3 Drivers who don't answer | 30% of offers time out | time to match < 15 s | a deadline per offer, then the next driver, via a delay queue | N13, A5 | NC10, NC11 |
| 4 Friday night | demand is 5× supply | riders queued fairly; p95 of accepted offers holds | a priority queue plus backpressure to the rider app ("estimating wait") | N17, R4 | NC14, NC32 |
| 5 A region dies | region A goes offline | riders in A served from B within 10 s | nearest-healthy-region routing, with headroom | N18, R7 | NC15, NC34 |

### S6 Charge exactly once (payments)
Grows into: checkout → payment service → external PSP (webhooks back) → ledger DB with outbox → events to fulfilment and email.

| Stage | Traffic / failure | Target | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 The PSP is slow | PSP p95 2 s, occasional hangs | checkout p95 < 3 s, no stuck workers | timeouts with one propagated deadline | N13 | NC10 |
| 2 Retries double-charge | clients retry on timeout | duplicate charges = 0 | idempotency keys on the charge and on the webhook | A4 | NC12 |
| 3 PSP outage | the PSP refuses for 20 s | no lost orders; an instant "we'll retry" answer | a breaker, a queued charge with backoff, a dead-letter queue for hopeless cases | R2, A1, A3, A5 | NC11 |
| 4 Tell fulfilment | publishing fails 2% | lost events = 0 | an outbox and relay; idempotent consumers | A6 | NC28 |
| 5 Orders that span services | shipping fails after charge and stock | inconsistent orders = 0 | a saga with compensations | A9 | NC31 |

### S7 Serve a premiere to the world (video / CDN)
Grows into: upload → transcoding queue → renditions in object storage → origin → edge caches in three regions, routed to the nearest.

| Stage | Traffic / failure | Target | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 Upload and transcode | 50 uploads/min, 30 s each to transcode | upload ack < 200 ms, transcode wait < 2 min | a queue and workers; renditions fanned out via a topic | A1, A2 | none |
| 2 The premiere | 100× viewers across 3 regions | typical response < 150 ms per region | edge caches, TLS ending at the edge, keep-alive to the origin | C2, N7 | NC4 |
| 3 Everyone at the same second | the manifest expires on every edge at once | origin requests < 50/s | coalescing plus an origin shield (two cache tiers), refresh-ahead | C4, C9 | NC38 |
| 4 Asia's edge dies | the Asia edge goes offline | Asia answered > 99% within 10 s | nearest-healthy routing, with headroom at the neighbouring edge | N18, R7 | NC15, NC34 |
| 5 Thin pipes | mobile viewers at 2 Mb/s | playable share > 95% | a lower-bitrate rendition chosen per client bandwidth (adaptive). FLAG: needs NC1, otherwise caption-only | N4 | NC1 |

### S8 Crawl the web politely
Grows into: frontier queue → fetchers → DNS cache → parser → seen-set → store, with per-domain limits.

| Stage | Traffic / failure | Target | Learner adds | Lessons | New caps |
|---|---|---|---|---|---|
| 1 Fetch everything | seed URLs explode into a frontier | pages/s above target, queue bounded | a frontier queue, N workers, backpressure on the parser | A1, N17 | NC14 |
| 2 Be polite | one site gets 200/s and bans you | ≤ 1/s per domain, throughput holds | a limiter per domain tag, a DNS cache | R1, N9 | none |
| 3 Dead and slow sites | 10% of sites hang | workers busy < 80%, none stuck | timeouts, backoff, dead-letter after 5 attempts | N13, A3, A5 | NC10, NC11 |
| 4 Duplicates | 60% of links have already been seen | wasted fetches < 5% | a seen-set / existence check before the queue | C7 | NC22 |
| 5 A worker dies mid-fetch | fetcher 3 crashes | lost URLs = 0 | ack-when-done with a visibility timeout | N15 | NC11 |

**Which capabilities unlock the most stories:**
- NC11 + NC12 (queue acks, visibility timeout, dead-letter queue, idempotency dedupe) appear in S1, S2, S4, S5, S6 and S8.
- NC10 (deadline propagation) appears in S1, S5, S6 and S8.
- NC27 (lock/lease) appears in S1 and S5, and powers the double-booking lessons.
- NC8 (held connections and push) appears in S2 and S3, and powers N11 and N12.
- Building NC11, NC12, NC10 and NC27 first completes S6 stages 1–3, S8 stages 2, 3 and 5, and S1 stages 1, 3 and 5. Each story then needs one or two more capabilities, listed per stage.

## 5. Recommended learning path (beginner → advanced)

Codes use the new numbering, and lines are interleaved. Times assume 4/7/10 minutes per B/I/A lesson.

**Band 1: a request and a server** (beginner, 15 lessons, about 70 min)
- N1 request and response → N4 latency vs bandwidth → F1 latency and throughput → N7 handshakes and keep-alive → N9 DNS
- F2 scaling up vs out → F3 load balancing → F4 health checks → F5 stateless servers
- C1 caching → C2 CDN → D1 indexes → A1 message queues → N2 acknowledgements → F6 nines and error budgets
- F7 estimation is optional here.

**Band 2: the classic interview core** (intermediate, 24 lessons, about 2.5 h)
- N13 timeouts and deadlines → N5 windows and flow control → N17 backpressure
- C3 stale data → C4 stampede → D2 read replicas → D3 sharding → D4 consistent hashing
- A2 pub/sub → N11 push vs poll → A3 retries and backoff → N15 delivery guarantees → A4 idempotency → A5 dead-letter queues
- R1 rate limiting → R2 circuit breakers → R3 autoscaling
- D6 connection pools → D7 failover → N12 heartbeats → R4 load shedding → R5 bulkheads → O1 canary rollouts → O2 graceful shutdown
- Story S0 (URL shortener) is playable after this band.

**Band 3: distributed data, streams and real time** (advanced, 18 lessons, about 2.5 h)
- N10 L4 vs L7 → N8 head-of-line blocking → N16 batching → C5 write strategies → C7 negative caching → N6 congestion control
- A7 partitioned logs → A8 stream windows → A6 outbox
- D5 consistency vs availability → D8 quorums → D9 leader election → D10 locks and double booking
- R8 cold caches → R9 hedged requests → N18 nearest region and failover → A9 sagas → R7 cascading failures
- Then the stories, in this order: S8 crawler, S7 video, S1 tickets, S6 payments, S2 chat, S3 feed, S5 rides, S4 clicks.

**Band 4: optional deep dives (P3):** N3, N14, C6, C8, C9, D11, D12, D13, D14, A10, R6, R10, R11, O3, O4.

**Fast lane for interview prep:** F1–F4, C1–C4, D2–D5, D8, D10, A1–A5, R1–R4, O1, then stories S0, S1, S2 and S3.

## 6. Difficulty and time tag scheme

Add these fields to `Lesson`, and to stories:

| Field | Values | Rule |
|---|---|---|
| `level` | `beginner`, `intermediate`, `advanced` | **beginner:** one new idea, one metric to read, prerequisites only from Band 1. **intermediate:** a trade-off with two knobs or a fault. **advanced:** a race, a partition, or a group of nodes acting together. |
| `minutes` | integer | Defaults: 4 (B), 7 (I), 10 (A); stories 15–25. Measured as the time to watch both figures settle and read the recap. |
| `kind` | `concept`, `story` | |
| `visual` | `dots`, `gauge`, `flagged` | **dots:** the Without/With table moves because of what you see. **gauge:** the lesson is a number (F6). **flagged:** needs an explore panel or a UI feature (F7, O4). |
| `prereqs` | codes | Shown as chips. The route map dims a lesson until its prerequisites are visited, using the existing localStorage visit list. |
| `tags` | strings | The search terms in section 7, plus the "seen in" product names. |

On the route map, each lesson gets a small B/I/A badge and shows its minutes on hover. Lines keep their letters, with N for Networking and O for Operating.

## 7. Ten concept names the audience will search for

Ranked by how consistently they appear across the section 1 curricula and as chapter titles in the interview books. Index the aliases too.

1. **Load balancer** (load balancing, round robin, least connections, L4/L7, reverse proxy, API gateway) → F3, N10
2. **Caching** (cache, Redis, Memcached, cache-aside, write-through, TTL, eviction, LRU) → C1, C3, C5, C6
3. **CDN** (content delivery network, edge, anycast) → C2, N18
4. **Rate limiting** (token bucket, sliding window, throttling, 429) → R1, R10, R11
5. **Message queue** (Kafka, RabbitMQ, SQS, pub/sub, consumer group, dead-letter queue) → A1, A2, A5, A7
6. **Sharding** (partitioning, hot partition, hot key, celebrity problem) → D3, D13, C8
7. **Consistent hashing** (hash ring, virtual nodes) → D4
8. **Replication** (read replica, primary/replica, failover, replication lag, leader election, Raft, quorum) → D2, D7, D8, D9
9. **CAP theorem** (consistency vs availability, eventual vs strong consistency, PACELC) → D5, D8
10. **Circuit breaker** (timeouts, retries, exponential backoff, jitter, idempotency, cascading failure) → R2, N13, A3, A4, R7

**Runners-up worth indexing:**
- WebSockets vs SSE vs long polling (N11)
- TCP handshake / keep-alive (N7)
- DNS (N9)
- acknowledgements / at-least-once / exactly-once (N2, N15)
- backpressure (N17)
- thundering herd / cache stampede (C4, R8)
- distributed lock / double booking (D10)
- autoscaling (R3)
- canary deployment (O1)
- SLO / error budget / nines (F6)
- outbox / saga (A6, A9)

## 8. Build order and trimming

**Engine, in order.** Each step unlocks a cluster of P1 lessons and story stages.
1. NC11 + NC12 (acks, visibility timeout, DLQ, dedupe)
2. NC10 (deadlines)
3. NC27 (lock/lease, CAS)
4. NC8 + NC9 (held connections, push, heartbeats)
5. NC32 + NC34 (priority/shedding, overload crash)
6. NC1 + NC2 + NC3 (link model, acks, windows)
7. NC4 + NC6 (handshakes, cached addresses)
8. NC24, NC25, NC26 (failover, quorum, consensus)
9. NC29 + NC30 (log, stream)
10. the rest

**If the catalog must stay at about 45–50:**
- Drop the P2 lessons N6, N8, N10, N16, C5, C7, D6, R8 and R9, and fold each one's key sentence into a neighbouring caption or recap.
- Keep all 41 P1 lessons, plus N12, N18, F6, A6, A7, A8 and A9, for **48 lessons**.

**Test changes this implies** (`tests/lessons.test.ts`):
- The `LESSONS.length === 19` count assertion has to change.
- Every proposed lesson already uses an allowed tone pair (`problem,fix`, `problem,explore`, `tradeoff,tradeoff`).
- The fix-beats-problem check only skips `explore`, so tradeoff pairs are tested too. Order N4 and D12 so the second figure wins on `metrics[0]`, or exempt them as D5 effectively is.
- Lessons whose headline is a new measure need new `MetricId` entries in `metrics.ts`, with a `better` direction, so the 8% guard keeps covering them:
  - lost jobs, duplicates, double bookings, lost events, lost writes
  - wasted work, acknowledged writes lost, inconsistent orders
  - goodput, the wire/wait/work breakdown
  - consumer lag, availability over a long window

**Renumbering:** only the Data line's codes change. Old D1–D4 become D2–D5. Slugs are untouched.

## 9. Sources

- https://github.com/donnemartin/system-design-primer
- https://github.com/ByteByteGoHq/system-design-101
- https://bytebytego.com/courses/system-design-interview/scale-from-zero-to-millions-of-users
- https://bytebytego.com/courses/system-design-interview/design-a-key-value-store
- https://www.goodreads.com/book/show/204607255-system-design-interview-an-insider-s-guide
- https://www.designgurus.io/course/grokking-the-system-design-interview
- https://www.educative.io/courses/grokking-the-system-design-interview
- https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction
- https://www.hellointerview.com/learn/system-design/core-concepts/networking-essentials
- https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster
- https://www.hellointerview.com/learn/system-design/problem-breakdowns/ad-click-aggregator
- https://www.hellointerview.com/learn/system-design/problem-breakdowns/whatsapp
- https://www.hellointerview.com/learn/system-design/problem-breakdowns/web-crawler
- https://www.hellointerview.com/learn/system-design/problem-breakdowns/uber
- https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-live-comments
- https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/ch01.html (also ch08.html, ch13.html)
- https://sre.google/sre-book/table-of-contents/
- https://sre.google/sre-book/handling-overload/
- https://sre.google/sre-book/addressing-cascading-failures/
- https://sre.google/sre-book/availability-table/
- https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html
- https://docs.aws.amazon.com/wellarchitected/latest/framework/reliability.html
- https://roadmap.sh/system-design
- https://pdos.csail.mit.edu/6.824/schedule.html
- https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf
- https://www.classcentral.com/course/youtube-distributed-systems-lecture-series-53062
- https://learnwithpath.com/blog/is-gaurav-sen-enough-to-learn-system-design
- https://www.designgurus.io/answers/detail/best-youtube-channels-and-podcasts-for-system-design-interview-tutorials
- https://yt.chop.dev/en/v/bwt09KXDH94
- https://gist.github.com/jboner/2841832
- https://hpbn.co/
- https://hpbn.co/primer-on-latency-and-bandwidth/
- https://hpbn.co/building-blocks-of-tcp/
- https://hpbn.co/transport-layer-security-tls/
- https://hpbn.co/http1x/
- https://blog.cloudflare.com/http3-the-past-present-and-future/
- https://blog.cloudflare.com/a-brief-anycast-primer/
- https://cs144.github.io/
- https://gaia.cs.umass.edu/kurose_ross/interactive/
- https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Web_mechanics/What_is_a_domain_name
- https://wizardzines.com/zines/networking/
- https://encore.dev/blog/retries
- https://encore.dev/blog/queueing
- https://samwho.dev/
- https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
- https://grpc.io/docs/guides/deadlines/
- https://grpc.io/blog/deadlines/
- https://www.reactivemanifesto.org/glossary
- https://blog.bytebytego.com/p/at-most-once-at-least-once-exactly
- https://kafka.apache.org/intro
- https://docs.stripe.com/api/idempotent_requests
- https://microservices.io/patterns/data/transactional-outbox.html
- https://microservices.io/patterns/data/saga.html

**Not retrievable in this session,** so nobody should assume they were checked:
- the roadmap.sh node data (404)
- the Cloudflare learning-centre pages (403)
- the full DDIA 2nd-edition table of contents
- the contents of Julia Evans' zine (file too large)
- the Jordan Has No Life playlist index