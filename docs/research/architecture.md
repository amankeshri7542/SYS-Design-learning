<!-- Research report, 2026-10-22. Produced by an engine/architecture review agent for the v3 plan (docs/plan-v3.md). Line references are to commit 47c5573. Nothing here is implemented yet; the plan decides what ships and when. -->

# System Lab at 60 lessons: engine, narration, catalog, build and test design

Research and design only. No repository file was edited by hand. Two working-tree side effects to know about (details in §0.3): `npm run build` regenerated `next-env.d.ts` (it now matches HEAD; the pre-existing uncommitted edit is gone), and an untracked `.playwright-mcp/` log directory appeared during the session from a Playwright MCP process that was not driven by this report's commands.

All paths are relative to `/Users/mackie/Codes /Tester_Ai/system-lab`. Line references are to the files as read on 2026-10-22.

---

## 0. Baseline: what exists and what was measured

### 0.1 The engine in one paragraph

`src/lib/sim/engine.ts` is a fixed-tick (`TICK = 2` ms, line 13) flow simulator. Requests (`Req`, 24-57) travel out along a stack of `Frame`s and retrace it back (`send` 590-600, `respond` 602-616, `arrive` 618-629). Per tick: scripted events (`runScript` 354-366), controllers every 10 ms (`control` 378-406: load smoothing, boot/drain, breaker cooldown, call timeouts, health probes, autoscaling), arrivals (`arrivals` 496-526), arrivals-at-node (`enter` 652-690 dispatching by kind: `route` 723-750, `limit` 752-765, `lookup` 767-796, `enqueue` 806-812, `publish` 814-817, `admit` 708-712), work (`start` 826-838, `finish` 857-867, `complete` 869-891 with sequential downstream `call`s 893-900, `dbDone` 902-931), return path (`back` 952-983), client timeouts (`timeout` 1047-1060, `retry` 1062-1079), and `prune` every 100 ticks (368-374). Randomness is per node (`mulberry32(seed ^ hashStr(id))`, 226) plus one `retryRng` (158). A client node's stream is consumed only in `arrivals`/`gap` (492-514), which is what makes "arrivals independent of downstream" true today. The global write sequence (`truth`, 153) decides staleness (926-928, 779). `reconfigure` (176-223) patches a running sim: removed nodes strand their requests through `unwind` (631-648).

Public surface used by lessons: `setUp`, `setPartition`, `expire`, `note`, `reconfigure`, `step`, `now`, plus the runtime maps that `metrics.ts` reads (`done`, `jobs`, `logical`, `attempts`, `nodes.*`).

### 0.2 Measured today

Build (`npm run build`, Next 16.3.7, Turbopack): "Compiled successfully in 686ms", TypeScript 722 ms, 23 static pages in 357 ms on 6 workers. The route table Next 16 prints has **no size columns** any more:

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /icon.svg
└   /learn/[slug]
  ├ ● /learn/latency-and-throughput
  ├ ● /learn/scaling-up-vs-out
  ├ ● /learn/load-balancing
  └ ● [+16 more paths]

○  (Static)  prerendered as static content
●  (SSG)     prerendered as static HTML (uses generateStaticParams)
```

So I measured the client bundle from the prerendered HTML and `.next/static/chunks`:

| Chunk (`.next/static/chunks/`) | raw | gzip | What it is | Loaded on |
|---|---:|---:|---|---|
| `39u3ld3zqxqqm.js` | 229.2 KB | 71.5 KB | React DOM + Next app runtime | every page |
| `2-rtuqsgzmno4.js` | 165.7 KB | 44.9 KB | Next client router/runtime | every page |
| `0-wkp2iifxj51.js` | 90.6 KB | 31.8 KB | **all 19 lessons + engine + stage + live + route map + legend** (one shared app chunk) | home **and** every lesson |
| `2g_h7vjv9b_z6.js` | 27.8 KB | 10.0 KB | `player.tsx` + `capstone.tsx` | lesson pages |
| `2k7a4xk5odshf.js` | 10.5 KB | 4.4 KB | hero | home |
| `19mx…`, `3fnt…`, `22i4…`, `310v…`, `turbopack-…` | 67 KB | 20.7 KB | runtime pieces | all |
| `0cz1d0mv5g_q7.js` | 112.6 KB | 39.4 KB | polyfills, served with `noModule` (skipped by modern browsers) | — |
| `3k6ztoz5umt8u.css` | 38.5 KB | 8.2 KB | `globals.css` | all |

Per route, excluding the `noModule` polyfill: **lesson page 580 KB raw / 179 KB gzip**; home 554 KB / 170 KB gzip. Fonts: 13 `woff2` files, 300 KB total (Overpass ×4 weights, Atkinson ×2, Overpass Mono ×2, plus fallbacks); three are preloaded (`.p.` files, ~95 KB).

Tests: `npm test` = 34 tests in 230 ms. `npm run tune` runs all 38 figures for 6 000 simulated ms in 0.34 s wall; each figure costs 1–4 ms. The simulator is therefore ~0.5 ms per 1 000 simulated ms per figure: test and tune budgets are not a concern at 60 lessons (the lesson-claim suite would still run in well under a second).

### 0.3 Working-tree notes

- `next-env.d.ts` was `M` (modified, uncommitted) at session start. `next build` regenerates this file; it now equals HEAD. The Next docs recommend `.gitignore`-ing it (`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md:204`), which would stop this churn.
- `.playwright-mcp/` (console logs and page snapshots, timestamps 12:05–12:17) is untracked and was produced by a Playwright MCP server, not by anything in this report. Add `.playwright-mcp/` to `.gitignore`.

---

## 1. Engine capability matrix

Legend: **✅ today** (expressible with current spec fields), **🔧 small extension** (new field + a hook in an existing code path, < ~60 lines), **🆕 new behaviour** (new node kind, new request lifecycle, or new runtime state machine). "Scene sketch" names kit helpers from `src/lib/lessons/kit.ts`.

### 1.1 Candidate concepts

| # | Concept | Status | Today's engine path | Scene sketch / what's missing |
|---|---|---|---|---|
| 1 | DNS + HTTP request lifecycle | 🔧 | Sequential `calls` from a server (`complete` 869-891, `call` 893-900); a `cache` node with `ttlMs` is a DNS cache (`lookup` 767-796, `fill` 1007-1023); link latency per hop via `links` (`latency` 580-588). | Browser(client) → "resolver" cache (`ttlMs` = DNS TTL) → origin. Missing: connection setup cost before the first request (→ N5 below) and a way to *follow one request* through the phases (→ beats §3). |
| 2 | Latency vs bandwidth | 🔧 | Latency only (`msPerUnit`, `links`). `heavy.cost` (types.ts:36) scales service time, not transfer. | Needs link capacity: `LinkSpec.parallel` (dots queue at the link start) and `perCostMs` (transfer time ∝ cost). Batch 1. |
| 3 | Stateless vs stateful sessions | ✅/🔧 | `algo: "hash"` on an lb keys by request key (`route` 740-743) = sticky by user; `setUp(false)` clears a node's `cache` (276) = sessions lost on crash. | Problem: sticky lb → servers each with their own session `cache` node (`calls.read: ["sess-s1"]`); crash server 2 → its users miss → fallback to db ("re-login"). Fix: one shared session cache. Metric `hit` works; a `lostSessions` count is polish. |
| 4 | Database indexes | 🔧 | `serviceMs` is per node, not per op (`service` 821-824). | `serviceBy: { read, write }` (index: reads 400 → 8 ms, writes +cost). Knob toggles. Batch 1. |
| 5 | Connection pooling | 🔧 | `blocking: true` holds a worker slot while waiting (898); db `slots`/`queueMax` approximate. | `pool: { to, size }` on the caller so waiting happens at the app (visible), plus connection setup cost (N5). Batch 2. |
| 6 | API gateway / reverse proxy | ✅ (+🔧) | `lb` + `health` + `limiter` + `cache` chain; glyphs `router`/`edge`. | Basic "one front door" works today. Path-based routing needs a request tag → target map (`lb.byTag`). Batch 1. |
| 7 | WebSockets / long-lived connections + fan-out | 🆕 | Requests are finite; `topic.publish` fans out detached clones (814-817) to *nodes*, not to connected clients. | `hold` servers keeping a `sub` request in a slot, pushes travelling back to clients (N9). Batch 2. |
| 8 | Timeouts and deadlines | ✅ (+🔧) | Client `timeoutMs` → ghost (`timeout` 1047-1060), server `callTimeoutMs` → `giveUp` 465-483, Fx `timeout`. | Missing deadline *propagation* and a "wasted work" metric (N8). Batch 1. |
| 9 | Load shedding and priority | 🔧 | `queueMax` drops the newest (`admit` 708-712); limiter rejects per tag. | `shed: { queueAbove, loadAbove, keep }` in `admit`; `priority: [tags]` in `start`. Batch 1. |
| 10 | Back-pressure | 🔧 | Queue `capacity` → errors when full (`enqueue` 806). | `backpressure: { high, low, mode: "wait" \| "reject" }`: park the producer (its worker slot stays held if `blocking`, so pressure propagates upstream) and release in `dispatch`. Overlaps N3. Batch 2. |
| 11 | Bulkheads | ✅/🔧 | Separate pools via separate client → server paths (F3 style). | True bulkhead = per-tag slot partitions on one server: `bulkheads: Record<tag, slots>` in `start`. Batch 1. |
| 12 | Idempotency keys / exactly-once | 🔧 | Retries re-spawn with the same key/op (`retry` 1062-1079, `spawn` 564-576); a retried write applies twice (`dbDone` 903-907). No stable logical id crosses attempts (`first` is a timestamp). | `Req.logicalId` carried through `pending`/`clone`/`giveUp`; `idempotent` receivers dedupe by it; metric `duplicates`. Batch 2 (shared with N2). |
| 13 | Dead-letter queues | 🔧 | A failed detached job is silently dropped (`fail` 701-704); a paused sink keeps jobs (661-665). | Queue ack modes, visibility timeout, redelivery count, DLQ target (N6). Batch 2. |
| 14 | Outbox pattern | 🆕 (medium) | Dual write is expressible: `calls.write: ["db", "topic"]` + a scripted server crash between the two (the db write already happened, the publish never does). | Not *measurable*: needs `unpublished` (committed writes whose seq never reached a subscriber) and the fix, a db `outbox` relay that drains in `control`. Batch 2. |
| 15 | Write-ahead log / durability | 🆕 | No durability model: writes are durable the instant `dbDone` runs; `setUp(false)` only clears caches. | `durability: { mode: "memory" \| "wal" \| "sync", flushEveryMs, fsyncMs }`, unflushed meter, lost writes on crash. Batch 4. |
| 16 | Leader election + heartbeats | 🆕 | `leader` is static (681-686); probes exist only lb→targets (408-429). | Cluster roles, terms, votes, randomised election timeouts from node rng. Batch 3 (heartbeat primitive from N7). |
| 17 | Quorum reads/writes (N/R/W) | 🆕 | Replication is async fan-out with lag (913-925); reads hit one replica. | A coordinator that fans out and waits for W acks / R replies ("fan-out-and-wait" primitive reusing `held` + `callTimeoutMs`). Batch 3. |
| 18 | Replication lag + read-your-writes | ✅ (+🔧) | D1 does lag today (`replicaOf`, `lagMs`, stale detection 926-928). | RYW: route a recent writer's reads to the primary for `forMs` (`readYourWrites` in `complete`). Batch 1. |
| 19 | Two-phase commit vs sagas | 🆕 | Sequential calls + failure = error (A2 problem figure). | Prepare/commit fan-out with participants holding slots (blocked on coordinator crash) vs sequential steps with compensations (`Call` object form with `op`). Batch 3. |
| 20 | Distributed locks / leases | 🆕 (small) | `waiters` map + `park` exist for coalescing (786-794, 692-697). | New kind `lock`: one holder per key, others park, lease expiry sweep in `control`. Batch 3. |
| 21 | Optimistic concurrency | 🔧 | `conflicts` only under partition (296-300). | Read-modify-write requests carry `expectSeq`; db compares in `dbDone`; new `Result "conflict"` (slate square, retryable). Needs `Call` object form (`{ to, op }`). Batch 3. |
| 22 | CDC | 🔧 | `dbDone` already emits detached `repl` messages to `replicaOf`/`peer` nodes; `applyRepl` (941-944) sets `data` on any node. | `emit: Call[]` on a db → change events to a topic/queue/cache; `applyRepl` branches by kind (cache: update or invalidate entry; topic: publish; queue: enqueue). Batch 1. |
| 23 | Search / inverted index | ✅ after #22 | Two datastores, `serviceBy` for scan vs index, freshness via seq. | Index internals are a static diagram beat, not flow. |
| 24 | Bloom filters | 🔧 | No notion of "absent key". | `bloom: { fp }` + `seedKeys` so absent keys exist; negative lookups answered fast with Fx `filtered`. Batch 1. |
| 25 | LSM vs B-tree write path | 🆕 | Constant service time. | Memtable → flush → compaction occupying slots (write stalls), read amplification by level count; level meter. Batch 4. |
| 26 | Consensus (Raft-style log) | 🆕 (large) | Nothing. | Election (#16) + majority append (#17) + partition minority can't commit. Batch 3. |
| 27 | Gossip / membership | 🆕 (medium-small) | Nothing. | Periodic random peer exchange in `control`, per-node `view`, suspect badges, `detectMs`. Batch 3. |
| 28 | Hedged requests / tail latency | 🔧 | Service time is uniform 0.6–1.4× (823): no tail. | `tail: { share, mult }` on servers; `hedge: { afterMs }` on an lb that sends a detached twin to another candidate; first answer wins. Metric `p99`. Batch 1. |
| 29 | Batching and compression | 🔧 | Nothing. | `batch: { max, waitMs }` in `start`; compression = `cost` ↓ transfer vs `serviceMs` ↑ with link capacity (#2). Batch 1. |
| 30 | Stream processing windows | 🆕 | Nothing. | Event time (`ClientSpec.lateness`), tumbling/sliding windows on a processor node, watermark, late-event handling; window strip meter. Batch 4. |
| 31 | Geo-routing / multi-region failover | ✅ (+🔧) | `region`, `setPartition`, `links` latency, health. | One new algo `nearest` (min `latency(lb, target)` among healthy). Batch 1. |
| 32 | Cell-based isolation | ✅ | `algo: "hash"` to cells each with lb+servers+db; crash a cell → only its keys fail. | A 10–12 node scene: a frame/layout concern (§7), not engine. |
| 33 | Chaos / game days | ✅ (+🔧) | `script`, `setUp`, `setPartition`, `expire`, `reconfigure` (knobs already inject slow service/fewer slots). | Add link loss (N1) and latency jitter as faults; a game day is a scripted beat sequence (§3). |

### 1.2 Networking line (request, response, acknowledgement)

| # | Concept | Status | Today | Design (full detail in §2.3) |
|---|---|---|---|---|
| N1 | Lossy links (dot vanishes mid-link; sender times out and retransmits) | 🔧 | Travel is reliable: `send` sets `t1`, `arrive` fires at `t1` (590-629). Timeouts + retries exist (1047-1079). | `LinkSpec.loss`; fate decided by a hash of (link, logical id, attempt, hop) so both worlds lose the same packets; `Phase "lost"`; Fx `lost` anchored on the link. |
| N2 | Explicit acks (message kept until acked; lost ack → duplicate; receiver dedupes by id) | 🆕 | Responses implicitly ack. No message ids, no send buffer, no dedupe. | `ClientSpec.transport: { mode: "fire" \| "ack", ackTimeoutMs, maxResends }`, `NodeSpec.ackOn: "receive" \| "finish"`, `NodeSpec.idempotent`. Acks are detached dots built as two-frame responses so they land in `finishAtClient`. |
| N3 | Windowed sending / flow control (cap in flight; receiver advertises a window) | 🆕 | Nothing (`queueMax` drops). | `ClientSpec.window: { size, max?, mode }`, `NodeSpec.advertise: { high, low }`; acks carry `window`; sender `sendBuf` + `unacked`. |
| N4 | Congestion control intuition (grow on ack, halve on loss) | 🔧 on N3 | — | `window.mode: "aimd"` with `cwnd`/`ssthresh` on the client; shared bottleneck link via `LinkSpec.parallel`. |
| N5 | Connection setup, keep-alive, pooling, HOL vs multiplexing | 🆕 | `blocking` + `slots` approximate a pool; no handshake. | `ClientSpec.connection: { handshakeRtts, keepAliveMs, max, streams }`, server-side `pool: { to, size }`; `conns` per target; handshake dots are detached probes. |
| N6 | Queue acknowledgements (ack on receive/finish, visibility timeout, redelivery, DLQ) | 🆕 | `dispatch` forgets a job once sent (840-855); paused sinks keep jobs; failed jobs vanish (701-704). | `queue.ack: { mode, visibilityMs, maxDeliveries, deadLetter }`, `inflight` map on the queue, worker acks on enter or complete, redelivery in `control`. |
| N7 | Heartbeats / keepalives (generalise health probes; drop dead connections) | 🔧 | `health` probes lb→targets (`probe` 408-413, `healthResult` 415-429, timeout 1049-1054). | `heartbeat: { to \| "connections", everyMs, missAfter, timeoutMs, onDead }`; `health` becomes sugar for `onDead: "bench"`. Metrics `detectMs`, `falseAlarms`. |
| N8 | Deadline propagation (refuse work that can't finish in time) | 🔧 | `deadline` on `Req` (34) is only checked at the client; servers work ghosts to completion. | `deadlines: "honour"`: refuse in `admit` when remaining < expected wait, skip started work for abandoned requests, child call timeout = min(callTimeoutMs, remaining). Metrics `wasted`, `onTime`. |
| N9 | Long-lived connections on a gateway (one event → N connected clients) | 🆕 | Topic fan-out to nodes only. | `hold` gateway + `ClientSpec.subscribe` + `push` op; shared with #7. |

### 1.3 Stories (multi-stage) against the matrix

| Story | Needs | Ready after |
|---|---|---|
| Chat app | N9 gateway + N2 acks + N7 keepalives, topic rooms, idempotent receivers | Batch 2 |
| News feed | Fan-out on write vs read (topic + cache + queue ✅), `batch` (#29), RYW (#18) | Batch 1 |
| Video streaming | CDN ✅, bandwidth (#2), transcoding queue ✅ with N6 acks | Batch 2 |
| Ride matching | `nearest` (#31), locks/leases (#20), gateway pushes (N9) | Batch 3 |
| Ticket booking / flash sale | limiter ✅, queue ✅, locks (#20), OCC (#21), idempotency (#12), shedding (#9) | Batch 3 |
| Payments ledger | idempotency (#12), WAL (#15), outbox (#14), 2PC/saga (#19) | Batch 4 |
| Notification system | topic + queue ✅, N6 DLQ, rate limit ✅, retries ✅, N2 acks | Batch 2 |
| Typeahead | cache ✅, search index (#23), batching/debounce (#29), p99 + hedging (#28) | Batch 1 |

Count: 19 existing + 33 candidates + 9 networking (6 of which merge with candidates) ≈ 52 lessons, plus 8 stories = 60.

---

## 2. Engine extension design

### 2.0 Cross-cutting changes (land once, first)

```ts
// src/lib/sim/types.ts
export type Op = "read" | "write" | "probe" | "repl"
  | "sub" | "push" | "ack" | "beat" | "hand" | "tx"          // batch 2 (transport)
  | "vote" | "append" | "peek" | "prepare" | "commit" | "compensate" | "gossip"; // batch 3

