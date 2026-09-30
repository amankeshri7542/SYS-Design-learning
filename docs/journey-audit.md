# Connected journey correctness pass

## Confirmed before implementation

- The former `journeyTrace(stage, operation, failure)` combined cache warmth and database availability in a single flag: a healthy read always started warm, while a failing read started expired. The learner could not test a warm cache during a source outage.
- Stage 5 repaired the provider and completed the operation as a predetermined story. There was no separate repair action or DLQ redrive decision.
- The journey duplicated queue/cache behavior as narration rather than consuming their simulation mechanisms. It exposed only accepted/completed counters, hiding the difference between pending work and isolated DLQ work.
- The diagram displayed disconnected component cards. The operation path named endpoints but did not show the connected architecture.

## Implemented decisions

Architecture stage, operation, cache contents, source availability, worker availability, notification processing, and explicit redrive time now have independent controls. Changing an input resets playback but preserves the other choices. All six introductory stages remain. The introduction for each stage is available under “Why add this component?” beside links to the existing lessons.

`journeyTrace` projects one operation from shared mechanisms:

- Product reads call the existing `cache(Timeline)` mechanism. Cold/warm/expired state only changes the initial cache entry; source availability only changes its fault schedule. The first request's seeded key is used for the initial entry. Cache expiration, hit/miss, source fetch, and fill events come from that mechanism.
- Asynchronous notification calls `queue(Timeline, options)` with exactly one arrival and one worker. Worker stop/restart is independent of failed message processing. Receives, visibility timeout, retries, acknowledgment, DLQ isolation, and explicit redrive come from that mechanism.
- Stage 5 uses the same small circuit policy as the circuit-breaker lesson. The queue checks the gate before reserving work and records the actual provider outcome after processing. The single worker ensures at most one half-open probe. Worker interruption does not increment provider failure counts.

The non-operation settings use a native disclosure with a visible input summary, keeping the primary action near the diagram. The default diagram shows only the chosen operation's components and real directed connections; “Full architecture” retains access to everything introduced. Mobile has its own readable, connected SVG rather than shrinking desktop text. Edge highlights and operation narration use the selected event's actual path. Selecting a component opens an inspector with its role, current condition, and event evidence. Both SVGs expose keyboard-operable components with descriptive accessible names.

Accepted, completed, pending, and DLQ counters satisfy `accepted = completed + pending + dead` at every displayed frame. For queued work, acceptance means durable enqueue and completion means successful acknowledgment. For synchronous operations, only a completed response increments the successful operation count. A failed writer transaction never accepts an order; a notification trace begins with an already published outbox event and does not retrospectively depend on writer availability.

## Independent regression evidence

Run `node --import tsx --test tests/journey.test.ts` from the repository. Seven tests passed when authored; the final repository verification should rerun them with the complete suite.

| Check                                         | Literal expected observation                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Warm cache + source unavailable               | Read completes; no source path appears                                                                                                  |
| Cold or expired cache + source unavailable    | Miss followed by failed read; no completion                                                                                             |
| Writer unavailable                            | Order and notification are not accepted                                                                                                 |
| Worker stopped through 32s                    | One accepted, one pending, zero completed, zero in DLQ                                                                                  |
| Worker restarts at 10s                        | First receive at 10s, acknowledgment at 11s                                                                                             |
| Processing fails, repaired at 16s, no redrive | Receives at 1/4/7s, DLQ at 8s; repair leaves one message isolated                                                                       |
| Repair at 16s + explicit redrive at 20s       | Message requeued at 20s, completion at 21s                                                                                              |
| Redrive while processing still fails          | Message exhausts its fresh receive budget and returns to the DLQ                                                                        |
| Stage 5 breaker + repair + redrive            | Opens at 5s, gates receives at 7–8s, probes at 9s, reopens after failed probe at 10s, closes after a successful redriven attempt at 21s |
| Combined options across six stages            | Valid topology, deterministic replay, monotonic time, preserved accounting                                                              |

## Bounded model assumptions

One product read or one notification is followed; no measured AWS timing or provisioned resources are implied. The reader and writer both hold product v1; replica lag is explored in the replication lesson. The balancer selects application A with both applications healthy; fleet health is explored in its lesson. The local order/outbox transaction and provider idempotency are stated assumptions, not additional distributed transactions simulated by this trace. Stage 3 pauses delivery while processing is unavailable; the stages with a DLQ model a failing payload through bounded receives. Synchronous stages make one notification attempt and do not retry after the request ends.

The horizon ends at 32 simulated seconds. Pending work remains pending and the breaker can remain open when no further message attempts occur; a passed cooldown or dependency repair alone does not fabricate a successful probe. An explicit redrive issued before any DLQ message exists has no future effect. A stopped worker does not move messages to a DLQ because no failed processing receives occur.

## Browser inspection

The connected journey was opened in Chromium and inspected at 1440×900, 390×844, and 320×844. Screenshots at `docs/quality/journey-1440.png` , `docs/quality/journey-390.png`, and `docs/quality/journey-320.png` show the intermediate failed half-open probe at 10s, with the notification in its DLQ. Console/page errors were empty after the shared SVG title hydration fix. The page did not overflow at 390px or 320px. The mobile stage selector scrolls horizontally inside its own rail. Keyboard Enter opened the Worker inspector and Escape dismissed it. The main action remained within the first 844px phone viewport (top at 625px on 390px width, 621px on 320px width); the full focused diagram requires scrolling on phones. Initial review caught missing line selectors, simultaneous mobile/desktop diagrams, and an unrelated initial browser path; these were corrected before the evidence capture. This is agent browser inspection, not human usability testing.
