# Simulation model contract

The browser calls `runExperiment(config)` directly. There is no required simulation request and no AWS resource access. The finite models teach mechanisms; they are not service emulators or sizing estimates.

## Time and replay

Model version 2 uses a seed, lesson-specific bounded integer controls, and up to 24 ordered fault transitions. Each domain event owns an immutable world snapshot and its derived metrics. Events at the same simulated second have distinct ordered IDs. Step advances one event, not one second. The first failure in the DLQ baseline occurs at time zero. Seeking selects an existing snapshot. Pause stops the playback timer; speed scales wall time without changing the model.

Fault/recovery events change the environment. Component health at that event remains the last observation until the next domain action or health probe detects the change. The event explanation calls out this distinction; health-check removal and recovery may require several probes.

Control and scenario changes restart. Live injection takes effect at the next simulated second and replaces future fault transitions, preserving the already-observed prefix. Reset rewinds the existing configuration; choose Baseline to remove custom settings. Shared URLs include the complete configuration and model version. Invalid versions, unknown IDs, malformed JSON, unknown controls, invalid bounds, and oversized URLs are rejected with a visible recovery message.

Baseline comparison completes both models explicitly. Seed and offered load (rate, arrivals, duplicate deliveries, object size, event history) are shared. Strategy controls differ. Changes to offered load alone may therefore produce no difference; the comparison isolates strategy rather than silently changing the workload. Fault schedules are part of the compared strategies.

## Families and ceilings

| Family | Actual state | Deliberate simplification |
|---|---|---|
| Cache | Key inventory, values, versions, expiry, last use, frequency, actual evictions | Finite keys; instantaneous ordered source-read/fill events, no network RTT. Stampede models a same-key concurrent burst. |
| Fleet | Ready/booting/failing/probing targets, bounded request batches, admissions, completions | Each admitted operation finishes in one modeled second; independent work and no shared database bottleneck. Three requests/s per generic instance. |
| Queue | Ready/in-flight/completed/DLQ deliveries, receive count, visibility, group, operation ID | Intake at seconds 1–8, drain to 32; one-second work except a slow subscriber; bounded finite history retained for inspection. |
| Replica | Writer and replica values/versions, ordered pending updates, stale/fresh reads | Primary-only writes; no concurrent multi-writer conflict resolution. Global-table example explicitly uses MREC, not MRSC. |
| Record | Rows examined, atomic account balances, version conflicts, object transfer, lifecycle | Twenty-row index example; no isolation anomaly catalog. Lifecycle advances one object-age day per observation; restoration seconds are illustrative compressed time. |
| Circuit | Closed/open/half-open, threshold failures, cooldown, probe outcome | Consecutive-failure threshold, one caller/second, one bounded half-open probe. Baseline outage at seconds 4–10. |
| Hash | 24 actual seeded keys, clockwise owners, virtual points, moved keys, modulo comparison | Small 360-position ring; ties have deterministic order. No replication or automatic membership removal. Sharding renders partition buckets, not ring ownership. |
| Identity | Verified/expired tokens, subject/owner decisions, key versions, cached secrets | No cryptography or real credentials in the educational model. Key rotation retains old key material. |
| Network | Public/private boundaries, explicit ingress paths, HTTP rule matches | Connection admission only, not a packet-level TCP/IP simulator. Count-mode WAF observes without blocking. |
| Workflow | Retry schedule, caller vs remote state, restore, correlated traces, folds, compensations, fences | Finite operations. The saga assumes successful compensations; production compensation failure needs its own retry policy. Fencing is enforced at the protected resource. |

Queue accounting is `accepted = completed + pending + deadLetter` after every event. Rejections were never accepted. Deduplicated business effects are separate from completed deliveries. Stream consumption retains records; another reader can replay them. FIFO ordering is per group. Backpressure bounds pending work; a queue does not create worker capacity.

Deployment examples distinguish sampled error counts from expected canary error probability (`weight × candidate error probability`). Health detection and recovery each require probes; failing targets may still receive traffic before removal. Blue/green switching retains the blue fleet for rollback.

## Progress and optional cloud

Version 1 arrays migrate to version 2 explored IDs; understanding is not inferred. The original storage key remains. Unknown formats and storage exceptions do not overwrite existing data. Guest progress uses its own key, and every account has a separate namespace. Token subject decoding selects only that local namespace; it is never an authorization decision. API Gateway remains the actual authorization boundary.

The existing cloud schema stores explored lessons only. Understanding checks remain local per account. Sync sends the legacy bounded progress envelope with default legacy parameters; these do not describe the v2 experiment. GET results are validated before merging into the current account. Writes are idempotent per concept. Expiry switches back to preserved guest progress. Local logout removes browser tokens but does not revoke the identity provider’s separate session. Malformed storage is rechecked when switching accounts and is never replaced by session-only progress.

`POST /api/simulate` accepts v2 configurations and returns this same engine’s event run. Legacy configurations are accepted through a proportional control adapter, but the response is now the v2 event format (no old formula points). `/api/runs` and its infrastructure schema remain unchanged.

## Connected-system example

The journey follows one operation from a three-component start. A warm cache can short-circuit product reads; orders always commit at the writer. A transactional outbox closes the database/queue dual-write gap. Queue acceptance and notification completion are distinct. The provider honors a stable idempotency key; a local dedupe record alone could not make an external email atomic. The resilience trace repairs the provider before its half-open probe. These assumptions are displayed in the product.