export type Result = "ok" | "stale" | "fallback" | "rejected" | "error" | "conflict";

/** A call target: one node, a pool, or a target with an explicit op and label (OCC, sagas, outbox). */
export type Call = string | string[] | { to: string | string[]; op?: Op; label?: string };

export interface LinkSpec {
  ms?: number;          // one-way latency; a bare number in `links` still means this
  jitterMs?: number;    // ± uniform per crossing (link stream, see 2.3)
  loss?: number;        // probability a crossing is lost (0..1)
  parallel?: number;    // crossings in flight at once; extra wait at the link start (bandwidth)
  perCostMs?: number;   // extra transfer time per unit of Req.cost
  label?: string;       // replaces linkLabels
}
export interface SceneSpec { /* … */ links?: Record<string, number | LinkSpec>; }

export interface Fx { t: number; kind: FxKind; node: string; link?: { from: string; to: string; frac: number } }
```

```ts
// src/lib/sim/engine.ts — Req additions
logicalId: number;   // identity of the logical message across attempts, clones and worlds (see 2.3.0)
hop: number;         // crossings so far on this attempt (salt for link fate)
lostAt: number;      // 0, or the sim time this crossing vanishes
retransmit: number;  // 0 for the first transmission
expectSeq?: number;  // OCC: version the writer read
```

`NodeRt` gains one method so `reconfigure` (180-186) and `setUp(false)` (276-286) stop hand-listing containers:

```ts
/** Every request this node is holding, whatever the container. New containers must be added here. */
holds(): Req[]  // queue, work, held, parked, waiters.*, poolWait, sendBuf, unacked.*.msg, connWait, inflight.*.job, batches.*
```

Invariant checks moved into a tests-only helper `src/lib/sim/invariants.ts` (not shipped): `accounted(sim)` (the predicate from `tests/sim.test.ts:40-44`), `noLeakedHolds(sim)` (every request in any `holds()` has `phase !== "gone"`), and `arrivalTrace(sim)` (the ordered list of `(t, client, key, op, cost, logicalId)` spawns, used to prove lockstep fairness).

### 2.1 Batch 1: small hooks (unlocks ≈16 lessons: #2, #4, #6, #8, #9, #11, #18, #22, #23, #24, #28, #29, #31, #33, N1, N8)

API:

```ts
interface NodeSpec {
  serviceBy?: Partial<Record<"read" | "write", number>>;          // per-op service time (overrides serviceMs)
  tail?: { share: number; mult: number };                          // server-side slow requests (node rng)
  failRate?: number;                                               // share of completions that error (node rng)
  shed?: { queueAbove?: number; loadAbove?: number; keep?: string[] };
  priority?: string[];                                             // tag order served first
  bulkheads?: Record<string, number>;                              // tag → reserved slots
  byTag?: Record<string, Call>;                                    // lb/gateway: route by request tag
  readYourWrites?: { forMs: number; primary: string };             // app server
  emit?: Call[];                                                   // db: change events (CDC)
  bloom?: { fp: number };                                          // cache/db: fast negatives
  seedKeys?: number;                                               // db/cache: keys present at t = 0
  batch?: { max: number; waitMs: number };                         // serve the queue in groups
  hedge?: { afterMs: number };                                     // lb: second attempt to another candidate
  deadlines?: "honour" | "ignore";                                 // N8 (default ignore = today)
  algo?: Algo | "nearest";
}
```

Tick-loop hooks (where each one lives):

| Field | Hook | Behaviour |
|---|---|---|
| `serviceBy`, `tail` | `service()` 821-824 | `base = serviceBy?.[op] ?? serviceMs`; with prob `tail.share` (node rng) multiply by `tail.mult`. |
| `failRate` | `complete()` 869, before `calls` | `if (n.rng() < failRate) return this.fail(n, r)`; for detached jobs this feeds N6's redelivery. |
| `shed` | `admit()` 708 | When `queue.length ≥ queueAbove` or `load ≥ loadAbove` and tag ∉ keep: `effect("reject")`, `respond(r, "rejected")`. Reuses the existing slate-square result (turned away on purpose). |
| `priority` | `start()` 830 | Pick the first queued request whose tag ranks highest; FIFO within a tag. |
| `bulkheads` | `start()` | Count `work+held` per tag; skip a request whose partition is full. Untagged work uses `slots − Σ bulkheads`. |
| `byTag` | `route()` 723 | `targets = flat(byTag[r.tag] ?? spec.to)` then the usual algo. |
| `readYourWrites` | `back()` at server 969-976 records `recentWrites.set(key, t)` on a successful write; `complete()` swaps the first read call for `primary` when `t − recentWrites.get(key) < forMs`. Also sets `r.follows = true` in both worlds so the metric can isolate "reads right after a write". |
| `emit` | `dbDone()` 913-925 | Same loop as replicas: `make(n.id, "repl", key, "repl")`, detached, `seq` set, `send` to each target. `applyRepl` 941-944 branches by target kind: cache → `cache.set(key, {seq, exp, last})` (or delete if `invalidate`); topic → `publish`; queue → `enqueue` (as a job); else `data.set`. |
| `bloom` | `enter()` for db, `lookup()` for cache, before admit | If the key has never been written (`!data.has(key) && !truth.has(key)`): with prob `1 − fp` respond `"ok"` immediately with Fx `filtered` (a correct "not found"); else fall through (false positive = wasted lookup). |
| `seedKeys` | `create()` 225 | `data.set(k, 1)` for `k < seedKeys`; `truth` seeded once per key at construction (deterministic). |
| `batch` | `admit()` stamps `r.queuedAt = t`; `start()` | Start only when `queue.length ≥ max` or `t − queue[0].queuedAt ≥ waitMs`; take up to `max`, give all the same `doneAt = t + service(n, representative)`, register the group in `n.batches` so the slot check counts one slot per group. |
| `hedge` | `route()` records `n.outFlight.set(r.id, {to, at})`; `control()` 378 | For entries older than `afterMs` not yet hedged: `twin = make(...)` **detached**, `hedgeOf = r.id`, same key/op/tag, stack `[client?, lb]` copied, `send` to a different candidate. In `back()` at the lb: if `r.hedgeOf` and the original is still pending → complete the original with the twin's result (`respond(original)`), mark the twin gone, and when the slow original's own answer arrives later it is `orphanAt` → gone (958-961). If the original wins → twin gone on arrival. Only the original is non-detached, so accounting holds. |
| `deadlines` (N8) | `admit()`; `start()`; `call()` 893; `callTimeouts()` 460 | `admit`: if `honour` and `r.deadline − t < (queue.length / slots + 1) × serviceMs` → `effect("reject")`, `respond(r, "rejected")` (fast refusal frees the line). `start`: a request already `abandoned` is dropped without work (`phase gone`, counted in `wasted` as 0 work but `refused`). `call`: child timeout = `min(callTimeoutMs ?? ∞, r.deadline − t)`; if ≤ 0, respond error now. `callTimeouts`: same min. |
| `nearest` | `route()` switch 727 | `pick = argmin latency(n.spec.id, id)` over candidates; ties by `rr`. |
| `LinkSpec` latency/jitter/parallel/perCost | `latency()` 580-588; `send()` 590-600 | `ms = spec.ms ?? distance; ms += perCostMs × r.cost; ms += jitter(link, r)`. `parallel`: `n.linkBusy[key]` = sorted `t1`s in flight; if `count ≥ parallel`, `t0 = earliest t1` (the dot waits at the link start, drawn at `tA`), `t1 = t0 + ms`. |
| `LinkSpec.loss` (N1) | `send()`; `tick()` arrive loop 339-342 | See 2.3.1. |

New `MetricId`s: `p99` (ms, low; needs `windowMs ≥ 4000` — with 700 ms and 50 req/s p99 is just the max), `wasted` (pct of service time spent on requests already abandoned/orphaned, low; accumulate in `finish()` when `r.abandoned || r.orphanAt`), `onTime` (pct answered before deadline, high), `filtered` (pct of lookups answered by the filter, high), `hedged` (pct of logical requests that got a twin, low), `batchSize` (count), `lost` (pct of crossings lost on `nodes`-selected links, low), `refused` (pct refused early by shedding/deadlines, context).

New `FxKind`s: `filtered` (green small ring at the filter), `hedge` (cobalt ring at the lb), `lost` (on-link, red; see 2.3.1), `batchrun` (optional, muted ring). Each needs a colour in `drawFx` (stage.tsx:689-698) and a life in `FX_LIFE` (682). No new dot colours.

Rendering needs: `serviceBy`/`tail`: none (the clock-wipe shows it). `shed`/`deadlines`: badge `SHEDDING`/`DEADLINE` on the server (same `badge` slot as the breaker, 496-502). `bulkheads`: `slotSpots` (glyph.tsx:149-167) draws a 2-px divider between partitions. `batch`: in-service dots of one group drawn as a stacked cluster at one spot + sub-label `batch of 8`. `hedge`: the twin is `detached`, which `styleOf` (631-632) currently draws as a *square* ("job") — add a `hedgeOf` check before the `detached` branch so twins draw as cobalt circles with a dashed outer ring (same mark as retransmits, 2.3.10). `bloom`: small funnel badge on the cache/db glyph. Link `parallel`: dots stacking at `tA`; `label` drawn as today's `linkLabels`.

Unit tests (one per hook, `tests/sim.test.ts`):

| Hook | Test |
|---|---|
| `serviceBy` | Reads 10× faster than writes: p50 of reads < p50 of writes / 5 with `serviceBy: {read: 8, write: 80}`. |
| `tail` + `p99` | With `tail {share: .05, mult: 10}`, `p99 > 3 × p95`; without, `p99 < 1.5 × p95`. |
| `failRate` | `errors ≈ failRate ± 0.05` over 5 s at low load. |
| `shed` | A swamped server with `shed {queueAbove: 8}` keeps `p95` of *answered* ≤ 2 × sloMs while the unshedded one exceeds 4×; `rejected > 0`. |
| `priority` | Two client tags, overload: `p95(tag: "vip") < sloMs`, `p95(tag: "bulk") > sloMs`. |
| `bulkheads` | Hanging dependency for tag A (`blocking`), `bulkheads {A: 2}`: tag B errors stay 0; without bulkheads B errors > 0.3. |
| `readYourWrites` | Writers' follow-up reads: `staleAfterWrite = 0` with RYW, `> 0.2` without (lag 300 ms). |
| `emit` | A cache fed by `emit` has `stale = 0` with `invalidate`, and `hit` unchanged. |
| `bloom` | 50 % reads for absent keys: `filtered ≈ 0.5 × (1 − fp)`; db `served` down by ≥ 40 %. |
| `batch` | `batch {max: 8, waitMs: 50}` at 100 req/s: db `served` groups count ≤ arrivals / 6; p95 ≤ 2 × waitMs + service. |
| `hedge` | Server tail `mult 10`, `hedge {afterMs: 2 × serviceMs}`: `p99` drops ≥ 50 %, `hedged < 0.15`, accounting holds. |
| `deadlines` | Chain client → A → B, tight `timeoutMs`: `honour` → `wasted` drops by > 50 % and `onTime` rises; `ignore` → B keeps working ghosts. |
| `nearest` | Two regions: EU users' p50 ≈ local latency + service; `round-robin` ≈ mean of local/remote. |
| `LinkSpec.parallel` | Link `parallel: 4`, 40 req/s, 200 ms crossing: `inFlight ≤ 4` at every tick; p95 grows vs unlimited. |

Invariants: all randomness from node rng or the new link stream (2.3.1); client rng untouched outside `arrivals` (assert with `arrivalTrace` equality between a scene and the same scene with any downstream field changed). New request containers (`batches`, `poolWait`, `outFlight`) are listed in `holds()`.

### 2.2 Batch 2 unlocks: see 2.3 (transport) — ≈12 lessons + chat, notifications, news feed, video stories

### 2.3 Batch 2: transport (messages, acks, windows, connections, heartbeats, queue acks, gateway)

#### 2.3.0 Message identity and lockstep fairness with random loss

Problem and fix worlds share client node ids, rates and key/skew, so `arrivals()` spawns identical sequences. To keep *fault fates* fair as well, loss must not depend on draw order (which differs between worlds). Rule:

```ts
// per client node: rt.spawned counter
r.logicalId = (hashStr(n.spec.id) ^ Math.imul(n.spawned++, 0x9e3779b1)) >>> 0;   // in spawn(), first attempt only
// retries (pending entries), clone(), giveUp() and transmissions copy logicalId; probes/beats/acks/handshakes use their own.

