# Engine recomputation profile

Measured locally with v24.19.0 on darwin/arm64. No extra profiling dependency. The exact deterministic engine used by the client was measured with Node `performance.now()`; this is not a browser-paint or mobile-device benchmark.

Each of 56 lessons used baseline inputs, all controls at valid upper bounds, and an additional queue backlog variant (one worker where available, fault from 4s onward). Three warmups and five measured recomputations per case. Upper bounds do not prove the mathematical worst case across all combinations.

## Representative baselines

| Lesson | Inputs | Median ms | Largest ms | Frames | Serialized KiB |
| --- | --- | ---: | ---: | ---: | ---: |
| cache-aside | baseline | 0.32 | 0.49 | 55 | 88 |
| dead-letter | baseline | 0.85 | 1.31 | 61 | 190 |
| consistent-hashing | baseline | 0.48 | 0.51 | 26 | 116 |
| sagas | baseline | 0.14 | 0.16 | 33 | 44 |
| disaster-recovery | baseline | 0.13 | 0.15 | 33 | 41 |

## Ten slowest measured combinations

| Lesson | Inputs | Median ms | Largest ms | Frames | Serialized KiB |
| --- | --- | ---: | ---: | ---: | ---: |
| ordering | upper bounds | 2.18 | 2.86 | 81 | 442 |
| dead-letter | upper bounds | 2.04 | 2.19 | 87 | 492 |
| backpressure | upper bounds | 1.97 | 2.04 | 81 | 443 |
| dead-letter | backlog | 1.94 | 2.3 | 73 | 452 |
| write-behind | upper bounds | 1.91 | 2.55 | 81 | 442 |
| idempotency | upper bounds | 1.88 | 2 | 81 | 445 |
| ordering | backlog | 1.77 | 1.85 | 73 | 441 |
| queues | upper bounds | 1.69 | 1.84 | 81 | 442 |
| batching | upper bounds | 1.66 | 2.1 | 81 | 423 |
| pubsub | upper bounds | 1.45 | 2.6 | 70 | 357 |

The run computes only when configuration changes. Playback and inspector selections reuse the run; baseline A computes only while comparison evidence is open. These bounded measurements do not justify a worker or another library. A lower-powered browser can still differ: profile actual input-to-paint latency before enlarging workloads. Serialized size is a reproducible proxy for snapshot volume, not a retained-heap measurement.

## Production browser input check

Chromium against the standalone production build on the same desktop, at 1440×900. For each input, two warmups then eight updates alternate between its allowed minimum and maximum. Each sample starts before dispatching the native input event and ends after two animation frames; persisted draft values are checked after every update. This includes React/model/storage work plus deliberate frame waits, so it is not an isolated engine duration or field INP measurement.

| Lesson / input | Median ms | Largest ms |
| --- | ---: | ---: |
| Cache-aside / TTL | 30.5 | 31.6 |
| Dead-letter queue / arrivals | 30.3 | 31.0 |
| Consistent hashing / nodes | 30.6 | 30.9 |

All samples completed without page errors. No physical phone or CPU-throttled device was benchmarked. Raw results and viewport bounds are in `quality/layout-check.json`. These results support keeping the existing synchronous bounded engine; they do not justify a worker.