/** Uniform in [0,1) that depends only on *what* is crossing *which* link, never on when. */
fate(link: string, r: Req, salt: number) =
  mix(hashStr(link) ^ mix(r.logicalId ^ Math.imul(r.attempt + 1, 0x85ebca6b) ^ Math.imul(r.hop + 1, 0xc2b2ae35) ^ salt)) / 2 ** 32;
```

Consequences: the same logical attempt on the same link is lost (or jittered) identically in both worlds, regardless of windows, order or load; retransmissions (`attempt + 1`) get a fresh fate; a fix that inserts a node shifts `hop` from that point on, so fairness holds "on shared links up to the first topology difference" (document this in CLAUDE.md). A plain per-link seeded stream ("nth crossing of link X") is the weaker alternative: it is deterministic but order-dependent, so the fix world would lose *different* packets as soon as its send order diverged. Prefer the hash. Acks, handshakes and keepalives pass `salt = hashStr(op)` so they never shift request fates.

#### 2.3.1 N1 Lossy links

Hooks: `send()` computes `const L = linkOf(from, to)`; if `L.loss && fate(link, r, 0) < L.loss` then `r.lostAt = t0 + (0.35 + 0.5 × fate(link, r, 1)) × (t1 − t0)`; the arrive loop (339-342) adds `if (r.lostAt && r.lostAt <= t) this.vanish(r)`; `vanish`: `r.phase = "lost"` (new `Phase`), `r.lostAt = 0`, `effect("lost", r.to, { from, to, frac })`, `dest.incoming--` (keep `dispatch`'s `incoming` count honest, 849). A lost request simply never arrives; the existing client timeout → `retry` (1047-1079) is the retransmission for request/response traffic, and `callTimeoutMs` → `giveUp` for server calls. `timeout()` sets `phase = "gone"` for `lost` requests (they were only kept so the canvas could show them vanish). `prune` already drops gone.

Scene rule, enforced in `Sim`'s constructor and in `tests/lessons.test.ts`: any `links[*].loss > 0` requires a finite `timeoutMs` (scene or client) or an ack transport, or lost requests would live forever and break accounting.

Metrics: `lost` (pct of crossings on `nodes`-selected links, low), `amplify` (exists: attempts per logical). Fx `lost`: a red ring that shrinks at `link.frac` along the curve (the stage computes the point with `bezier(e.c, tA + frac × (tB − tA))`, stage.tsx:319-321); under reduced motion a single static red "×" for one throttled frame. The dot itself stops being drawn (`phase "lost"` filtered like `gone`).

Test: `loss: 0.3`, `timeoutMs: 400`, `retry {mode: "now", max: 5}`: `lost > 0.2`, `amplify > 1.3`, `accounted(sim)` at every 500 ms, two runs equal. Fairness: build the scene with server `slots 2` and `slots 8`; the sets of `(logicalId, attempt)` lost on `u>s` are equal.

#### 2.3.2 N2 Explicit acknowledgements

```ts
interface ClientSpec {
  transport?: { mode: "fire" | "ack"; ackTimeoutMs: number; maxResends: number };
}
interface NodeSpec {
  ackOn?: "receive" | "finish";   // receiver: when to ack a message (default: "finish" for sinks/queues, response = ack otherwise)
  idempotent?: boolean;            // receiver dedupes by logicalId (messages in enter(), writes in dbDone())
}
// NodeRt
unacked: Map<number, { msg: Req; sentAt: number; resends: number; to: string }>;
sendBuf: Req[];
seen: Set<number>;   // idempotent receivers (bounded: forget ids older than 2 × windowMs via a Win-like ring)
```

Lifecycle:

1. `spawn()`: with `transport`, the spawned `msg` is the **logical** message: non-detached, `phase "parked"`, `at = client`, pushed to `sendBuf`; then `flush(n)`.
2. `flush(n)`: while `sendBuf.length && unacked.size < effectiveWindow(n)` (2.3.3; ∞ without a window): `tx = make(client, msg.op, msg.key, msg.tag)`, `tx.detached = true`, `tx.logicalId = msg.logicalId`, `tx.attempt = entry.resends`, `tx.retransmit = entry.resends`, `send(tx, target)`, `unacked.set(msg.logicalId, {...})`. In `mode: "fire"` the message is not kept: `msg` is settled `"ok"` on send (at-most-once: a lost `tx` is simply lost; metric `delivered` shows it).
3. Receiver `enter()`: if `n.spec.idempotent && n.seen.has(tx.logicalId)` → `effect("dupe")`, `sendAck(n, tx)`, `tx.phase = "gone"`; else `seen.add` (if idempotent), process as today, and if `ackOn === "receive"` → `sendAck` now; if `"finish"` → `sendAck` in `complete()` (sink/worker) or `enqueue()` (queue: after it accepted the job). A non-sink server's *response* is the ack (see 5).
4. `sendAck(n, tx)`: `ack = make(n.id, "ack", tx.key, tx.tag)`, detached, `ack.logicalId = tx.logicalId`, `ack.window = advertised(n)`, **stack `[{id: tx.client}, {id: n.id}]`, then `respond(ack, "ok")`**: the ack travels with `dir −1` and arrives through `back()` → `finishAtClient()`, so acks and responses share one landing path. (`respond` pops the top frame and travels to the next: exactly client ← node.)
5. `finishAtClient()` (1039-1045) gains, before the `detached` early-return: `const u = n.unacked.get(r.logicalId); if (u) { n.unacked.delete(id); n.peerWindow.set(u.to, r.window ?? ∞); onAck(n); this.record(u.msg, r.op === "ack" ? "ok" : r.result); u.msg.phase = "gone"; return; }` (the logical msg's stack is only `[{client}]`, so record directly rather than `respond`). Duplicate acks/late responses whose id is no longer in `unacked` fall into the existing `detached → return` and are ignored.
6. `control()`: for each `unacked` entry with `t − sentAt ≥ ackTimeoutMs`: if `resends < maxResends` → `resends++`, `sentAt = t`, `effect("resend", client)`, transmit again (step 2 body), `onLoss(n)` (2.3.4); else `unacked.delete`, `record(msg, "error")`. A slow-but-not-lost `tx` still arrives later → the receiver sees the same id again → duplicate work unless `idempotent` ("timeout too short" lesson).

Accounting: logical messages are non-detached and recorded exactly once (ack, response, or exhaustion); `tx` and `ack` dots are detached. `holds()` lists `sendBuf` and `unacked.*.msg`. `reconfigure`: if a sender's target disappears, settle its `unacked` and `sendBuf` with `"error"` immediately (don't wait for resends).

Metrics: `delivered` (pct of logical messages acked/answered, high), `duplicates` (count of messages processed ≥ 2 times at `nodes`, low; a receiver-side `Win`), `resends` (ratio like `amplify`), `ackLag` (ms p95 send → ack). Fx: `resend` (cobalt ring at sender), `dupe` (slate ring at receiver), `ack` (tiny green ring at the sender, throttled).

Tests: three scenes over a `loss: 0.2` link to a sink: `fire` → `delivered < 0.9`; `ack` + resends → `delivered ≥ 0.99` but `duplicates > 0` (lost acks) and `n.served > logical`; `ack` + `idempotent` → `delivered ≥ 0.99`, `duplicates = 0`, `served = delivered count`. Determinism and accounting on all three.

#### 2.3.3 N3 Windowed sending / flow control

```ts
interface ClientSpec { window?: { size: number; max?: number; mode?: "fixed" | "aimd" } }
interface NodeSpec   { advertise?: { high: number; low?: number } }   // receiver window = max(0, high − queue.length)
// NodeRt (sender): cwnd, ssthresh, peerWindow: Map<target, number>; (receiver): senders: Set<id>, zeroSince
```

`effectiveWindow(n) = min(cwnd, peerWindow.get(target) ?? ∞)`. `flush` runs after every ack and window update. Receiver side: `advertised(n) = advertise ? max(0, high − queue.length) : ∞`, stamped on every ack; when the receiver's queue drains to `≤ low` after having advertised 0, `start()`/`dispatch()` sends a window-update ack (`logicalId 0`, `op "ack"`, `window`) to each id in `n.senders` (filled in `enter`). Senders with `peerWindow 0` show badge `WAIT`.

Metrics: `inFlight` (avg `unacked.size`, count), `window` (avg `effectiveWindow`), `goodput` (acked messages/s, high), `bufferWait` (ms p95 in `sendBuf`, low), `dropped` (receiver `queueMax` overflow, pct). Rendering: a bracket meter under the client `3/8` (text + bar, like the cache fill bar at stage.tsx:521-529); `sendBuf` drawn as muted copies stacked beside the sender (reuse `parkSpot`, cap 12 + `+n`).

Tests: receiver `queueMax 20`, 60 msg/s, 200 ms crossing, no window → `dropped > 0`; with `advertise {high: 15, low: 5}` → `dropped = 0`, `bufferWait > 0`, and `unacked.size ≤ effectiveWindow` holds at every tick (assert inside the stepping loop).

#### 2.3.4 N4 Congestion control intuition

`mode: "aimd"`: `cwnd` starts at `size`, `ssthresh = max ?? 32`. `onAck`: `cwnd = min(max, cwnd < ssthresh ? cwnd + 1 : cwnd + 1 / cwnd)` (slow start then additive increase). `onLoss` (a resend fired): `ssthresh = max(1, floor(cwnd / 2)); cwnd = ssthresh` (multiplicative decrease). A shared bottleneck is a `LinkSpec.parallel` link (or a `parallel` link into a server) with two AIMD clients. Metrics: `window` sparkline shows the sawtooth; `goodput`; `lost`. Rendering: the window meter grows and snaps back; no new marks.

Test: bottleneck `parallel: 8`, two clients: after warm-up each client's `cwnd` has `max ≥ 2 × min` (sawtooth), combined `goodput ≥ 0.8 × capacity`, fairness `|gA − gB| / (gA + gB) < 0.25`, determinism.

#### 2.3.5 N5 Connection setup, keep-alive, pooling, head-of-line blocking vs multiplexing

```ts
interface ClientSpec {
  connection?: {
    handshakeRtts: number;          // 1 = TCP, 2–3 = +TLS; 0 = free
    keepAliveMs: number;            // idle time before a connection closes (0 = close after each exchange)
    max: number;                    // concurrent connections to one target
    streams?: "one" | "multiplex";  // one exchange at a time per connection (HTTP/1.1) vs many (HTTP/2)
    per?: "client" | "key";         // "Users" stands for many people; default "client" (one browser)
  };
}
interface NodeSpec { pool?: { to: string; size: number; waitMax?: number } }  // server-side outbound pool (same machinery)
// NodeRt: conns: Map<target, { id: number; busy: number; lastUsed: number; readyAt: number }[]>; connWait: Req[]
```

Hooks: in `spawn()` (574-575) and `call()` (893-900), `acquire(n, target)`: an idle warm connection (`t − lastUsed < keepAliveMs`, `busy < limit` where limit = 1 for `"one"`, ∞ for `"multiplex"`) → send now; else if `conns.length < max` → open: `readyAt = t + handshakeRtts × 2 × latency(from, to)`, emit `handshakeRtts` detached `hand` dots (small muted rings out and back, scheduled with explicit `t0/t1`), and send the request with `ms = latency + (readyAt − t)`; else park in `connWait` (HOL blocking; drawn as a waiting formation at the client, badge `6 busy`). Release in `back()`/`finishAtClient()`: `busy--`, `lastUsed = t`, dequeue `connWait`. `control()` closes idle connections (`t − lastUsed ≥ keepAliveMs`, Fx `hangup`). `pool` on a server is the same code path with `limit = size` and `waitMax` → `giveUp`-style error.

Metrics: `connectWait` (ms p95 in `connWait`/`poolWait`, low), `handshakes` (rate, low), `connections` (open count). Rendering: a row of small rounded rects under the client (filled = busy, outline = idle keep-alive, dashed = handshaking); handshake dots use the probe look (small muted rings); link label `handshake ×2` while opening.

Tests: `handshakeRtts 2, keepAliveMs 0` → `p50 ≈ 4 × latency + service` (±10 %); `keepAliveMs 5000` → `p50 ≈ 2 × latency + service`; `max 1, streams "one"` with 3 concurrent → `connectWait > 0`; `"multiplex"` → `connectWait = 0`. Accounting unaffected (handshakes detached).

#### 2.3.6 N6 Queue acknowledgements

```ts
interface NodeSpec /* kind: "queue" */ {
  ack?: { mode: "receive" | "finish"; visibilityMs: number; maxDeliveries: number; deadLetter?: string };
}
// NodeRt (queue): inflight: Map<jobId, { job: Req; worker: string; at: number; deliveries: number }>
```

Hooks: `dispatch()` (840-855) with `ack`: keep the job in `inflight` ("invisible") instead of forgetting it; the dot sent to the worker is the job itself (as today). Worker: `ackOn` semantics from 2.3.2 with the *queue* as the ack target: `mode "receive"` → `sendAck(worker, job)` in `enter()`; `mode "finish"` → in `complete()` for sinks (876-878). The queue's `back()`/ack landing: `inflight.delete(jobId)`. `control()`: entries with `t − at ≥ visibilityMs` → if `deliveries < maxDeliveries` → re-queue (`deliveries++`, Fx `redeliver`); else → send the job to `deadLetter` (a `queue` node with no `to`; `enqueue` there pushes without cloning), Fx `dead`. Worker crash: `setUp(false)` for a sink whose jobs came from an ack-mode queue drops the worker's copies (`phase gone`) so redelivery produces one visible job, not two. `failRate` on a worker (Batch 1) also routes through this path: a failed job is not acked → redelivered → eventually dead-lettered.

Metrics: `redelivered` (count/window), `deadLettered` (count), `lostJobs` (jobs acked on receive whose worker died before `complete`: count), `duplicateJobs` (jobs completed twice, from `idempotent` dedupe or double completion), `jobWait` (exists). Rendering: in-flight (invisible) jobs as muted squares on the tube's lower row (`queueSpot` 600-607 already has two rows); ack dots worker → queue small green; DLQ = queue glyph with `--dot-err` rim and label `Dead letters`.

Tests: script crashes the worker mid-job (`outage` helper): `mode "receive"` → `lostJobs ≥ 1`; `mode "finish"` → `redelivered ≥ 1`, `lostJobs 0`; `maxDeliveries 2` + `failRate 1` → `deadLettered > 0` and `dlq.queue.length > 0`; `visibilityMs < serviceMs` with a healthy worker → `duplicateJobs > 0`, and `idempotent` worker → `duplicateJobs 0`.

#### 2.3.7 N7 Heartbeats / keepalives (generalising health probes)

```ts
interface NodeSpec {
  heartbeat?: { to: Call[] | "connections"; everyMs: number; missAfter: number; timeoutMs: number;
                onDead: "bench" | "drop" | "reconnect" };
}
// NodeRt: view: Map<peer, { ok: boolean; fails: number; passes: number; lastSeen: number }>  (replaces `health`)
```

`health` (types.ts:67) becomes sugar: `heartbeat: { to: spec.to, everyMs, missAfter: failAfter, timeoutMs, onDead: "bench" }` with `passAfter` kept for benching. Implementation: `probe()`/`healthResult()` (408-429) become `beat(n, peer)`/`liveness(n, peer, ok)` keyed by the new `view`. `"connections"` targets the client ids currently held by a `hold` server (2.3.9) and, on a client, the server(s) it has open connections to (2.3.5). `onDead "drop"`: the server closes the connection (held `sub` request → `respond(sub, "error")`, Fx `hangup`); `"reconnect"`: the client re-opens (handshake again). `candidates()` (714-721) and `inRotation` (metrics.ts:131-138) read `view` instead of `health`.

Metrics: `detectMs` (crash → all watchers marked dead; recorded per crash event into a `Win`-like list, p95), `falseAlarms` (count benched while `up`), `connections`. Rendering: existing small hollow ring for beats; badge `?` on a suspected peer; `describe()` (545-597) already renders `benched`/`rejoining…`.

Tests: hanging server (`downMode "hang"`), `everyMs 100, missAfter 2, timeoutMs 150` → detected within 450 ms; `everyMs 20, timeoutMs 10` with 15 ms latency → `falseAlarms > 0`; the existing health-check test (`tests/sim.test.ts:61-86`) must keep passing through the sugar.

#### 2.3.8 N8 Deadline propagation

Specified under Batch 1 (`deadlines: "honour"`); the networking lesson pairs it with N1 loss and retries: a retransmitted request carries the *original* deadline (`pending.first` already preserves `first`; add `deadline` to the pending entry so a retry's `deadline` is `first + timeoutMs`, not `now + timeoutMs` — today `spawn` resets it, 570-571, which is the "each retry gets a fresh budget" anti-pattern; make it a `retry.budgetMode: "fresh" | "shared"` knob, default `fresh` to keep A3 unchanged).

#### 2.3.9 N9 Long-lived connections on a gateway (WebSocket-style fan-out)

```ts
interface ClientSpec { subscribe?: { share: number; holdMs: number; room?: "key" } }   // some requests open a connection
interface NodeSpec   { hold?: boolean }                                              // gateway: `sub` requests occupy a slot until holdMs (or heartbeat death)
// topic.to may include a gateway: publish → gateway.enter(message) → one `push` per held connection whose room matches
```

Hooks: `arrivals()` spawns `op "sub"` with prob `share`; the gateway's `start()` puts a `sub` in `work` with `doneAt = born + holdMs` (counts toward `slots`); `complete()` for `sub` → `respond(r, "ok")` (disconnect). A `repl`/message arriving at a `hold` node (`enter`) fans out: for each held `sub` with `key === msg.key` (room) or all when no room: `push = make(gateway, "push", key, sub.tag)`, detached, stack `[{sub.client}, {gateway}]`, `respond(push, "ok")` (travels back to the client like an ack), `sim.pushes.add(t)`; `finishAtClient` ignores detached pushes but records `pushLag` from the message's `born`. Problem figure: polling clients (`rate` × N) vs fix: `hold` + `push`.

Metrics: `connections` (held count), `pushLag` (ms p95 publish → client), `fanout` (pushes per event). Rendering: a held `sub` sits in its socket as a small solid cobalt dot with no clock wipe (a "pinned" socket); pushes are small cobalt circles travelling back (acks are small *green*; responses are full-size). New glyph `gateway` (server card with an antenna icon, `SIZES` 96×62).

Tests: 200 subscribers (`share 1, holdMs 1e9`) + a topic publishing at 5/s: `connections = 200`, pushes per publish = 200 (or per room), `pushLag` p95 < 2 × latency; polling variant with equal freshness → gateway `util > 0.9`.

#### 2.3.10 Drawing messages, acks and retransmits inside the fixed vocabulary

No new dot colours. Differences are carried by **size, outline and travel direction**, and node-anchored rings:

| Dot | Colour | Shape / size | Why it reads |
|---|---|---|---|
| Message / request (`tx`, attempt 0) | cobalt | circle, full `R` | it *is* a request |
| Retransmission (`retransmit ≥ 1`) and hedge twin | cobalt | circle + dashed outer ring (`setLineDash([2, 2])`, radius `R + 2.5`) | "the same thing again" |
| Ack | green | circle, 0.6 `R`, travelling back (dir −1) | same hue as "answered", smaller because it carries no payload |
| Window-update ack | green | hollow ring 0.6 `R` | an ack with nothing to ack |
| Push (server → client) | cobalt | circle 0.6 `R`, dir −1 | a small request-coloured thing coming *to* you |
| Handshake, keepalive, heartbeat, gossip | muted | hollow ring 3.2 px (today's probe look, `styleOf` 629) | already "control traffic" in the Key |
| Job (queue) | cobalt | square (unchanged) | |
| Lost crossing | red | Fx on the link: ring shrinking to nothing at `frac` (reduced motion: one static ×) | red = failure, but not a diamond, so it is not read as a failed *response* |
| Duplicate dropped by an idempotent receiver | slate | Fx `dupe` ring at the receiver | turned away on purpose |
| Unacked copy in the send buffer | cobalt at 0.35 α | small circles stacked beside the sender | "kept until acked" |

The `Key` popover gets lesson-specific rows via `FigureDef.key?: { shape, cls, name, text }[]` (legend.tsx `DOTS` is the current fixed list) so a networking lesson can add "Ack" and "Retransmit" rows without changing the global vocabulary.

### 2.4 Batch 3: coordination (≈8 lessons + ride matching, ticket booking)

One primitive, **fan-out-and-wait**, serves quorum, 2PC, Raft append and votes:

```ts
private fanout(n: NodeRt, r: Req, targets: string[], op: Op, need: number) {
  n.held.push(r); r.calledAt = this.t;                       // blocking semantics; callTimeoutMs → giveUp (465-483) already handles the timeout
  n.pending.set(r.id, { need, got: 0, best: 0, fails: 0 });
  for (const id of targets) { const c = this.make(n.spec.id, op, r.key, r.tag); c.detached = true; c.parentId = r.id; c.seq = r.seq; c.stack = [{ id: n.spec.id, calls: [] }]; this.send(c, id); }
}
// back() at the coordinator: if (r.parentId) { const p = n.pending.get(r.parentId); p.got++; p.best = max(p.best, r.seq); if (p.got >= p.need) complete parent (respond ok / stale by best vs truth); ignore the rest }
```

| Concept | API | Behaviour | Fx / Metric | Test |
|---|---|---|---|---|
| Quorum N/R/W | `db.quorum: { replicas: string[]; w: number; r: number }` on a coordinator | write: `fanout(append, w)`; read: `fanout(peek, r)`, stale iff `best < truth`. Replicas answer `append` by `data.set` + ack, `peek` by returning `data.get`. | `stale`, `p95`; badge `W=2 R=2` | `w + r > n` → `stale = 0` with lag; `w = r = 1` → `stale > 0.1`; `w = n` + one replica down → writes error. |
| Election + heartbeats | `db.cluster: { group; heartbeatMs; electionMs: [min, max] }` | `control()`: leader beats group members (N7 beats); follower with `t − lastBeat > electionTimeout` (drawn once per term from node rng) → candidate: `term++`, `fanout(vote, majority)`; majority → `role = leader`, Fx `elect`. `enter()` db branch (681-686) uses runtime `role`: non-leaders forward to the known leader if reachable (`cut`, 946-948) else fail. | `elect`, `beat`; `leaderless` (pct of window with no leader), `term` (count) | Crash the leader → new leader within `max(electionMs) + 2 × heartbeatMs`; partition the minority → it never elects, majority side keeps serving. |
| Raft log replication | `cluster.log: true` | Leader `dbDone` → `fanout(append{seq}, majority)` → commit → respond; followers append to `log`, apply on `commitIndex` from the next beat. Minority partition: appends never reach majority → writes time out (`callTimeoutMs`). | `commit`; `committed` (rate), `uncommitted` (count) | After a partition heals, follower logs converge (`data` equal across the group). |
| Locks / leases | new kind `lock` (glyph padlock, 64×64) with `lock: { leaseMs; waitMax? }` | `enter()`: free or expired → grant (`locks.set(key, {holder: r.id, until})`), forward to `to[0]` with `r.lockKey`; else park in `waiters[key]`. `back()` through the lock → release, wake next. `control()` sweeps expired leases (crashed/hung holders). | `lock`; `lockWait` (ms p95), `expired` (count) | A hanging holder blocks others forever without `leaseMs`; with a lease they proceed after `leaseMs`; double-booking count = 0 with the lock, > 0 without. |
| Optimistic concurrency | `ClientSpec.rmw: number`; server `calls.write: [{to: "db", op: "read"}, "db"]` | `back()` at the server after the read stores `r.expectSeq = r.seq`; `dbDone` write: `if (expectSeq !== undefined && current !== expectSeq) → effect("conflict"), respond(r, "conflict")`; `finishAtClient` retries `conflict` like `error`. Without the check, count `lostUpdates` (`current > expectSeq` at write time). | `conflict`; `conflicts` (pct), `lostUpdates` (count) | Hot key, 40 % rmw: OCC → `lostUpdates = 0`, `conflicts > 0`; no check → `lostUpdates > 0`. |
| 2PC vs saga | server `twoPhase: { participants: string[] }` or `saga: { steps: Call[]; compensate: Call[] }` | 2PC: `fanout(prepare, all)` (participants lock the key and keep the child in `held`), then `fanout(commit, all)`; coordinator crash (`setUp false`) leaves participants `held` until `leaseMs` → their slots fill. Saga: sequential steps (existing `call`); a failing step (`failRate`) runs `compensate` in reverse, result `"rejected"`, Fx `abort`. | `commit`, `abort`; `aborted` (pct), `blockedSlots` (count) | Crash the coordinator mid-prepare: 2PC → participant `util` → 1 and unrelated requests error; saga → `aborted > 0`, no blocked slots. |
| Gossip | `gossip: { everyMs; fanout }` | `control()`: pick `fanout` random peers (node rng), send detached `gossip` carrying `view` (heartbeat counters); receiver merges max. A crashed node stops; peers mark it suspect after `suspectMs`. | `suspect` badge "3/4 know"; `detectMs`, `msgRate` | Time-to-detect grows ~log(n) with `n`; messages/s = n × fanout / everyMs. |

### 2.5 Batch 4: storage internals and streams (3 lessons + payments ledger, typeahead)

| Concept | API | Behaviour | Fx / Metric / Render | Test |
|---|---|---|---|---|
| WAL / durability | `db.durability: { mode: "memory" \| "wal" \| "sync"; flushEveryMs; fsyncMs }` | `memory`: ack immediately, append to `unflushed`; `sync`: `service += fsyncMs`; `wal` (group commit): writes in `work` get `doneAt = next flush`, `control()` flushes every `flushEveryMs` (Fx `flush`). `setUp(false)`: `unflushed` entries are lost: `data` rolls back for those keys, `sim.lostWrites += n` (truth stays, so later reads show as stale: the reader sees old data). | `flush`, `lost`; `lostWrites` (count), `unflushed` (count); a log meter (bar of unflushed entries) on the db | Crash during `memory` → `lostWrites > 0`; `wal` → ≤ one flush interval's worth; `sync` → 0 but p50 ≥ fsyncMs. |
| LSM vs B-tree | `db.storage: { kind: "lsm" \| "btree"; memtable; flushMs; compactEvery; compactMs; readAmp }` | LSM: writes `serviceBy.write` small; memtable ≥ size → background flush occupying a slot for `flushMs`; every `compactEvery` flushes → compaction occupying slots for `compactMs` (write stalls); reads `serviceMs × (1 + levels × readAmp)`. B-tree: constant higher write cost, constant reads. | `flush`, `compact`; `readAmp`, `writeStall` (ms p95 during compaction); a level-stack meter | LSM write p50 < B-tree write p50 / 3 outside compaction; LSM read p95 > B-tree read p95; stalls visible as p99 spikes. |
| Stream windows | server `window: { sizeMs; slideMs?; allowedLatenessMs }`; `ClientSpec.lateness: { share, maxMs }`; `Req.eventTime` | Events bucketed by `floor(eventTime / sizeMs)`; a window closes at `end + allowedLateness` (processing time) and emits an aggregate (`done` Fx + a `jobs`-style record); late events after close → Fx `late` (dropped) or re-emit when `allowedLateness` covers them. | `window`, `late`; `lateDropped` (pct), `windowLag` (ms) | 20 % late by up to 2 s: `allowedLateness 0` → `lateDropped ≈ 0.2`; `3000` → 0 with `windowLag` +3 s. |

### 2.6 Batches in order of lessons unlocked

| Batch | Unlocks | Depends on |
|---|---|---|
| 1 Small hooks (+ `LinkSpec`, loss, deadlines, `Call` object form, `logicalId`, `holds()`) | ≈16 lessons incl. networking beginner (latency vs bandwidth, lossy links + timeouts/retransmits, deadlines) and typeahead/news-feed stories | nothing |
| 2 Transport (acks, windows, AIMD, connections, heartbeats, queue acks, gateway, idempotency, outbox, back-pressure) | ≈12 lessons + chat, notifications, video stories | 1 |
| 3 Coordination (fan-out-and-wait, election, Raft, quorum, locks, OCC, 2PC/saga, gossip) | ≈8 lessons + ride matching, ticket booking | 1, N7 beats from 2 |
| 4 Storage and streams (WAL, LSM, windows) | 3 lessons + payments ledger | 1 (can run in parallel with 3) |

---

## 3. Narration / "beats" API

### 3.1 Data model (on `FigureDef`, pure data, no React)

```ts
// src/lib/lessons/beats.ts
export type BeatTrigger =
  | { at: number; loop?: boolean }                                        // sim ms since the scene started (or since each script cycle)
  | { fx: FxKind; node?: string; nth?: number }                           // the nth time this Fx happens (reads sim.fx, engine 1109-1111)
  | { note: string }                                                      // when a script event with this label fires (sim.notes, 312-315) — no duplicated timings
  | { metric: MetricSpec; is: ">" | "<"; value: number; forMs?: number }  // measure() holds for forMs
  | { step: "enter" };                                                    // when the tab is shown

export interface Beat {
  id: string;
  when: BeatTrigger;
  text: string;                                   // ≤ 20 words; may use {at} / {phase} / {n} templates when following
  spotlight?: { nodes?: string[]; links?: `${string}>${string}`[]; dots?: "travelling" | "waiting" | "late" | "failed" };
  follow?: { pick: "next" | "nextLate" | "nextFailed" | "nextStale" | "nextRetry"; tag?: string; op?: Op; untilGone?: boolean };
  pause?: true | number;                          // pause playback, or slow to 0.25× for n real ms
  prompt?: { question: string; options: string[]; answer: number; reveal: string; check?: (sim: Sim) => boolean; checkAfterMs?: number };
  once?: boolean;                                 // default true; false re-arms every script cycle
  holdMs?: number;                                // real ms to keep the callout (default 3200, like freshNote)
}
interface FigureDef { beats?: Beat[]; key?: KeyRow[] }
```

### 3.2 Runtime: a deterministic `BeatRunner`

`BeatRunner` is a plain class (no DOM): `constructor(beats, sim)`, `advance(): Fired[]`. It is called once per animation frame *after* `sim.step()` in the `useLiveSims` loop (live.tsx:73-76, via a new `onTick(sims)` option or inside `onFrame`), and only for the **shown** step's sim. It keeps `lastT`, `lastFxT` (like the stage's `s.lastFx`, stage.tsx:375-392) and `lastNote` cursors, and evaluates triggers against **simulation time and simulation events only**: `at` fires when `lastT < at ≤ sim.t`; `fx` scans `sim.fx` entries with `t > lastFxT`; `note` compares `sim.notes`; `metric` uses `measure()` and a sim-time `since` stamp. Because every input is a function of the seeded sim, the beat sequence is identical on every machine and at every playback speed (a frame at 2× covers ≤ 20 sim ms = 10 ticks; `sim.fx` keeps ≥ 80 entries, so no event is skipped at the 11 Hz cadence). Real time only governs how long the callout stays on screen.

`follow`: at fire time the runner picks the lowest-id request in `sim.reqs` matching the selector that was spawned at or after the trigger tick (`attempt 0`, tag/op filters; `nextLate` waits for the first `now − first > sloMs`; `nextRetry` the first `attempt > 0`). It stores `followId`; each frame the stage draws a halo around that dot (and the callout text re-renders with `{at}` = `sim.nodes.get(r.at).spec.label`, `{phase}`, `{n}` = position in its node's queue) until `phase === "gone"` or `holdMs`. Deterministic because the pick happens at a tick boundary by id order.

`pause` and prompts need two additions to `Live`: `pause()`/`play()` (today only `toggle`, live.tsx:99) and `setRate(0.25)` (a temporary multiplier on `L.speed` in the loop). A `prompt` implies `pause: true`; the panel renders the question as a `<fieldset>` of radios with a Reveal button; on reveal the `reveal` text shows and playback resumes. Prompt answers are component state only, honouring "progress is a localStorage list of visited lessons and nothing more".

Lockstep: both worlds keep running (`useLiveSims` steps all sims, live.tsx:75); beats are evaluated against the active step's sim only; switching steps re-arms that step's runner from `sim.t` (past `at` beats don't fire, event beats fire on their next occurrence); `restart` (epoch) re-creates runners.

### 3.3 Rendering

- **Callout**: reuse the `.note` slot (player.tsx:163-165, `aria-live="polite"`) for text, with an optional anchor: `Stage` exposes `anchorFor(id): { x, y } | null` in CSS px (frame `pos` → letterbox like the canvas, stage.tsx:225-227) through a ref, and the callout is absolutely positioned near the spotlit node (clamped inside the stage; on phones always top-left as today).
- **Spotlight**: `Stage` takes `spotlight?: { nodes, links, dots }` and adds `lit` to the matching `<g class="node">` / `<path class="link">` and `spot` on `.stage`; CSS `.stage.spot .node:not(.lit), .stage.spot .link:not(.lit) { opacity: .35; transition: opacity .25s }` (opacity only, allowed by the motion rule; the global reduced-motion block at globals.css:2124-2133 disables the transition). Canvas side: `live.current.spotlight` → dots whose `at`/`to` is not lit draw at `alpha × 0.35`; `dots: "late"` lights only amber dots, etc.
- **Follow**: halo = a 2-px cobalt ring at `R + 4` around the followed dot, drawn after all dots; everything else dims to 0.35. No pulsing (nothing decorative).
- **Reduced motion**: nothing autoplays (live.tsx:52-55), so timed beats cannot fire. The panel renders the figure's beats as a static numbered "What to watch" list; pressing Step (700 real ms, live.tsx:95-98) advances the sim and lets beats fire; prompts render as static "Think: …" blocks with a Reveal toggle. Spotlight/follow still work frame by frame (the canvas already draws with `fade = 1`, stage.tsx:229).
- **Scripts**: a beat can reference `ScriptEvent.label` through `{ note }`, so lessons keep one source of truth for fault timing; the existing `freshNote` banner is replaced by beats where a figure declares any, and stays as the fallback otherwise.

### 3.4 Validation in `tests/lessons.test.ts`

For every figure with `beats`, build the default scene, run `warm + max(12 000, 2 × script.loopMs)` sim ms with a `BeatRunner` stepping 100 ms at a time, and assert:

1. every beat fires at least once (so an `fx`/`note`/`metric` beat refers to something that really happens in this run);
2. beats fire in declaration order when `ordered: true`;
3. `spotlight.nodes` ⊆ spec node ids and `spotlight.links` ⊆ `edgesOf(spec)` (layout.ts:105-124);
4. `follow.pick` finds a request within 2 000 sim ms of its trigger;
5. `text.split(/\s+/).length ≤ 20`, templates only use known keys;
6. `prompt.check(sim)` holds at trigger + `checkAfterMs` (the prediction the lesson calls correct is actually true);
7. no beat fires before `warmMs` (the viewer would miss it).

Browser (`tests/browser/site.spec.ts`): for one lesson per track, `.beat` shows text within 6 s and the spotlit node has class `lit`; under `reducedMotion: 'reduce'`, the static "What to watch" list is visible and Step fires the first beat.

---

## 4. Catalog data model

### 4.1 Types (`src/lib/lessons/types.ts`)

```ts
export type Level = "beginner" | "intermediate" | "advanced";
export type LineId = "foundations" | "caching" | "data" | "async" | "resilience" | "capstone"
  | "networking" | "state" | "messaging" | "storage" | "coordination" | "operations" | "stories";

export interface Line {           // keep the name (route map, CSS `line-*` classes)
  id: LineId; letter: string; name: string; blurb: string;
  level: Level; order: number;    // new
}

export interface Lesson {
  slug: string; code: string; line: LineId; title: string; why: string;
  figures: FigureDef[]; takeaways: { use: string; catch: string; seen: string };
  level: Level; minutes: number; tags: string[]; requires?: string[];   // slugs
  kind?: "lesson" | "story";      // default "lesson"
  story?: StoryDef;               // kind "story": figures = []
  claims?: Claim[];               // explicit teaching claims (default: today's rule)
  status?: "live" | "draft";      // drafts are type-checked and tune-able but excluded from LESSONS, static params and tests
  aliases?: string[];             // old slugs → redirects
}

export interface Claim { figure: number; vs: number; metric: MetricId | string /* label */; minGain?: number; runMs?: number; tag?: string }
```

### 4.2 Registry (`src/lib/lessons/registry.ts`)

- Each line module exports `Lesson[]` as today; `registry.ts` concatenates in `LINES` order and filters `status !== "draft"` into `LESSONS` (so `index.ts` keeps its exports: `LESSONS`, `getLesson`, `lineOf`, `lessonsOn`, `neighbours`).
- **Codes are explicit, not derived** (the route map and the per-line bar display them, and tests assert uniqueness and that codes within a line are strictly increasing). Inserting a lesson mid-line means choosing a code such as `N2b` deliberately rather than renumbering; a committed `tests/catalog.snapshot.json` (slug → code) makes a renumbering show up as a diff in review rather than silently.
- `neighbours()` stays catalog-order; add `nextFor(slug, visited: Set<string>)` = the first lesson whose `requires` are all visited (for the dock's "Next stop" when a learner jumps around), `lessonsAt(level)`, `storyList()`, `prerequisitesOf(slug)`.
- Slug aliases: `aliases` feed `next.config.ts` `redirects()` (read from a small generated `src/lib/lessons/aliases.json` so the config file doesn't import TS).
- Home/route map at 60: `route-map.tsx` hard-codes 5 lines × 5 stations (`STATION_X = 292 + 168 j` in an 1100-wide viewBox, `TERM_Y = TOP + ROW × 5`, route-map.tsx:8-12). Generate geometry from the registry (rows = lines, columns = `max(lessonsOn)`), group lines into three level bands, and keep the phone list. The per-line bar in the player (`bar-stops`, hidden < 1000 px) already scales.

### 4.3 Generalising `tests/lessons.test.ts`

Replace the fixed count (24-30) and "exactly 2 figures" (35) with structural invariants:

- unique slugs and codes; `LESSONS.length ≥ 19`; every line has ≥ 1 lesson; every `requires` slug exists, appears earlier in catalog order, and the graph is acyclic;
- `level`, `minutes ∈ [3, 12]`, `tags.length ≥ 1` present; `why.length < 220`; captions < 60 words; ≤ 2 knobs; ≤ 4 metrics; `short.length ≤ 16`;
- `figures.length ∈ {2, 3}` for lessons with allowed tone sequences `problem,fix` · `problem,explore` · `tradeoff,tradeoff` · `problem,fix,fix` · `problem,fix,tradeoff`; stories have `figures.length === 0` and `story.stages.length ≥ 3`;
- the claim loop (70-82) becomes data-driven: `lesson.claims ?? [{ figure: firstFixIndex, vs: 0, metric: fix.metrics[0].label, minGain: 0.08 }]`, and `tradeoff` pairs must declare claims explicitly (today they fall under the default rule by accident);
- fairness lint: across a lesson's figures, `sloMs`, `timeoutMs`, `timeScale`, `windowMs` and every client node's spec (`rate`, `keys`, `skew`, `hot`, `writes`, `heavy`, `tag`, `timeoutMs`, `retry`) must be equal unless `lesson.fairness === "clients-differ"`; actions must be paired **by id** across figures (today the player pairs by index, player.tsx:215);
- `arrivalTrace` equality between problem and fix after 5 000 ms (the lockstep guarantee, now tested rather than assumed);
- knob-corner run (47-67) unchanged; beats validation (§3.4); scene rule for lossy links (§2.3.1);
- story test generalises the capstone one (111-123): for each story, each stage is clearable by its intended design and not by the previous one.

### 4.4 Stories share the capstone player

`src/lib/lessons/capstone.ts` already is a story in disguise: `Arch` (6-11) is a `Values` record, `CapStage` (13-23) a stage, `capstoneScene(a, s)` a `scene(values, stage)` builder, `PRICE`/`monthlyCost` a cost function, `CAP_METRICS` the metric list, and `TARGET` the pass condition. Generalise:

```ts
export interface StoryStage { name: string; brief: string; hint: string; params: Values; hold: number; target: Target[]; script?: SceneSpec["script"]; beats?: Beat[] }
export interface Target { metric: MetricSpec; max?: number; min?: number }
export interface StoryDef {
  controls: (StepperControl | ToggleControl | ChoiceControl)[];   // the architecture knobs
  start: Values; cost: (v: Values) => number;
  scene: (v: Values, stage: StoryStage) => SceneSpec;
  metrics: MetricSpec[]; stages: StoryStage[];
}
```

`CapstonePlayer` becomes `StoryPlayer({ lesson })` (same `Shell`, `useLiveSims`, `Stage`, `MetricList`, `Transport`, hold logic from capstone.tsx:28-42); `Stepper`/`Toggle` (200-227) render from `controls`; `/learn/[slug]/page.tsx` picks the player by `lesson.kind` instead of `slug === "capstone"` (26). The capstone is the first `kind: "story"` entry; the browser test at site.spec.ts:121-130 runs for every story.

---

## 5. Build and performance at scale

### 5.1 Static generation

`generateStaticParams` + `dynamicParams = false` (page.tsx:9-13) scale linearly: 23 pages in 357 ms today → ~1 s for 62 routes. `generateStaticParams` runs before pages at build and on navigation in dev (generate-static-params.md "Good to know"). Nothing else is needed; `experimental.staticGeneration*` knobs exist but are unnecessary at this size.

### 5.2 Per-lesson code splitting

Today every lesson's `build` closure, knob and metric definition ships in the single shared chunk (`0-wkp2iifxj51.js`, 31.8 KB gz) because `LESSONS` is imported by the home page (`page.tsx`, `route-map.tsx`) and by the player. At 60 lessons the lesson code (≈1 100 lines → ≈40 KB raw today) triples to ≈120 KB raw / +25–30 KB gz, paid by the home page too.

Recommendation (do it when the catalog passes ~30): split **catalog metadata** from **scene modules**.

- `src/lib/lessons/catalog.ts`: slug, code, line, title, why, level, minutes, tags, requires, aliases (a few KB; used by home, route map, `generateStaticParams`, `generateMetadata`, the per-line bar).
- `src/lib/lessons/scenes/<slug>.ts`: `figures`, `takeaways`, `claims`, `beats` (behaviour).
- `src/lib/lessons/scenes/index.ts`: an explicit map `SCENES: Record<string, () => Promise<{ default: LessonScenes }>>` with literal `import("./caching")` entries (Turbopack needs literal paths: lazy-loading.md "the path must be explicitly written"; generate the map with a script and test that it covers every catalog slug).
- The player (a client component) loads `SCENES[slug]()` with `React.lazy`/`use` inside a `Suspense` whose fallback is the shell with an empty stage, and prefetches `neighbours().next` on idle so "Next stop" stays instant. Do the split **inside the client**: "When a Server Component dynamically imports a Client Component, automatic code splitting is currently not supported" (lazy-loading.md), and lesson modules contain functions, which cannot cross the server→client boundary as props anyway.
- Expected shape: shared engine+stage+live ≈ 50 KB raw / 18 KB gz; player ≈ 10 KB gz; each scene chunk 2–5 KB gz. Verify with `npx next experimental-analyze` (available since 16.1, package-bundling.md), since the build table no longer prints sizes.

If the split is deferred, the single-bundle cost at 60 lessons is ≈ +30 KB gz on every page (≈ 210 KB gz per lesson page): tolerable, but the home page and hero pay for lessons they never run.

### 5.3 Budget

| Item | Today | Budget at 60 lessons |
|---|---:|---:|
| Client JS per lesson page (gz, excl. `noModule` polyfill) | 179 KB | ≤ 200 KB |
| App code of that (gz) | ≈ 46 KB | ≤ 60 KB shared + ≤ 6 KB per lazily loaded scene |
| CSS (gz) | 8.2 KB | ≤ 12 KB (new glyphs/meters/beats; no per-page split needed) |
| Fonts | 13 files / 300 KB | ≤ 6 files / 150 KB: Overpass and Atkinson Hyperlegible Next are variable on Google Fonts; `next/font/google` loads one variable file when `weight` is omitted ("if loading a variable font, you don't need to specify the font weight", font.md:20; arrays are for non-variable fonts, font.md:117). `layout.tsx:5-13` passes weight arrays, which is why there are 13 files. |
| Sim CPU | 1–4 ms per 6 000 sim ms | unchanged per scene; 3 lockstep worlds × 15 nodes stays < 1 ms per frame |

### 5.4 Render cadence with bigger scenes

- SVG: `setTick` every 90 ms while running (live.tsx:79-82) re-renders `LessonPlayer` → `StageSvg` (every node through `describe()`, stage.tsx:545-597) and `Compare` (`measure()` per metric per column, which filters/sorts `sim.done`, metrics.ts:65-74). At 15 nodes × 3 sims × 4 metrics this is well under 1 ms; keep 11 Hz on desktop, drop to 6 Hz on `compact`/`tall` (phones) to save battery.
- Canvas: every frame iterates `sim.list` and `sim.reqs` (incl. gone requests until `prune` every 100 ticks ≈ 2 real s at 0.1×); at 100 req/s × 1.5 s latency ≈ 150 live dots + queue formations: trivial. New overlays (send buffers, in-flight meters, spotlight dimming, follow halo) are O(nodes) + O(dots).
- Only the shown sim is drawn; hidden lockstep worlds only `step()`.
- `pickMode`/`layoutFor` recompute three layouts per spec change (stage.tsx:120-127): fine, but stories with 12+ nodes should set `wideH` explicitly to avoid the tall layout's one-row-per-`along` growth (layout.ts:64-74).
- `Math.random()` in `drawFx` (stage.tsx:387-388) and `performance.now()`-based ages make the canvas non-reproducible frame-for-frame; irrelevant for teaching, relevant for visual snapshots (§6).

### 5.5 Next 16 facts the implementation must respect (from `node_modules/next/dist/docs/01-app/…`)

1. **Turbopack is the default** for `next dev` and `next build` (`02-guides/upgrading/version-16.md:126-130`); the build route table prints only route symbols (`02-guides/building.md`), so bundle sizes come from `npx next experimental-analyze` (`02-guides/package-bundling.md`, v16.1+) or the chunk inspection above.
2. **`params` is a Promise** in pages, layouts and `generateMetadata` (`03-api-reference/03-file-conventions/page.md:64-65`; sync access "will be deprecated"). `page.tsx` already awaits it. The `PageProps<'/learn/[slug]'>` helper is generated by `next typegen`/build (page.md "Page Props Helper").
3. **`generateStaticParams` + `dynamicParams = false`** remain the right tools; note `dynamicParams` "is not available when Cache Components is enabled" (`…/route-segment-config/dynamicParams.md`).
4. **Do not enable `cacheComponents`** for this site: it switches to PPR + `use cache`, removes `dynamic`/`dynamicParams`/`revalidate` segment configs, requires `<Suspense>` around `params` reads or the build fails with `blocking-prerender-*` errors (`03-api-reference/05-config/01-next-config-js/cacheComponents.md`, `02-guides/building.md`), and buys nothing for pages that are already fully static (`●`). If it is ever enabled, remember it keeps up to 3 hidden routes mounted via React `<Activity>` (`02-guides/preserving-ui-state.md`): the rAF loop is already gated by `useVisible` (hooks.ts:34-45) and effects are cleaned up when hidden, but the `IntersectionObserver` gate is what stops hidden players from stepping.
5. **`middleware` → `proxy.ts`** (`03-api-reference/03-file-conventions/proxy.md`, version-16.md:612-658); the Edge runtime is deprecated (`…/route-segment-config/index.md:11`). The site needs neither; security headers stay in `next.config.ts` `headers()`.
6. **Metadata**: `themeColor`/`colorScheme`/`viewport` inside `metadata` are deprecated since 14 (`03-api-reference/04-functions/generate-metadata.md:652-658, 754`); `layout.tsx:21-27` correctly uses `export const viewport`. `generateMetadata` should stay free of request data so pages stay static (generate-metadata.md:192-195). File-based `opengraph-image.tsx` now receives async params (version-16.md:317).
7. **Fonts**: `next/font/google` self-hosts and preloads each `subsets` file by default (`03-api-reference/02-components/font.md:148, 184-194`); prefer variable fonts without `weight` arrays (§5.3).
8. **Prefetching**: static routes are fully prefetched when a `<Link>` enters the viewport, scheduled through a small queue, with layout deduplication and incremental prefetch in 16 (`02-guides/prefetching.md`, version-16.md:569-580). 60 station links on the route map are fine; no `prefetch={false}` needed.
9. **Scroll behaviour**: Next 16 no longer overrides `scroll-behavior: smooth` during navigation (version-16.md:961-983). `globals.css` sets it on `html` (≈ line 96-100); lesson shells don't scroll (`overflow: hidden`, globals.css:891-903) so this is harmless, but add `data-scroll-behavior="smooth"` on `<html>` if home → lesson navigation ever visibly scrolls.
10. **`next lint` is removed** (version-16.md:1082-1084); there is no linter in `package.json` today; if one is added, run ESLint/Biome directly in CI.
11. **Node ≥ 20.9, browsers Chrome/Edge/Firefox 111+, Safari 16.4+** (version-16.md:118-124): `svh`, `:has()`, canvas `roundRect` and `setLineDash` are all within baseline.
12. **`typedRoutes: true` is stable** (`…/typedRoutes.md`) — optional, useful for the registry's generated hrefs. **`reactCompiler` is stable but opt-in** and needs `babel-plugin-react-compiler` as a devDependency (`…/reactCompiler.md`); it would not add a runtime dependency but is unnecessary given the measured render cost.
13. **Turbopack filesystem cache is on by default for builds since 16.3** (`…/turbopackFileSystemCache.md`); Vercel caches `.next/cache` automatically; a GitHub Actions CI must cache it explicitly (`02-guides/ci-build-caching.md`).
14. **`next typegen`** lets CI type-check without a full build (`03-api-reference/06-cli/next.md:175-210`) and regenerates `next-env.d.ts`, which the docs recommend git-ignoring (next.md:204) — see §0.3.
15. **`instant` route segment config** only applies with `cacheComponents` (`…/route-segment-config/instant.md`): not applicable.
16. **React 19.2 in the App Router** brings `<ViewTransition>` (`02-guides/view-transitions.md`, version-16.md:385-393): usable for the step-switch crossfade of panel content (same-route transitions are activated by `useTransition`/`useDeferredValue`, not plain `setState`), but the stage's node tween must stay the CSS transform transition it is today (stage.tsx:483, globals.css ≈ 1527) because it animates between two simulations, not two routes.
17. `devIndicators: false` remains valid (only the sub-options were removed, `…/devIndicators.md:70-71`).

---

## 6. Testing strategy

### 6.1 Unit: engine invariants (`tests/sim.test.ts`)

Keep the 12 existing tests; add the per-extension tests listed in §2 and four **catalog-wide property tests** that run against every figure of every lesson at default knobs (cheap: ≈ 6 ms per figure):

1. determinism: two fresh sims, `deepEqual(a.done, b.done)` at 7 000 ms (exists for one scene at sim.test.ts:24-30);
2. accounting: `done + live === logical` at 1 000/3 000/7 000 ms and after each action is toggled on and off (generalises sim.test.ts:40-44);
3. no leaked holds: every `holds()` entry has `phase !== "gone"`, `held.length ≤ slots`, `unacked.size ≤ window` (generalises 194-204);
4. arrivals independence: `arrivalTrace(problem) === arrivalTrace(fix)` for every lesson, and for every scene with downstream fields perturbed (`slots ± 1`, `serviceMs × 2`).

Plus scene rules: lossy links need a timeout or ack transport; `p99` metrics need `windowMs ≥ 4000`; `hedge` only on lbs with ≥ 2 candidates.

### 6.2 Lesson claims (`tests/lessons.test.ts`)

Data-driven `claims` (§4.3) with the 8 % gain floor kept as the quality bar, knob corners, beats validation (§3.4), fairness lint, prerequisite graph checks, and a story test per `kind: "story"`. Expected runtime at 60 lessons: ≈ 2–3 s.

### 6.3 Browser (`tests/browser/site.spec.ts`)

- The per-lesson test (36-57) already iterates `LESSONS`; at 60 lessons × 2 projects ≈ 120 tests × ~3 s on 3 workers ≈ 2–3 min. Shard in CI (`--shard=1/3`).
- Add: viewBox stability (the SVG `viewBox` attribute is identical before and after switching steps — the `combinedFrame` guarantee, player.tsx:23-29); label-overlap check (`getBBox()` of `.node-label` texts pairwise disjoint at both viewports); story checks for every story; beat checks for one lesson per line (§3.4); reduced-motion checks unchanged (108-119).
- Keep `expectNoPageScroll` (16-23) as the screen-fit gate at 1440×900 and 390×844; add a 1280×720 desktop project since CLAUDE.md names that size and the `.shell` grid uses fixed 54/62 px rows (globals.css:895).

### 6.4 Visual snapshots (optional, non-blocking)

`toHaveScreenshot` under the `reducedMotion: 'reduce'` project, where the sim is a still at warm + 2 600 ms (live.tsx:52-55) and node tweens are off. Two sources of nondeterminism remain in the canvas: `Math.random()` for drop velocities (stage.tsx:387-388) and real-time fx ages. Either `mask: [page.locator('canvas.stage-canvas')]` and snapshot the SVG + panel only, or add a test-only `data-still` mode that draws fx at mid-life with a seeded jitter. Curate the set (one lesson per line, each story's first stage, light and dark via `colorScheme`) rather than all 120 pages, and run it as a separate job that uploads diffs as artifacts.

### 6.5 `npm run tune`

Extend `scripts/tune.ts` with `--line`, `--level`, and `--json` (writes per-figure averages/maxes and the claim gain). Commit `tune.baseline.json`; CI diffs it and *warns* on > 20 % swings in a headline metric (the claims test is the hard failure). Add the beats dry-run (`--beats`) that prints when each beat fires, for authoring.

### 6.6 CI gate

- Every PR: `npm ci && npm run typecheck && npm test && npm run build` (today < 1 min; the build stays ~5 s of compile plus 1 s of static generation at 60 pages). Cache `.next/cache` and `~/.cache/ms-playwright`.
- Every PR touching `src/`, `tests/` or `globals.css` (effectively all): Playwright desktop + mobile, sharded 3×, required.
- Nightly / on demand: visual snapshots and `tune --json` drift report, non-blocking.
- Vercel preview deploys remain the eyeball check for layout.

---

## 7. Risks and sequencing

### 7.1 Order of work

1. **First**: catalog model + registry + generalised tests (§4) — unblocks parallel lesson authoring; everything else is additive. Same PR: `.gitignore` `next-env.d.ts` and `.playwright-mcp/`; pair fault actions by id; variable fonts.
2. **Then, in parallel**: (a) engine Batch 1 with `logicalId`, `holds()`, `LinkSpec`, `Call` object form and the property tests; (b) beats runtime + stage spotlight/follow + reduced-motion fallback (no engine dependency); (c) `StoryPlayer` generalisation of the capstone.
3. **Then**: engine Batch 2 (transport) and the networking line's lessons; scene code-splitting once the catalog passes ~30.
4. **Then**: Batch 3 and Batch 4 in parallel; stories as their batches land.
5. **Visual/motion upgrade** after beats: new glyphs (gateway, lock, dlq, window), meters (window bracket, log/level stacks, connection sockets), badges, the Key rows per lesson; the dot vocabulary stays fixed.

### 7.2 Trickiest parts

- **Lockstep fairness when a fix adds nodes.** Arrivals are fair by construction (per-client rng), but three things silently break it: differing `sloMs`/`timeoutMs`/`timeScale` between figures (the player uses `specs[0].timeScale` for all worlds, live.tsx:61, and each world judges "late" by its own `sloMs`); fault buttons paired by index (player.tsx:215) when a fix adds an action; and random faults consumed in different orders. The fairness lint, id-paired actions and the hash-based fate function (§2.3.0) close all three. A fix that inserts a node changes `hop` for later links, so loss fates on those links diverge; say so in CLAUDE.md.
- **Frames staying stable as scenes gain nodes.** `combinedFrame` unions node positions (player.tsx:23-29), so a fix that adds a row (DLQ under the queue, a gateway column) changes the frame for the problem step too, and in the tall layout every distinct `at[0]` becomes a row (layout.ts:64-74). Mitigations: a kit helper `col(i, n)` that snaps `along` to a lesson's shared columns, a lint asserting each step's own frame is within 15 % of the combined frame's size, and explicit `wideH` for scenes with ≥ 8 nodes.
- **Time-scale differences between lessons.** Everything is in simulated ms at `timeScale 0.1` and the dock shows `1/(timeScale × speed)`× slow motion (live.tsx:117). Consensus lessons want 150 ms election timeouts to feel slow (`timeScale 0.05`), LSM compaction and stream windows want seconds (`timeScale 0.5–1`, `windowMs` 3 000–5 000, `msPerUnit` smaller so dots don't crawl). One `timeScale` per lesson is fine (all steps share it) but authors must scale `sloMs`, `timeoutMs`, `windowMs`, `warmMs`, script timings and `msPerUnit` together; add `scene()` presets (`scene.fast`, `scene.slow`) to the kit and a lint that `windowMs ≥ 20 × serviceMs`.
- **Request accounting with new detached kinds.** Transmissions, acks, handshakes, beats, pushes, hedges and gossip are all `detached`, so the accounting predicate excludes them; add a bounded-growth test (`sim.reqs.length` stays below `rate × 3 × timeout` over 30 s) so a leak in any of them is caught.
- **`reconfigure` safety.** Every new container of requests must be reachable through `holds()`; every new per-node Map keyed by request id must be pruned when the request goes gone; a removed receiver must settle senders' `unacked` immediately. The existing hand-written lists at engine.ts:180-186 and 276-286 are the bug magnet; replace them with `holds()` in Batch 1.
- **Fx throughput.** The stage throttles 70 ms per `node:kind` (stage.tsx:378-381) and the engine caps `fx` at 120 (373); chatty kinds (beats, acks, gossip) are fine visually but beat triggers must read `sim.fx` by cursor, not the throttled view, and `prune` must not drop fx newer than the runner's cursor (raise the cap or make the runner consume before prune).
- **Metric windows on tail-latency lessons.** `windowMs 700` (kit.ts:16) gives ~35 samples at 50 req/s, so `p99 = max`; those lessons need `windowMs ≥ 4000` and the smoothing in `useSmoothed` (live.tsx:174-187) tuned so p99 doesn't flicker.
- **Bundle growth on the home page** (§5.2): split before the catalog passes ~30.
- **Route map geometry** (§4.2): generate from the registry before adding the sixth line.
- **Authoring throughput.** 40 new lessons × (2–3 figures + claims + beats + key rows): a `scripts/new-lesson.ts` scaffold, `tune --beats`, and the baseline JSON keep tuning fast; the 8 % claim gate and the beats validation are what keep 60 lessons honest.
- **Vocabulary pressure.** Every new concept will want a colour ("duplicate", "lost write", "conflict"). Hold the line from CLAUDE.md: new meanings get rings, badges, meters, sizes and dashes (§2.3.10); the only Result added is `conflict`, drawn as the existing slate square because it is a deliberate refusal.