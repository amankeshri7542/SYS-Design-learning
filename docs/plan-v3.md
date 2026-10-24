# System Lab v3 plan

- **Status:** proposed, 2026-10-22. M0, M1, M2 and M3 built 2026-10-22. M4a and M4b built 2026-10-23. M5 built 2026-10-24.
- **Planned with:** Claude Fable 5.1. **To be built with:** Claude Opus 5.5, one milestone per session.
- **Research behind it:** `docs/research/` holds five reports. Read the one a milestone points to before starting it.
  - `design-audit.md`: visual and UX audit, art direction, home and player layouts, component inventory.
  - `motion-audit.md`: motion inventory, motion that teaches, motion tokens, measured frame budgets.
  - `pedagogy.md`: how the best explainers teach, a first-time-learner audit, the beat-based lesson structure, copy rules, three rewritten lessons.
  - `architecture.md`: engine capability matrix, four engine extension batches (including networking), the beats runtime, the catalog model, build and test strategy, Next 16 facts.
  - `curriculum.md`: the expanded catalog by level and line, the networking line, real-world stories, learning paths.
- `docs/plan.md` stays as the record of v1 and v2.

---

## 1. Problem

System Lab already does the hard part. Every lesson is a live, deterministic simulation on one screen, the problem and the fix run in lockstep, and a test proves each fix beats its problem. The research found six gaps between that foundation and "understand system design just by watching".

1. **The eye is not guided.** Captions describe outcomes in a paragraph. Nothing points at the node, dot or queue being talked about, and the interesting moment often arrives 10 to 50 seconds in with no warning.
2. **Some numbers teach something false.** The Change column paints a verdict on explore and trade-off figures, marks "Servers in use 3 → 2" as worse in the health-check fix, and never shows the latency target the colours are judged against.
3. **The stage is hard to read.** Phone labels render at 7 to 10 px and are clipped on 7 lessons. On desktop the nodes fill 8 to 12% of the stage height. Links are at 1.2:1 contrast and almost vanish at night.
4. **Motion shows requests but not mechanisms.** Cache fills and evictions, key remapping, replication copies and breaker states are invisible or carried by identical rings.
5. **The catalog stops early.** There is no networking line (request, response, acknowledgement, loss, flow control, connections), no beginner on-ramp, few advanced topics, and one real-world story.
6. **The look is generic around a good idea.** The transit identity is strong, but the chrome around it (dot grid, six radii, pills everywhere, a stock hero) is not.

When v3 ships, a learner picks a level and rides a line. Each lesson builds its scene part by part, then walks through it in short beats: a callout points at the exact thing, the scene pauses so they can predict, they cause the failure, switch on the fix, and read one sentence comparing the numbers. "Follow one request" traces a single request's whole life.

The catalog grows from 18 to 57 lessons on seven lines in three levels. That includes a 16-lesson networking line built around request, response and acknowledgement. Eight new real-world stories join the URL shortener. Everything sits on a paper-and-ink "field guide" look that stays legible at 390 px and in dark mode.

## 2. Scope

**Asked for by the owner:**
- A better overall look, designed as a UI/UX and front-end expert would.
- Concept delivery that makes system design understandable by watching.
- More motion, as motion design that teaches.
- More examples, and a bigger catalog with beginner, intermediate and advanced concepts.
- Networking concepts: request, response, acknowledgement and beyond, at all three levels.
- Real-world system designs told as animated stories.
- Mobile and desktop parity.

**Inferred, and treated as requirements:**
- Every rule in `CLAUDE.md` stays: no runtime dependencies beyond Next and React, plain CSS, the deterministic engine, the fixed dot vocabulary, reduced motion, and the one-screen fit.
- The transit identity evolves rather than being replaced.
- "The fix beats the problem" stays the hard quality gate, and every new teaching claim gets a test.
- Existing lesson URLs keep working.

**Out of scope:** accounts, a backend, analytics, cloud services, AI features, and user-generated content.

## 3. Assumptions

| # | Assumption | Status | If wrong |
|---|---|---|---|
| A1 | No new runtime dependencies (`CLAUDE.md`). | confirmed | Motion would move to a library; the plan avoids that on purpose. |
| A2 | Learner storage stays "a localStorage list of visited lessons and nothing more" (`CLAUDE.md`). Predictions and check answers live in component state only. | confirmed as today's rule | If the owner wants a learning record (prediction accuracy, chosen path), build milestone M11 and change the `CLAUDE.md` rule first. |
| A3 | Overpass, Overpass Mono, Atkinson Hyperlegible Next and Newsreader are all variable on Google Fonts. | confirmed (`next/font` font data) | Keep weight arrays; font payload stays at 13 files. |
| A4 | Next 16.3.7, React 19.3.0, Playwright 1.63.0 are installed; Node 22+ in CI. | confirmed | Re-read `node_modules/next/dist/docs/` for the installed version. |
| A5 | The target viewports are 1440×900, 1280×720, 390×844 and a landscape phone at 844×390. | confirmed (`CLAUDE.md`, `playwright.config.ts`, design audit) | Add or drop Playwright projects. |
| A6 | Every existing slug stays as it is. Slugs are the identity (URLs, the visited list). Codes are display labels: M5 assigns every lesson, built or planned, its final code in level order, and after that codes are frozen. | confirmed by this plan | Renaming a slug needs an alias and a redirect (M5 adds the mechanism). |
| A7 | Each milestone lands as one branch and one pull request. Vercel builds a preview per PR and production from `main`. | unconfirmed | If the owner prefers direct commits to `main`, keep the same milestone order and gates. |
| A8 | Lesson timing stays at `timeScale` 0.1 (10× slow motion) unless a lesson needs otherwise, and then all of that lesson's steps share one value. | confirmed (engine, `live.tsx` reads `specs[0].timeScale`) | Per-step time scales would break lockstep. |

## 4. What the research found

The top findings, in the order the plan acts on them. Each report has the evidence.

| Finding | Source |
|---|---|
| Change column verdicts are wrong for explore and trade-off figures and for "Servers in use"; no latency target is shown; the hidden 10× clock confuses. | pedagogy §2 |
| Phone labels are 7–10 px rendered and clipped on 7 lessons; frames ignore label extents; the layout picker ignores aspect ratio. | design-audit D1, D5, D6 |
| Dark-mode primary button is 3.13:1; amber badge text 2.17:1; line-colour code chips 3.5:1. | design-audit D2 |
| Single-row scenes fill 8–12% of the desktop stage; links are 1.2:1. | design-audit D3, D9 |
| At 1280×720 the Fix step's panel scrolls on 11 of 18 lessons; at 1440×900 it wastes 155–333 px. | design-audit D4 |
| Outcome rings are the loudest thing on stage and carry the least meaning; one tab switch fires seven different durations. | motion-audit §0 |
| Consistent hashing, replication and eviction are invisible; the breaker badge snaps between states. | motion-audit §0, §2 |
| Frame budget has large headroom: 120 dots cost 0.9 ms p95 natively and 2.1 ms at 6× CPU throttle. | motion-audit §4 |
| Learners need pre-training (parts before motion), segmenting (learner-paced beats), cueing (point at the thing), prediction before the break, and a check with feedback. | pedagogy §1 |
| Retries & backoff and consistency vs availability show their story only after about a minute; scripted loops fight the fault buttons. | pedagogy §2 |
| The engine expresses about half the candidate concepts today; additive batches unlock the rest, including the networking line (this plan cuts them into five, D8). | architecture §1, §2 |
| Loss must be decided by a hash of what crosses which link, not by draw order, or the problem and fix worlds lose different packets. | architecture §2.3.0 |
| All lessons ship in one shared chunk loaded by the home page; split catalog metadata from scene modules before the catalog passes ~30. | architecture §5.2 |
| `cacheComponents` must stay off; `params` is a Promise; fonts should load as variable files. | architecture §5.5 |
| Every curriculum opens with the same six ideas, and System Lab has all six. The gap is before them (the anatomy of a request) and after them (delivery guarantees, quorums, consensus, locks, streams). | curriculum §1.1 |
| Transport ideas (acks, retransmission, windows, congestion, handshakes) are the most dot-shaped topics in the field and are missing from interview courses, so a networking line is a differentiator. | curriculum §1.1, §1.4 |
| Queue acks with dead letters plus idempotency keys appear in six of the eight new stories; deadline propagation in four; locks and leases in two. | curriculum §4 |

## 5. Architecture decisions

### D1. Art direction: "Field Guide, set in signage"
- **Options:** dark-tech control room; paper-and-ink field guide; full transit signage system.
- **Chosen:** the field guide, with the transit system as its bones (design-audit §3).
- **Why:** it is literally what the product says it is. Ink on paper is the clearest ground for six saturated dot colours, so the dots, which are the content, are the only saturated things on the stage. Line colour becomes an identifier (roundels, code chips, rules, rails), never a surface behind small text.
- **Cost:** dark mode needs a designed "night edition", not an inversion. It adds a fourth typeface.

### D2. Typefaces
- **Chosen:** Overpass for signage (≥16 px only), Newsreader for lesson and step titles and the recap, Atkinson Hyperlegible Next for body and stage labels, Overpass Mono for every number. All four load as variable fonts with no weight arrays.
- **Why:** the serif gives the guide its voice. Variable files cut the font payload from 13 files and 300 KB to about 5 files.
- **Cost:** one more family. If it does not survive review in M1, fall back to Overpass 600 for titles and keep three faces.

### D3. Stage text: counter-scaled SVG with label-aware frames
- **Options:** an HTML overlay for labels; SVG text counter-scaled by the fit factor.
- **Chosen:** keep labels in the SVG, set `font-size: calc(var(--label-px) / var(--k))` where `--k` is rendered px per viewBox unit, and make `frameFor` reserve gutters for label extents.
- **Why:** one coordinate system means labels glide with their nodes during the step-switch tween with no sync work, and the SVG keeps its accessible name. The fit is a two-pass calculation (estimate k, add label gutters, recompute k), memoised per box size.
- **Cost:** label extents are estimated from character counts, not measured. A Playwright containment test catches any estimate that is too small.

### D4. Concept delivery: beats evaluated on simulation time
- **Options:** keep free-running captions; a scroll story; data-driven beats on each figure.
- **Chosen:** beats as data on `FigureDef`, fired by a deterministic `BeatRunner` that reads only simulation time and simulation events (architecture §3), wrapped in the lesson structure from pedagogy §3: hook, build, watch, predict, break, fix, compare, check, takeaways.
- **Why:** beats point at the thing at the moment it happens and can pause both worlds, which is what the learning science says works. Because triggers read only the seeded simulation, the same beat fires at the same moment on every machine and at every speed, and a test can prove each beat really happens.
- **Cost:** every lesson needs authoring (hook, build lines, 3–6 beats, a prediction, 1–2 checks). The dock's Next button now advances beats before steps, so the existing browser test for Next changes.

### D5. Faults: armed, one-shot scripts for lessons
- **Options:** keep looping scripts; armed scripts the learner fires.
- **Chosen:** `ScriptEvent.armed` events do not run from the loop. The break beat, or the fault button, fires them with `sim.fire(label)` in both worlds. Hero and story scenes keep loops.
- **Why:** the learner causes the failure at a known moment (samwho, Secret Lives of Data), and the 52–70 s loops that hid the retries and consistency-vs-availability lessons go away.
- **Cost:** tests must fire armed events themselves. `tests/lessons.test.ts` gets an `autoFire(sim)` helper that fires each armed event at its nominal `at`, so claims stay measurable.

### D6. Learner state stays minimal
- **Chosen:** keep the visited list as the only stored progress. Predictions, checks and the follow toggle are component state. "Next stop" follows the fixed recommended path (D7), so it needs no stored choice. The map's level filter is UI state. The lesson-to-lesson intro continuity in M3 uses a module-level variable, which survives client navigation without storage.
- **Why:** it is a written project rule, and nothing in v3 needs more.
- **Cost:** no "you predicted 7 of 9" history across visits. That is the optional M11, and only with the owner's agreement.

### D7. Catalog shape: lines × zones, metadata split from scenes
- **Chosen:**
  - Lines stay as topics (rows on the map). Levels become fare zones (column bands): Zone 1 Beginner, Zone 2 Intermediate, Zone 3 Advanced. Real-world stories become journeys that ride several lines.
  - `catalog.ts` holds metadata for every lesson. Each lesson's figures, beats and claims live in `scenes/<slug>.ts`, loaded on the lesson page through a literal `import()` map.
  - One recommended path (`PATH` in the catalog, curriculum §5) interleaves the lines. "Next stop" follows it, skipping lessons that are not live yet. The line strip in the bar still shows a lesson's line neighbours.
  - Prerequisites dim a station on the map until they are visited. Nothing is locked.
- **Why:** the home page and route map need only metadata, and each lesson page needs only its own scene code (architecture §5.2). The map scales because a station's column comes from its level, not its index. An interleaved path puts N2 acknowledgements right before A3 retries, where it does its work.
- **Cost:** one-time move of 18 lessons into per-lesson files, and a test that the import map covers every slug.

### D8. Engine growth: five additive batches, no second engine
- **Options:** a separate network simulator; extend the one engine.
- **Chosen:** extend `src/lib/sim/engine.ts` in five batches, each behind spec fields whose defaults reproduce today's behaviour exactly. They follow architecture §2, with its transport batch split in two so the delivery features most stories need land first (curriculum §4, §8):
  - **B1 small hooks** (M6): links with loss, bandwidth, jitter and buffers; deadlines; shedding and priority; bulkheads; batching; canary weights; drain; overload crash; stale-on-error; nearest region; cached addresses; negative caching; per-op service time; session stores; SLO metrics; a per-request time breakdown.
  - **B2a messages and delivery** (M7): explicit acks, idempotency keys, queue acks with visibility timeout and dead letters, back-pressure, outbox, partitioned logs.
  - **B2b connections and real time** (M8): windows and AIMD, handshakes, keep-alive and pools, head-of-line blocking vs multiplexing, L4 vs L7, held connections with push, heartbeats, replica promotion.
  - **B3 coordination** (M9): fan-out-and-wait (scatter-gather, hedging), quorums, elections and log replication, locks and leases with compare-and-set, sagas.
  - **B4 streams and durability** (M10): event-time windows and lateness, write-behind with lost writes on crash.
- **Why:** one engine keeps one dot vocabulary, one test harness, and lockstep for free.
- **Rules that come with it:**
  - Link fate is a hash of link, logical id, attempt and hop, so both worlds lose the same packets.
  - `NodeRt.holds()` becomes the one list of every request a node holds, used by `reconfigure` and `setUp`.
  - Every new message kind (ack, handshake, push, heartbeat, hedge twin) is `detached`, so accounting is unchanged.
  - New meanings get size, outline, dashes, rings, badges and meters, never a new dot colour (architecture §2.3.10).
- **Cost:** `engine.ts` grows from about 1,100 to 2,500 lines. M6 splits it into modules before adding B1.

### D9. Stories: one player, data-driven
- **Chosen:** generalise the capstone into `StoryDef` (controls, cost, scene builder, stages, targets) and one `StoryPlayer`. The URL-shortener capstone becomes the first story.
- **Why:** the capstone already is a story in disguise (architecture §4.4), and every new story then costs data, not a component.

### D10. Branching and parallel work
- **Chosen:**
  - M0 to M5 run strictly in order. They all touch `stage.tsx`, `player.tsx` and `globals.css`.
  - After M5, each engine batch lands first as its own PR.
  - Lesson authoring for that batch can then run in parallel sessions, one per line, because lessons live in separate scene files.
  - Each parallel session appends its catalog entries inside its own line's block in `catalog.ts`, and its glossary terms in its own block of `glossary.ts`.

---

## 6. Catalog v3

The full specification of every lesson is in `docs/research/curriculum.md` §3: its why, problem scene, fix scene, headline metric, knobs, fault, prerequisites and the engine features it needs. Its NC capability IDs are mapped to engine batches in §6.4 below. The tables here fix what is in scope, its level, and the milestone that builds it.

Codes in these tables are the working codes from the curriculum report, so they match its detailed rows. M5 assigns final codes in each table's row order (A6), so a finished line reads N1, N2, N3… on the map. Slugs are the stable key between the two.

### 6.1 Lines

| Letter | Line | Lessons in scope | New | Colour |
|---|---|---|---|---|
| N | Networking | 16 | 16 | new identifier colour, chosen in M1 |
| F | Foundations | 6 | 2 | `--l-foundations` |
| C | Caching | 6 | 2 | `--l-caching` |
| D | Data | 10 | 6 | `--l-data` |
| A | Async | 9 | 6 | `--l-async` |
| R | Resilience | 8 | 5 | `--l-resilience` |
| O | Operating | 2 | 2 | new identifier colour, chosen in M1 |
| ★ | Stories | 9 | 8 | ink |

**Total: 57 lessons** (18 existing, 23 new must-haves, 16 new should-haves) and 9 stories.

The two new line colours must differ clearly from the six dot hues and from the other lines. Each needs an ink variant at ≥4.5:1 on paper in day and night, enforced by `tests/tokens.test.ts`.

### 6.2 Lessons in scope

Level: B beginner, I intermediate, A advanced. Priority: P1 must, P2 should. "Existing" lessons keep their slug; the old code is in brackets.

**N · Networking**

| Code | Slug | Title | Level | Pri | Built in |
|---|---|---|---|---|---|
| N1 | request-and-response | A request and a response | B | P1 | M6 |
| N2 | acknowledgements | Acknowledgements | B | P1 | M7 |
| N4 | latency-vs-bandwidth | Latency vs bandwidth | B | P1 | M6 |
| N7 | handshakes-and-keep-alive | Handshakes and keep-alive | B | P1 | M8 |
| N9 | dns | DNS: finding the server | B | P1 | M6 |
| N5 | windows-and-flow-control | Windows and flow control | I | P1 | M8 |
| N11 | push-vs-poll | Long polling, SSE and WebSockets | I | P1 | M8 |
| N13 | timeouts-and-deadlines | Timeouts and deadline propagation | I | P1 | M6 |
| N6 | congestion-control | Congestion control | I | P2 | M8 |
| N8 | head-of-line-blocking | Head-of-line blocking and multiplexing | I | P2 | M8 |
| N10 | l4-vs-l7 | L4 vs L7: balancers, proxies, gateways | I | P2 | M8 |
| N12 | heartbeats | Heartbeats and keepalives | I | P2 | M8 |
| N16 | pipelining-and-batching | Pipelining and batching | I | P2 | M6 |
| N15 | delivery-guarantees | At-most-once, at-least-once, exactly-once | A | P1 | M7 |
| N17 | backpressure | Backpressure | A | P1 | M7 |
| N18 | nearest-region-and-failover | Nearest region and failover | A | P2 | M6 |

**F · Foundations**

| Code | Slug | Title | Level | Pri | Built in |
|---|---|---|---|---|---|
| F1 | latency-and-throughput | Latency & throughput | B | P1 | existing |
| F2 | scaling-up-vs-out | Scaling up vs scaling out | B | P1 | existing |
| F3 | load-balancing | Load balancing | B | P1 | existing |
| F4 | health-checks | Health checks & failover | B | P1 | existing |
| F5 | stateless-vs-stateful | Stateless servers and sessions | B | P1 | M6 |
| F6 | nines-and-error-budgets | Nines, SLOs and error budgets | B | P2 | M6 |

**C · Caching**

| Code | Slug | Title | Level | Pri | Built in |
|---|---|---|---|---|---|
| C1 | caching | Caching | B | P1 | existing |
| C2 | cdn | Content delivery networks | B | P1 | existing |
| C3 | stale-data | Expiry & stale data | I | P1 | existing |
| C4 | cache-stampede | Cache stampede | I | P1 | existing |
| C7 | negative-caching | Misses that never hit | I | P2 | M6 |
| C5 | cache-write-strategies | Write-through, write-behind, cache-aside | I | P2 | M10 |

**D · Data**

| Code | Slug | Title | Level | Pri | Built in |
|---|---|---|---|---|---|
| D1 | indexes | Indexes | B | P1 | M6 |
| D2 (D1) | read-replicas | Read replicas | I | P1 | existing |
| D3 (D2) | sharding | Sharding | I | P1 | existing |
| D4 (D3) | consistent-hashing | Consistent hashing | I | P1 | existing |
| D6 | connection-pools | Connection pools | I | P2 | M8 |
| D7 | failover | Primary failover | I | P1 | M8 |
| D5 (D4) | consistency-vs-availability | Consistency vs availability | A | P1 | existing |
| D8 | quorums | Quorum reads and writes | A | P1 | M9 |
| D9 | leader-election | Leader election (Raft) | A | P1 | M9 |
| D10 | locks-and-double-booking | Locks and double booking | A | P1 | M9 |

**A · Async**

| Code | Slug | Title | Level | Pri | Built in |
|---|---|---|---|---|---|
| A1 | message-queues | Message queues | B | P1 | existing |
| A2 | publish-subscribe | Publish / subscribe | I | P1 | existing |
| A3 | retries-and-backoff | Retries & backoff | I | P1 | existing |
| A4 | idempotency | Idempotency keys | I | P1 | M7 |
| A5 | dead-letter-queues | Poison messages and dead-letter queues | I | P1 | M7 |
| A6 | outbox | The outbox pattern | A | P2 | M7 |
| A7 | partitioned-logs | Partitions, ordering and consumer groups | A | P2 | M7 |
| A8 | stream-windows | Windows and aggregation | A | P2 | M10 |
| A9 | sagas | Sagas: multi-step work that fails halfway | A | P2 | M9 |

**R · Resilience**

| Code | Slug | Title | Level | Pri | Built in |
|---|---|---|---|---|---|
| R1 | rate-limiting | Rate limiting | I | P1 | existing |
| R2 | circuit-breakers | Circuit breakers | I | P1 | existing |
| R3 | autoscaling | Autoscaling | I | P1 | existing |
| R4 | load-shedding | Load shedding and priority | I | P1 | M6 |
| R5 | bulkheads | Bulkheads | I | P1 | M6 |
| R7 | cascading-failures | Cascading failures | A | P1 | M6 |
| R8 | cold-caches-and-herds | Cold caches and thundering herds | A | P2 | M8 |
| R9 | hedged-requests | Hedged requests: beating tail latency | A | P2 | M9 |

**O · Operating**

| Code | Slug | Title | Level | Pri | Built in |
|---|---|---|---|---|---|
| O1 | canary-rollouts | Canary rollouts | I | P1 | M6 |
| O2 | graceful-shutdown | Graceful shutdown and draining | I | P1 | M6 |

**Count by milestone:** M6 builds 15 lessons, M7 builds 7, M8 builds 10, M9 builds 5, M10 builds 2.

### 6.3 Stories (journeys)

Each story is a `StoryDef` on the story player (D9). Stage-by-stage design is in curriculum §4.

| Code | Slug | Story | Built in | Needs batches |
|---|---|---|---|---|
| S0 | capstone | Keep a URL shortener alive (existing) | M5 (moved to the story player). M8 can add a fifth stage, "the primary dies". | today; B2b for stage 5 |
| S8 | web-crawler | Crawl the web politely | M7 | B1, B2a |
| S7 | video-premiere | Serve a premiere to the world | M8 | B1, B2b |
| S2 | chat | Deliver every message once | M8 | B1, B2a, B2b |
| S1 | flash-sale | Sell 1,000 seats to 100,000 people | M9 | B1, B2a, B3 |
| S5 | ride-matching | Match a rider to the nearest driver | M9 | B1, B2a, B3 |
| S3 | news-feed | Build a news feed | M9 | B1, B2a, B2b, B3 |
| S6 | payments | Charge exactly once | M9 | B1, B2a, B3 |
| S4 | click-counting | Count a billion clicks | M10 | B2a, B3, B4 |

### 6.4 Curriculum capability IDs by engine batch

| Batch | Capability IDs (curriculum §2) |
|---|---|
| B1 (M6) | NC1 link model, NC6 cached addresses, NC10 deadlines, NC13 batching, NC15 geo routing, NC16 session state, NC17 index cost, NC18 SLO metrics, NC22 negative cache and existence check, NC32 priority and shedding, NC33 bulkheads, NC34 overload crash and cold ramp, NC36 versions and canary, NC37 drain, NC38 stale-on-error and refresh-ahead, plus N1's per-request time breakdown |
| B2a (M7) | NC2 explicit acks, NC11 queue acks and dead letters, NC12 idempotency keys, NC14 back-pressure, NC28 outbox, NC29 partitioned log |
| B2b (M8) | NC3 windows and AIMD, NC4 connection setup and pools, NC5 connection modes, NC7 L7 gateway and L4 pinning, NC8 held connections and push, NC9 heartbeats, NC24 replica promotion |
| B3 (M9) | NC25 quorum, NC26 consensus, NC27 lock, lease and compare-and-set, NC31 saga, NC35 scatter-gather and hedging |
| B4 (M10) | NC20 cache write modes and write-behind, NC30 stream windows |

The architecture report's API sketches (§2.1–§2.5) are the starting design for each. Where the two reports name the same idea differently, the architecture report's field names win.

### 6.5 The recommended path

`PATH` follows curriculum §5, with optional and out-of-scope lessons removed.

1. **Band 1, beginner (about 70 minutes):** N1, N4, F1, N7, N9, F2, F3, F4, F5, C1, C2, D1, A1, N2, F6.
2. **Band 2, intermediate (about 2.5 hours):** N13, N5, N17, C3, C4, D2, D3, D4, A2, N11, A3, N15, A4, A5, R1, R2, R3, D6, D7, N12, R4, R5, O1, O2. Then the URL shortener story.
3. **Band 3, advanced (about 2.5 hours):** N10, N8, N16, C5, C7, N6, A7, A8, A6, D5, D8, D9, D10, R8, R9, N18, A9, R7. Then the other stories in the order S8, S7, S1, S6, S2, S3, S5, S4.

The home page also lists the curriculum's "interview fast lane" as a plain ordered list of links.

**Prerequisites** come from curriculum §3. M5's tests check that every prerequisite exists, comes earlier in `PATH`, and forms no cycle.

### 6.6 Backlog (P3, not scheduled)

These are specified in curriculum §3 and can be added after M10 without design changes:
- N3, N14, F7, C6, C8, C9, D11, D12, D13, D14, A10, R6, R10, R11, O3, O4.

Three of them are cheaper as a third option on an existing knob than as a lesson:
- C9 refresh-ahead on C4's knob.
- R6 fallbacks on R2.
- R10 limiter algorithms on R1.

### 6.7 Search terms

The phone route board's search matches titles, tags and these aliases (curriculum §7). Every lesson's `tags` includes the aliases that point to it.

- Load balancer, round robin, L4/L7, reverse proxy, API gateway
- Cache, Redis, Memcached, cache-aside, write-through, TTL, eviction, LRU
- CDN, edge, anycast
- Rate limiting, token bucket, sliding window, throttling, 429
- Message queue, Kafka, RabbitMQ, SQS, pub/sub, consumer group, dead-letter queue
- Sharding, partitioning, hot key, celebrity problem
- Consistent hashing, hash ring, virtual nodes
- Replication, read replica, failover, replication lag, leader election, Raft, quorum
- CAP, eventual consistency, strong consistency, PACELC
- Circuit breaker, timeout, retry, exponential backoff, jitter, idempotency, cascading failure
- WebSockets, SSE, long polling, TCP handshake, keep-alive, DNS, ack, at-least-once, exactly-once, backpressure, thundering herd, distributed lock, double booking, autoscaling, canary, SLO, error budget, outbox, saga

---

## 7. Milestones

Effort: S ≈ half a day, M ≈ 1–2 days, L ≈ 3+ days of agent work. Each milestone is one PR. "Skills" names the installed skills to load with the Skill tool at the start of that milestone.

Every milestone ends with the full gate (§10), screenshots at 1440×900, 1280×720, 390×844 and 844×390 in light and dark, checked by eye, and a short note in the PR description of what was verified and what was not.

### M0 — Truthful baseline (S)

**Goal:** nothing on screen teaches something false, and the tests describe structure instead of counts.
**Read first:** pedagogy §2 (audit), architecture §4.3 and §7.2.
**Done when:** the Change column only passes a verdict where one is meaningful, latency rows show their target, the dock states the clock in plain words, faults pair by id, and the test suite no longer hard-codes 19 lessons.

| Path | Change | What |
|---|---|---|
| `.gitignore` | modified | Add `.playwright-mcp/`. |
| `src/lib/sim/metrics.ts` | modified | `MetricSpec.better` gains `"neutral"` (no verdict colour). `inRotation` and `servers` default to neutral. Export `isLatency(m)`. |
| `src/lib/lessons/types.ts` | modified | `FigureDef.headline?: string` names the metric label the lesson's claim is about. It defaults to the fix figure's first metric. |
| `src/components/live.tsx` | modified | `Compare` takes `verdict: boolean`. It is true only when the lesson's tones are `problem,fix`. Otherwise `Delta` shows a signed difference in neutral grey. Neutral metrics never colour. Latency rows show "target ≤ {sloMs} ms" under the label. `Transport` shows "1 s on screen = {1000·timeScale·speed} ms" in place of "10× slow motion". |
| `src/components/player.tsx` | modified | Fault actions pair across figures by `id`, not array index: `figs.forEach((f, j) => f.actions?.find(x => x.id === a.id)?.run(live.sims[j], !on))`. Passes `verdict` to `Compare`. |
| `src/lib/sim/engine.ts` | modified | Optional constructor flag `new Sim(spec, { trace: true })` records first-attempt spawns `(t, client, key, op, cost)` in `sim.trace`. Tests only; off by default. |
| `tests/lessons.test.ts` | modified | Drop the exact count of 19. Assert unique slugs and codes, allowed tone sequences, at least two figures, and actions with the same label in two figures sharing an id. Add a fairness test: for every `problem,fix` and `tradeoff,tradeoff` pair, `sloMs`, `timeoutMs`, `timeScale`, `windowMs` match, and `sim.trace` of both worlds is identical after 5,000 ms. `problem,explore` lessons are exempt because the explore figure changes the traffic on purpose. |
| `tests/browser/site.spec.ts` | modified | F4 Fix: the "Servers in use" change cell has no `up`/`down` class. F1 explore: no verdict classes. |
| `src/lib/lessons/resilience.ts` | modified | *Added during M0.* R3's "Average busy" is `better: "neutral"`. The autoscaler aims at a target, so at night it correctly runs fewer, busier servers, and the fixed "low is better" painted that red. |
| `tests/metrics.test.ts` | new | *Added during M0.* Unit tests for neutral metrics, the signed difference and the clock text. |
| `CLAUDE.md` | modified | Note that faults pair by action id, and that problem/fix pairs must produce identical first-attempt arrival traces. |

**Tests:** the fairness test passes for every problem/fix and trade-off pair. A scratch check on 2026-10-22 found all 17 pairs already identical over 5,000 ms; F1's explore figure differs by design and is exempt. Unit tests cover neutral metrics and the clock text.
**Acceptance:**
- [x] F4 Fix shows "Servers in use 3 | 2" with a grey "−1" and no red.
- [x] F1's explore step and the consistency-vs-availability trade-off pair show neutral differences.
- [x] Every latency row in every lesson shows its target. This covers response times; see the job-wait note below.
- [x] The dock reads "1 s on screen = 100 ms" at 1× and "= 200 ms" at 2×.
- [x] `npm test` passes with no lesson count in it.

**Decisions made while building M0:**
- **The plain difference keeps the metric's unit:** "−1", "+52 ms", "+11/s". Shares use percentage points ("+55 pts"), so a difference can't be misread as the relative "▼ 4%" that verdict rows show.
- **"Latency row" means a response time judged against `sloMs`** (`p50`, `p95`). A1's "Email sent within" is a background job's wait. The scene has no target for it, and inventing one would be new lesson content, so it gets a target with `MetricSpec.target` in M4a.
- **The clock sentence stays hidden where the dock already hid "10× slow motion"** (≤1180 px wide and landscape phones). There, the speed control's accessible name and tooltip carry it. M2's dock makes it visible everywhere.

### M1 — Design system v3 and a legible stage (L)

**Goal:** the field-guide look in day and night, with every stage label at least 12 px and inside the stage on all four viewports, visible rails, larger dots, and every text pair at WCAG AA.
**Read first:** design-audit §2 (D1–D3, D5, D6, D9–D11, D18) and §3; motion-audit §3 (tokens) and §2.14.
**Skills:** `impeccable`, `frontend-design`, `taste-design-review`, `web-design-guidelines`.
**Done when:** the stage-fit and token tests pass on all four Playwright projects, and screenshots match the direction in design-audit §3.

| Path | Change | What |
|---|---|---|
| `src/app/globals.css` | modified | Rewrite the token block per design-audit §3: paper, surface, stage, ink, rails, cards, `--accent` and `--on-accent`, text-safe `--t-*` including `--t-stale` and `--t-req`, `--l-*-ink` for every line, and the night edition. Add the type scale, the 4-base space scale, the radius scale (4/8/12/20/999), three elevations, and the motion tokens (motion-audit §3). Remove the dot grid. Draw links as rails (two lines with a core). Restyle node cards. Badges and fault buttons use `--on-accent`; no hard-coded `#fff`. Station-dot hover uses `transform`. Remove `scroll-behavior: smooth` from `html`. Stage text sizes use `calc(var(--label-px) / var(--k))`. |
| `src/app/layout.tsx` | modified | Load all fonts as variable (no `weight` arrays). Add Newsreader as `--font-guide` with the `opsz` axis. Update `themeColor` to the new paper tones. |
| `src/lib/motion.ts` | new | `DUR`, easing functions, frame-rate-independent `smooth()`, `TAU`, `INTRO` (motion-audit §3). |
| `src/lib/sim/layout.ts` | modified | `frameFor(spec, mode, { k, labelPx })` reserves gutters for each node's label and sub-label: about 0.56 em per character for Atkinson and 0.6 em for mono, converted to viewBox units with k. Wide and compact frames grow W and H. The tall frame's width comes from the widest label. Export `labelExtent()` for side placement. |
| `src/components/stage.tsx` | modified | Two-pass fit (box → k0 → label-aware frame → k), memoised per box. Set `--k` on `.stage`. `pickMode` adds an aspect penalty: portrait never picks compact unless the scene has ≤2 lanes and ≤3 columns; landscape never picks tall. Zoom ceiling 1.45 for ≤2-lane scenes. Dot radius `6.4 × max(.9, scale)` with a 4.2 px rendered floor. Meters animate `scaleX`. No fresh ring under reduced motion. Read the measured box, not `clientWidth`, every frame. Shorter subs in compact and tall ("3 nodes", "ring"). |
| `src/components/glyph.tsx` | modified | Ink line-art bodies (1.5 px stroke, radius 10), embossed sockets, a short platform rule, node fill one step lighter than the stage. Shoulder badges for roles (LEADER, FOLLOWER) next to DOWN and OPEN. |
| `src/components/legend.tsx` | modified | Dot sizes and tokens follow the new scale. |
| `src/components/brand.tsx` | modified | Header and footer on the new tokens; 44 px touch targets. |
| `src/components/route-map.tsx` | modified | New tokens only (the structural rebuild is M5). Station codes use `--l-*-ink`. |
| `src/lib/lessons/data.ts` | modified | In consistency-vs-availability, node labels drop "· leader" and "· follower"; roles become badges. |
| `playwright.config.ts` | modified | Add `desktop-short` (1280×720) and `phone-landscape` (Pixel 7 at 844×390) projects. |
| `tests/browser/stage-fit.spec.ts` | new | For every lesson × step × project: every `.stage-svg text` box lies inside `.stage`; rendered label size ≥ 12 px and sub ≥ 11 px; no two `.node-label` boxes overlap; on phone projects every interactive element is ≥ 40×40. On desktop, single-row scenes' node union is ≥ 20% of stage height. |
| `tests/tokens.test.ts` | new | Parse the light and dark token blocks in `globals.css` and assert contrast: body text pairs ≥ 4.5:1, display text ≥ 18.66 px bold ≥ 3:1, `--on-accent` on `--accent` ≥ 4.5:1, badge text on its tone ≥ 4.5:1, `--l-*-ink` on paper ≥ 4.5:1, rails on stage ≥ 2:1. |
| `docs/screenshots/*` | modified | Refreshed home, lesson, phone and capstone captures. |

**Acceptance:**
- [x] No label is clipped or below 12 px on any lesson, step or viewport (stage-fit spec).
- [x] The token contrast test passes in light and dark.
- [x] In dark mode, rails are clearly visible and the primary button passes 4.5:1 (rails 2.40:1, button 6.05:1).
- [x] The landscape phone never shows a vertical stack, and portrait phones never squeeze a wide scene.
- [x] Reduced motion still opens on a settled still frame.

**Decisions made while building M1:**
- **Single rows zoom to 2.0, not 1.45.** At 1.45 a single row of stations fills only 18% of a 1440×900 stage, below the stage-fit test's 20%. The ceiling is now 2.0 for one lane, 1.45 for two and 1.2 for three. Zoom also stops wherever a waiting line would lose its room or a label would collide. C1 and C4 settle near 1.5; F1, A3 and R2 reach 21–24% of the stage.
- **Labels take the first clear side.** Placement tries each side in order of preference and checks it against every station and label shown in the same step. If no side is clear, the frame spreads the stations apart (smaller stations, same-size labels) until one is. The layout's own collision count is on the stage as `data-hits`.
- **The frame sees every step.** The stage takes `frameSpecs` (each step's scene) instead of one merged spec. `layout.ts`'s `combine()` replaces `combinedFrame` in `player.tsx`, so collisions only count between stations that appear together.
- **The tall layout spaces rows and lanes from label sizes.** Steps along the flow within 6 units share a row (pub/sub had six rows from near-duplicate columns). A box with spare width lets single stations keep their labels beside them.
- **Narrow layouts shorten subs with one shared rule** (`fitSub`: "down · taken out" becomes "taken out", "ring of 64 points each" becomes "ring"). Frames reserve the longest sub a node can show, so numbers changing never rescale the scene.
- **"Portrait" means a stage box at least 0.85 as tall as it is wide.** The portrait phone's stage is nearly square.
- **Width estimates:** 0.54 em per character for Atkinson bold (measured at 0.48–0.5) and 0.6 em for Overpass Mono.
- **Line colours for N and O are chosen and in the tokens now:** Networking olive `#6e7d14` (ink `#56620d`, night `#a8bb3a`) and Operating wine `#7a2f5e` (night `#d888b8`). Each is at least ΔE 29 from every dot and line in both themes, and the token test enforces ΔE ≥ 25. M5 only has to use them.
- **Small text on a line colour sits on the line's ink variant** (the bar code chip, the current station, small roundels), because the ink variants clear 4.5:1 both ways.
- **No TSX changes were needed in `legend.tsx`, `brand.tsx` or `route-map.tsx`.** Their tokens, type and 44 px targets all come from `globals.css`.
- **The stage-fill check measures each station with its labels**, the `.node` group a reader sees.

### M2 — Lesson player shell v2 (M)

**Goal:** a layout that gives narration a home, keeps the numbers in view, and fits 1280×720 without panel scrolling.
**Read first:** design-audit §5 and §6; pedagogy §3 (the layout sketch).
**Skills:** `impeccable`, `ui-ux-pro-max`, `taste-accessibility`.
**Done when:** the theatre has a beat-strip row, the compare table is pinned, the Key lives in the bar, and the panel does not scroll on Problem and Fix steps at 1440×900 or 1280×720.

| Path | Change | What |
|---|---|---|
| `src/components/shell.tsx` | new | `Shell` moves out of `player.tsx`. Its slots are bar, beat strip, stage, flight strip (hidden until M4), panel scroller, pinned panel and dock. Until M4, `BeatStrip` shows the scripted event note and replaces the floating `.note` toast. |
| `src/components/player.tsx` | modified | Uses `Shell`. Removes the stage tag, which duplicated the selected tab. `why` moves to the Recap and the bar title's `title`. Step tabs are content-sized and collapse to numbers when narrow. The dock gets a speed-cycle button, Back, a progress rail and Next. A phone `MetricSummary` row shows the headline metric and its change. |
| `src/components/live.tsx` | modified | `Transport` uses one cycling speed button everywhere. In `Compare`, both columns render at full strength, a 2 px line-colour rule marks the active column, and the change is a signed number with a thin bar (M0 semantics kept). New `MetricSummary`. |
| `src/components/legend.tsx` | modified | `KeyPopover`: a bar button and panel with a close button, Esc to close and focus return. No longer floats over the stage. |
| `src/components/capstone.tsx` | modified | Uses `Shell`. Single-column build controls; the target as a two-cell row with live values (design-audit D20). |
| `src/app/globals.css` | modified | Shell grid for desktop, ≤1180 px, ≤760 px portrait (bar 48 / stage 42svh / summary 44 / panel 1fr / dock 56) and landscape phones (bar 40 / stage 56% · panel 44% / dock 48). Two-row panel grid. Remove the `.stage-tag`, on-stage `.key` and `.note` styles. 44 px targets on touch. |
| `tests/browser/site.spec.ts` | modified | New selectors. No page scroll on all four projects. On the desktop projects, `.panel-scroll` does not scroll on Problem and Fix for every lesson. On phones, the summary row is visible without scrolling. The Key opens from the bar and closes with Esc. |
| `src/components/hero.tsx` | modified | *Added during M2.* The home scene uses the same sheet and `BeatStrip` ("Live · Server 2 crashed"), so the `.note` toast no longer covers its Users node. |
| `src/lib/sim/layout.ts` | modified | *Added during M2.* `TEXT.top`, M1's 56 px band kept clear for the floating Key, tag and notes, is gone. Frames keep the 16 px gutter on every side. |
| `src/lib/sim/metrics.ts` | modified | *Added during M2.* `formatChange` and `changeSize` for the Change column, unit-tested in `tests/metrics.test.ts`. |
| `src/lib/lessons/types.ts` | modified | *Added during M2.* `headlineOf(figures)`, shared by the phone summary and the fix-beats-problem test. |
| `tests/browser/stage-fit.spec.ts` | modified | *Added during M2.* "The Key covers no station" becomes "nothing covers a station": the top-most element at every station's centre belongs to the stage. The beat strip and the stage never overlap. |

**Acceptance:**
- [x] At 1280×720 no lesson's Problem or Fix panel scrolls. Before M2, 23 of the 36 Problem and Fix steps did; the plan's "11" was counted before M1's larger type. The tightest is D1's Replicas step, with 17 px to spare; every other step has 57 px or more.
- [x] On a 390×844 phone the headline number is visible without scrolling on every lesson, and tapping it brings the full table into view. Landscape phones show it above the panel.
- [x] Nothing floats over the stage except the beat strip's own row. The stage-fit spec checks every station on every step and project.
- [x] Keyboard: Tab visits the bar, the summary, the panel and the dock in that order, and Esc or the close button shuts the Key and hands focus back to its button.

**Decisions made while building M2:**
- **The phone theatre is 46svh, not 42svh.** The 32 px beat strip sits inside the sheet. At 42svh a 390×844 phone's stage is 372×308, a ratio of 0.83. That is below M1's 0.85 portrait threshold, so wide scenes would be squeezed into the compact layout, which the stage-fit test forbids. 46svh, the figure in pedagogy §3's sketch, gives 0.91.
- **The tone word moved from the panel to the beat strip.** "The problem" or "The fix" opens the strip, where the stage tag used to float. The tab carries the step's name, and the panel heading stands alone with no eyebrow. This answers D13 (one label three times) and saves 32 px of panel height.
- **Until beats exist, the strip shows the scene's events.** A fresh one is in ink; the latest one stays, muted, until the next. Before the first event, only the tone word shows. Only a fresh event is announced to screen readers, through a separate live region, so switching steps doesn't re-announce an old one.
- **On portrait phones the clock is on the beat strip.** There, the transport and the Next button fill the dock. Everywhere else the clock sits in the dock beside the speed button. Exactly one clock is visible on every screen, and a test checks it.
- **The Key is a native popover** (`popover="auto"`) with the dialog role.
  - Opening it moves focus to its close button.
  - The browser handles Esc, a click outside, and returning focus to the Key button.
  - It is fixed under the bar, on top of everything.
- **Tabs collapse to their numbers when the names don't fit.**
  - `player.tsx` measures each name's natural width; when the row runs short, the other tabs become 44 px number pills and the selected tab keeps its name.
  - A squeezed tab's name wraps out of sight inside it, so it stays the tab's accessible name.
  - The number is part of that name too ("2 With cache"), because it is the squeezed tab's visible label.
  - At the test sizes this happens to 2 lessons at 1280×720 and 3 on the 844×390 phone.
  - A test fails any tab taller than one line, any name cut part-way, and any nameless tab wider than its number.
- **Tabs follow the tabs pattern.** Arrow keys (wrapping), Home and End move between steps. Only the selected tab is a Tab stop.
- **Change-column text.** "−4%" and "+38%"; "×20" from ten times up (a true ratio, so 2 → 40 now reads ×20, not 19×); "new" from zero. Each sits over a bar as long as the change, capped at a doubling. Plain differences keep M0's units.
- **The sparkline has its own narrow column**, so each row is one or two lines.
  - A container query drops that column when the panel has under 350 px for the table, rather than let the numbers run past its edge.
  - Screen readers skip it; it pictures the numbers they already hear.
  - Tables keep up to five rows: D1 and A1 need five, and five fit at 1280×720.
- **The panel is 31vw (368–440 px).** Its grid column is `minmax(0, 1fr)`: an `auto` column grew to the table's width and pushed the panel's right edge off screen at 1280×720. A test now fails anything in the panel that runs past its padding.
- **Short screens get a slimmer frame.** At 760 px tall or less (1280×720), the bar is 52 px, the dock 56 px and step titles 22 px. Sliders are 24 px tall for a mouse and 40 px for touch. The tightest step, D1's Replicas (a 29-word caption, two knobs and five table rows), has 13 px to spare; every other step has 95 px or more. M4b's 25-word captions will widen that.
- **The Recap gets the `why`**, under the heading "What to remember". The Recap is not a Problem or Fix step, and 18 of them scroll at 1280×720, by 8 to 126 px.
- **The phone summary row collapses where a page has none.** The capstone shows its numbers as the target cells and the hold bar instead.
- **The capstone pins only the target and the hold bar.** The busy meters moved into the scroller, so the build controls and the running cost stay in view at 1280×720.
- **Landscape phones put the controls above the caption**, using CSS order, so the knob or fault is in reach without scrolling.
  - Their bar is 44 px, not 40, because the controls in it are 40 px tall.
  - The summary sits above the panel, where it comes in the Tab order.
- **Small phones held sideways take the landscape layout.** A 667×375 phone is both 760 px or narrower and landscape, so the portrait rules now apply only in portrait or at heights over 520 px. Without that, the stage fell into the strip's row. A test at 667×375 covers it.
- **Only transform and opacity animate.** The active column's rule, the progress stations and the strip's text change state at once. The Play button keeps one name, "Play", and `aria-pressed` says whether it is playing.
- **Trade-off steps are neutral ink, not violet.** The strip showed "Trade-off" in the stale dot's violet, a second meaning for that colour. A trade-off has no better side, so it takes no colour.
- **Labels keep off rails.** The M2 review found labels lying across rails (the capstone's "Server 1" at 844×390).
  - Once the frame is sized, such a label moves to a side that is clear of stations, labels and rails and still fits the frame. Keeping off a rail is never worth shrinking the scene.
  - New sides sit just beside a rail running down from a node, or beside a node but off its rail's line. `labelSpot()` gives the layout and the renderer the same offsets.
  - On phones, a rail leaving a node downward starts beneath its label, the same stretch its requests already travelled.
  - Where no side is free (D3's middle cache, between two rails), the label sits on a plate in the sheet's colour and the rail passes under it.
  - The stage-fit test fails any rail showing through a station label.

### M3 — Motion that teaches (L)

**Goal:** the stage alone shows the mechanism: where load flows, what a hit, miss and eviction are, queues as pressure, copies on their way, breaker states, and parts entering and leaving.
**Read first:** motion-audit §1, §2, §4, §5 in full.
**Skills:** `design-motion-principles`, `animate`, `taste-motion`, `animation-performance`; audit the result with `improve-animations` (or `review-animations` if the Skill tool lists it).
**Done when:** every item in motion-audit §2.1–§2.13 except the tracer (M4) is implemented with its reduced-motion fallback, and the frame-budget test passes.

| Path | Change | What |
|---|---|---|
| `src/lib/sim/types.ts` | modified | `FxKind` adds `evict`, `fill` and `hot`. `Fx.slot?` holds the queue index for drops. |
| `src/lib/sim/engine.ts` | modified | Emit `evict` in `evict()`, `fill` where a cache entry is written, and `hot` on entering the hot condition. Record the queue index on `drop`. Expose `breaker.trialId`. These are output only and change no simulation result. |
| `src/lib/sim/metrics.ts` | modified | `flowOf(sim, a, b)`: EWMA rate and error share per link. |
| `src/components/stage-draw.ts` | new | Canvas helpers moved out of `stage.tsx`: dots batched by style, trails, the effect renderer and per-node ring budget, queue pressure wedge, cache fill and evict squares, replication copies. |
| `src/components/stage.tsx` | modified | Rings only for state changes (outcome rings removed). Hit pop at the cache. Queue spacing compresses as it grows. Drops leave from the queue tail. Link-flow overlay on rails. Three-state breaker pill with a sliding marker. Scene intro builds in along the flow with a one-time stroke draw. Step switches render the union of nodes, so absent ones exit. Crash body drop. Rings on entering a state. React re-renders only when a cheap stage signature changes. Memoised `NodeView` and `LinkView`. |
| `src/components/live.tsx` | modified | Cancel rAF when hidden or off screen. Tick on change. Metric change cue in `Compare` (flash and arrow nudge). |
| `src/components/player.tsx` | modified | `KnobControl` keeps a local value and commits at most once per frame. Lesson-to-lesson continuity uses a module-level variable (survives client navigation, no storage), so the next lesson's intro skips nodes it shares with the previous one. |
| `src/app/globals.css` | modified | Keyframes `node-intro`, `link-draw`, `node-leave`, `node-drop`, the pill marker, `.link-flow`, metric flash, all on the motion tokens. |
| `tests/sim.test.ts` | modified | New fx kinds fire in the right conditions. `done` arrays are identical whether or not anything reads `fx`. |
| `tests/browser/motion.spec.ts` | new | On `/learn/rate-limiting` at 2× and the built-out capstone, with 4× CPU throttling on desktop and mobile: rAF gap p95 ≤ 17 ms, no gap > 34 ms, app callback p95 ≤ 4 ms. Under reduced motion: sim time does not move, no intro runs, and no fresh ring element exists. |

**Acceptance:**
- [x] In C1 Fix, a miss visibly fills the cache bar and an eviction drops out of it. The fill is a cobalt square sliding into the bar; the eviction is an ink chip, not the planned slate square (see the decisions). `tests/motion.test.ts` checks the engine fires both, and frame captures show both.
- [x] In R2, the breaker pill slides closed → open → testing → closed, and the payments rail empties while open.
  - A break-mark sits on the rail and its glow goes out.
  - The engine test checks that only legal moves happen and that no request crosses the rail while the breaker is open.
  - A browser test watches the pill open.
- [x] In consistent-hashing, the hit rate dips and the database rail brightens when cache 4 joins. Measured at the second join, once the caches are warm:
  - hash % N: 14 → 25 database requests per 800 ms, and hits fall from 66% to 51%;
  - the hash ring: 11 → 13.
  - Nothing yet shows a single key moving; the dip shows as the faint miss rings and fill squares at the caches. Following one request is M4's tracer.
- [x] One tab switch uses two beats of one duration family. Every switch animation has a delay of 0 or 120 ms and a duration of 120, 160, 240 or 480 ms, which a browser test checks.
- [x] Frame-budget and reduced-motion tests pass. At 4× CPU slowdown, on rate limiting at 2× and the built-out capstone, desktop and phone:
  - frame gaps are 16.7–16.8 ms at p95 and 16.8 ms at worst (budget: 17 and 34 ms);
  - the app's work per frame is 0.7–1.5 ms at p95 (budget: 4 ms).

**Decisions made while building M3:**
- **Hits and misses keep a faint ring at the cache.** The pop (hit) and the sliding copy (miss) carry the meaning, but C1's caption names a "green ring" and an "amber ring". So each cache gets at most one small, faint ring every 250 ms; M4b's new copy can drop it. Every other outcome ring is gone: rings mark state changes only.
- **An eviction falls as a flat ink chip, not a slate square.** A slate square already means "turned away", and an evicted entry is data, not a request.
- **Link flow is counted in the engine.** `Sim.links` counts sends per link and the errors that come back along it.
  - `flowOf` smooths that over 250 simulated ms, not 400, so a rail visibly empties within a breaker's 600 ms open time.
  - An open breaker's rail drops its glow at once.
- **The breaker pill is the state word with a marker sliding along its foot.** There is no room for three labelled segments on a station's shoulder. Its colour changes at once: only transform and opacity animate.
- **Running hot is an engine flag with hysteresis.** It turns on when the line passes twice the workers and off when it falls back to the workers' count. Its ring fires once per rise, not on every tick, and the stage's hot outline reads the same flag.
- **A long waiting line packs to 0.88 and 0.78 of its spacing**, not 0.85 and 0.72: tighter read as a smear, not as a line.
- **The stroke draw uses each link's on-screen length (`--len`).** `pathLength` does not combine with the rails' non-scaling strokes.
- **The intro starts in the render that first has a measured layout,** so the scene never shows for a frame before it. The measured layout replaces the first guess outright, so nothing glides from a guessed place.
- **Lesson-to-lesson continuity is a module variable** of the last stage's stations (glyph and label), recorded only by an unmount after 300 ms so the development double-mount can't erase the intro. The 160 ms cross-fade on "Next stop" was left out: the skipped intro carries the continuity.
- **React re-renders at the 11 Hz tick as before; memoised `NodeView` and `LinkView` make that cheap.** The plan proposed rendering only when a stage signature changes, but the panel's numbers need the tick anyway, and the frame budget holds with room to spare.
- **The metric cue fires when a number changes tone or a change flips direction**, at most once per cell every 1.5 s. A cue on every unit of change would flicker constantly with live numbers.
- **The engine-output tests live in a new `tests/motion.test.ts`**, beside the stage-side claims they back, rather than in `tests/sim.test.ts`.
- **Frame budgets run in their own Playwright projects after the others**, alone. With three workers sharing the CPU, the 4× throttle measured the harness, not the app.
- **Focus (§2.8) is built but not used yet.** `Stage` takes `focus` and dims every station, link and request outside it. M4a's beats will drive it.
- **Not built:** the write's pop at the primary when it spawns a copy (§2.6). The copy itself, its trail and the replica's violet rule carry the idea.
- **The `improve-animations` audit** found three things, all fixed: the metric cue could restart every tick at a tone boundary; the pill marker and the intro used literal durations instead of tokens; Back popped in. The exit curve, the 480 ms glide and step switches animating on arrow keys are documented choices in motion-audit §3, so they stand.

### M4a — Concept delivery runtime and three reference lessons (L)

**Goal:** the beat system works end to end on F1, C1 and A3, written exactly as pedagogy §4's rewrites.
**Read first:** pedagogy §3, §4 and §6; architecture §3.
**Skills:** `taste-ux-copy`, `impeccable`, `taste-accessibility`, `testing`.
**Done when:** F1, C1 and A3 run with hook, build, beats, prediction, armed break, compare sentence, checks and rule, including the reduced-motion path.

| Path | Change | What |
|---|---|---|
| `src/lib/lessons/beats.ts` | new | Types `Beat`, `BeatTrigger` (`at`, `fx`, `note`, `metric`, `step`), `Focus`, `Prediction`, `Check`, `TraceSpec`. `BeatRunner` evaluates triggers against simulation time and events only. A template formatter resolves `{p95:fix}`, `{util:db:problem}`, `{queue:app}` from `measure()`. |
| `src/lib/lessons/types.ts` | modified | `Lesson` gains `level`, `minutes`, `hook`, `dots`, `checks`, `takeaways.rule`, `takeaways.interview?`. `FigureDef` gains `build`, `beats`, `predict`, `break`, `headline` (now `{ metric, sentence }`), `invite`, `key`. All optional, so unconverted lessons still run. |
| `src/lib/sim/types.ts`, `src/lib/sim/engine.ts` | modified | `ScriptEvent.armed?: true`. `sim.fire(label)`. Armed events never loop. `sim.hold()` and `sim.start()` gate arrivals for the build phase, applied to both worlds together. |
| `src/lib/glossary.ts` | new | Terms: key, name, alias, a short definition of ≤20 words, and "show me" (lesson and focus). |
| `src/components/term.tsx` | new | Renders `[[key|plain words]]` with a dotted underline. Tap opens the definition and "Show me". |
| `src/components/beats.tsx` | new | `useBeats(live, figure)`, `BeatStrip`, `Callout` anchored to a node box, the beat list for the panel, `PredictCard`, `CheckCard`. |
| `src/components/follow.tsx` | new | Follow one request: picks the next request at a tick boundary, narrates each hop, and draws the flight strip timeline (wait, service, travel) with the result held for 2 s. |
| `src/components/stage.tsx` | modified | `focus` prop dims everything not in focus (opacity only). `anchorFor(id)` returns CSS px. Follow halo and path. Countdown chip on armed nodes. Visible-node set for the build phase. |
| `src/components/live.tsx` | modified | `pause()`, `play()`, a temporary rate multiplier, `stepTo(simMs)` for reduced-motion beat stepping. Tap a compare row to open its explainer: a sentence with the target and "why it moved". |
| `src/components/player.tsx` | modified | Next advances the current step's beats, then the step. The hook question sits at the top of the panel; the why stays on the Recap, where M2 moved it. Local key from `lesson.dots`. The Recap gets checks and the rule. Keys: `[`/`]` beats, `f` follow, `1`–`3` steps. |
| `src/lib/sim/metrics.ts` | modified | `MetricSpec.explain` and `MetricSpec.target`. |
| `src/app/glossary/page.tsx` | new | Static glossary page with each term's first lesson. |
| `src/lib/lessons/foundations.ts`, `caching.ts`, `async.ts` | modified | F1, C1 and A3 converted with pedagogy §4's text. A3's stall becomes armed. |
| `tests/lessons.test.ts` | modified | Beats validation: every beat fires within the run, focus ids exist, placeholders resolve, prediction answers hold in the engine, checks have 2–3 options, beat text ≤ 16 words. `autoFire(sim)` for armed events in claim tests. |
| `tests/browser/site.spec.ts` | modified | Next walks beats then steps. Reduced motion shows the "What to watch" list and Step fires the first beat. Follow shows the flight strip. A wrong check answer spotlights the right node. |

**Acceptance:**
- [x] On F1, a first-time viewer gets a callout pointing at Server's sockets within 3 s (at 2.5 s, with the sockets outlined), and the scene pauses for the prediction.
- [x] On A3, pressing "Stall the service" in the beat fires the stall in both worlds at once, and the problem column shows the outage within 15 s of real time (about 8 s of running scene).
- [x] Under reduced motion, Next steps through the same beats on still frames; Step brings on the next beat too.
- [x] Each beat is announced through the `aria-live` region exactly once.

All four are browser tests in `tests/browser/beats.spec.ts`. Gates on 2026-10-23: typecheck, 94 unit tests, build, and the browser suite (431 passed, 5 skipped, frame budgets included) all green.

**Decisions made while building M4a:**
- **Beats fire on a 10 ms grid of simulated time.** `stepGrid` (in `beats.ts`) steps every world in lockstep and stops at each grid point for the runner, so the same beat fires at the same simulated moment at any speed or frame rate (`tests/beats.test.ts` checks four frame lengths). It gives exactly the run one big step gives.
- **Beats fire in order.** A beat may fire once the one before has had `PACE.read` (3 s on screen at 1×) or the learner moved on. A paused beat holds both worlds. Next releases a paused beat, skips the question, or fast-forwards both worlds until the next beat's trigger really holds (so its words are never early); if it never holds within 30 s of simulated time, Next shows it anyway (`runner.skip`). Reduced motion uses the same path, and Step does what Next does until the step's beats are done.
- **Triggers:** `at` counts from when the step's traffic began; `wait` from the previous beat; `fx` since the previous beat; `note` since the step began (or `since: "lesson"`), so an event that happens while the previous beat is still on screen isn't missed; `metric` with an optional `forMs`. Placeholders are filled in as a beat fires, so a beat's numbers never flicker and the live region announces it once.
- **Build lines are the `parts` field** (`build` was taken by the scene builder). They are a tour with the spotlight while the clients are held (`sim.hold()`), not stations appearing one by one: the M3 intro already builds the scene along the flow, and this keeps its frame and its lesson-to-lesson continuity.
- **Held clients keep their arrival clock and draws and send nothing,** so the traffic after `start()` is the same whenever the learner starts it. The first version re-seeded arrivals on `start()`, and clicking through the build lines changed the whole run (F1's line then came 16 s of simulated time late).
- **Callouts:** on wide stages the beat's words sit in a card beside the station it names, with an ink leader, in the first clear spot (above, right, left, below) that keeps off every station and label, preferring spots over fewer rails. The strip then shows only the step's place in its beats. Phones, landscape phones, beats that point at the panel, and crowded stages carry the words in the strip, which grows to two lines on phones. A test checks a callout never covers a station or label.
- **Touch layouts mark terms as words, not buttons,** and list the step's terms as 40 px chips in the panel: a 40 px target can't sit inside a sentence, and the 40 px rule stays whole. The table's row names (which open the explainer) are 40 px tall there too.
- **The prediction can compare two worlds** (`track.afterWorld`), and a claim sentence can be read at a named beat (`headline.at`), for faults whose moment has passed by the Recap.
- **Succeeded reads 0%, not "—", when requests went out for a whole window and none came back** (untagged `answered` only). Without it A3's outage showed as no data. The Change column's ratio now treats a value eased almost to zero as zero (it had shown "×1.5e+29").
- **Copy changed from pedagogy §4 where the engine or the rules disagreed:** A3's answer is "never recover at this traffic" (the problem world stays at 0% for 30 s after one stall; a unit test holds it there for 20 s), and its fix step narrates the fix world recovering from the same stall rather than asking for a second one. C1's answer is "Well over half" (its hit rate runs 50–80%, not three quarters) and "Nothing fails yet" (its line fills and fails later). F1's build line says "works on 4 at once" so "worker" is named by its beat, and its traffic is a calm 20 a second with a rush to 44 that builds a line of 10 at 21 s on screen (seed 24, chosen by searching against the walk). Beats over 16 words and build lines over 9 were cut to fit.
- **Following a request keeps the learner's speed** (no forced 0.5×): a C1 read waits about a second of system time, which would be 20 s on screen at half speed. The flight strip takes the beat strip's row, so the stage never resizes.
- **`walk.ts`** walks a lesson as a learner would (reads each beat, answers, presses each break). The tests use it to prove every beat fires and every prediction holds; `npm run tune -- <slug> --beats` prints the timeline.

**Left for M4b** (done, below): the other 15 lessons, the hero, the capstone, the rest of the glossary, captions ≤25 words everywhere, the `CLAUDE.md` conventions, and arming the looping faults.

### M4b — Convert the remaining lessons (M)

**Goal:** all 18 lessons, the hero and the capstone stages use the beat structure.
**Read first:** pedagogy §4 (copy rules) and the three converted lessons.
**Skills:** `taste-ux-copy`.

| Path | Change | What |
|---|---|---|
| `src/lib/lessons/*.ts` | modified | Hooks, build lines, beats, predictions, checks and rules for the 15 remaining lessons. Outage and event loops in scaling-up-vs-out, health-checks, publish-subscribe, consistent-hashing, consistency-vs-availability and circuit-breakers become armed breaks. F1's wave shortens so the peak arrives within 25 s. |
| `src/lib/lessons/hero.ts`, `src/components/hero.tsx` | modified | The hero gets three looping beats in its strip; it keeps its loop. |
| `src/lib/lessons/capstone.ts`, `src/components/capstone.tsx` | modified | Each stage opens with two beats pointing at the box to watch. |
| `src/lib/glossary.ts` | modified | All terms the 18 lessons name. |

**Acceptance:**
- [x] Every lesson passes beats validation: the authoring rules, and a learner's walk in which every beat fires and every prediction comes true (`tests/lessons.test.ts`, 18 lessons).
- [x] No caption is over 25 words (the hero's too). `CLAUDE.md` now says 25, not 60.
- [x] No term is used before the beat that names it: the test reads each lesson in order and fails any use of a term's name, marked or plain, before its first marked use.

Gates on 2026-10-23: typecheck, 126 unit tests, build, and the browser suite (431 passed, 5 skipped, frame budgets included) all green. Screenshots of all 15 converted lessons, the hero and the capstone at 1440×900, 1280×720, 390×844 and 844×390, light and dark, were checked by eye.

**Decisions made while building M4b:**
- **Armed faults** in F2, F4, A2, D3, D4 and R2 use `kit.ts`'s `armed` (a fault and its end, at a fixed spacing) and `fault` (its button). One button fires the fault in every world under the same labels, so each world can do its own thing: F2 crashes the big server in one world and server 1 in the other. The hero and the capstone keep their loops.
- **A step whose fault is still on when you reach it narrates it rather than asking for another press** (D4's cut, A3's stall); a step after the fault has ended asks again ("same crash, both worlds"). A break beat whose fault the learner already caused lets itself go.
- **Comparisons are read at one moment in both worlds.** A prediction can read both numbers at the reveal (`track.same`), a trigger can watch another world (`metric … world: 0`, so C4 reveals at the problem world's next stampede), and the Recap's claim is read at a named beat (`headline.at`) for faults whose moment has passed.
- **Scenes with a warm-up don't hold their traffic** for the build lines (C2, C3, D3): they open mid-flow on purpose, with warm caches.
- **Predictions changed where the engine disagreed:** D2 asks whether the slowest 1 in 20 drops under the target (the busiest shard hovers around 70%, not safely under it); C4 asks about the database's line at an expiry (coalescing barely changes total database reads); C2, C3, F3, R1 and R3 compare both worlds at the reveal.
- **Scenes changed to tell their story on time:** A1's line holds 6, not 10, so every burst overflows (it took 98 s to drop one sign-up), and its bursts start 1.4 s in; its "Email sent within" row now has a 2 s target (M0's note). F2, F3, F4, C2, C3, R2 and R3 had triggers moved so each comparison is read once the worse world has caught up.
- **Terms never come before their naming beat**, so some titles and captions were reworded (C1 "goes to the database", C2 "Caches next to each region", D1 "Writes to one, reads from its copies", D2 "Split the keys across databases", R1 "A limit per client", R2 "Stop calling after repeated failures").
- **The reduced-motion list shows beats only** (not build lines or invitations), one line each with the current one in full, and takes the caption's place, so every Problem and Fix fits 1280×720. R2's problem has five beats and a one-line title to fit.
- **On touch layouts a "follow one" beat doesn't start following by itself**: the flight strip would cover the strip that carries the beats. The beat still invites the tap.
- **Bugs found by the screenshot pass and fixed:** the strip's line clamp also caught a term's own span (a phone strip read "a / cache stampede / . Its line jumps."), and the phone flight strip clipped its totals.
- **The hero's three beats live in its strip only**, with no spotlight on the home page. Each capstone stage opens with two beats and a callout; a scripted event newer than the beat (server 1 crashing) takes the strip.
- **Tests adapted to armed faults:** D3's unit and motion tests and the output-only test fire the fault where its script says; the R2 browser test presses "Make payments hang". The step-switch timing test leaves out the spotlight's dim, which follows the beats and is reversed mid-fade when a step's first beat moves the focus.

**Not verified:** real phones and screen readers (the live region is tested for one announcement per beat, not listened to); the learner-facing timing at 0.5× and 2× beyond the determinism test.

### M5 — Catalog v2, route map and home, story player (L)

**Goal:** the course structure scales to about 60 entries: levels, lines, prerequisites, a home page and map with three zones and journeys, per-lesson code loading, and one player for every story.
**Read first:** architecture §4 and §5; design-audit §4; curriculum report (catalog and paths).
**Skills:** `impeccable`, `vercel-react-best-practices`, `find-docs` (Next 16 lazy loading and `generateStaticParams`).
**Done when:** the 18 lessons and the capstone come from the new registry, each lesson page loads only its own scene module, the map draws zones from data, and the capstone runs on `StoryPlayer`.

| Path | Change | What |
|---|---|---|
| `src/lib/lessons/catalog.ts` | new | Metadata for every lesson: slug, code, line, title, why, level, minutes, tags, requires, kind, status, aliases. |
| `src/lib/lessons/scenes/index.ts` | new | `SCENES`: a literal `import()` map from slug to scene module. |
| `src/lib/lessons/scenes/<slug>.ts` | new (moved) | One file per lesson, moved from the five line modules: figures, takeaways, beats, checks, claims. |
| `src/lib/lessons/foundations.ts`, `caching.ts`, `data.ts`, `async.ts`, `resilience.ts` | deleted | Content now lives in `scenes/`. Shared helpers such as `outage` move to `kit.ts`. |
| `src/lib/lessons/index.ts` | modified | `LINES` with level and order. Registry exports `LESSONS`, `getLesson`, `lineOf`, `lessonsOn`, `neighbours`, `nextFor(slug, visited)`, `lessonsAt(level)`, `storyList()`, `prerequisitesOf(slug)`. |
| `src/lib/lessons/story.ts` | new | `StoryDef`, `StoryStage`, `Target`. The capstone becomes the first story. |
| `src/lib/lessons/capstone.ts` | modified | Rewritten as a `StoryDef`. |
| `src/components/story-player.tsx` | new | Generic stage-by-stage player on `Shell`, `useLiveSims` and the hold logic. Controls render from `StoryDef.controls`. |
| `src/components/capstone.tsx` | deleted | Replaced by `story-player.tsx`. |
| `src/components/player.tsx` | modified | Loads `SCENES[slug]()` with `React.lazy` inside `Suspense` (fallback: the shell with an empty stage). Prefetches the next lesson's module when idle. |
| `src/app/learn/[slug]/page.tsx` | modified | Chooses the player by `kind`. Metadata from the catalog. |
| `src/components/route-map.tsx` | modified | Geometry generated from the registry: rows are lines, column bands are zones, sticky line heads, a pannable frame, a journey overlay. Station hover or focus opens `StationPreview`. On phones, `RouteBoard`: collapsible lines with counts, a level filter, and search. |
| `src/components/station-preview.tsx` | new | A warmed mini-scene card. One mounted at a time; a still frame under reduced motion. |
| `src/components/journeys.tsx` | new | Journey cards: title, roundel stops, stage count, and a live final architecture for the card in view. |
| `src/app/page.tsx` | modified | Masthead at about 58vh with counts read from the catalog. A continue card from the visited list. The map, journeys, and a live one-rail "how to read a scene" demo. |
| `src/components/hero.tsx` | modified | Phone hero becomes a compact 200 px ticker scene. |
| `next.config.ts` | modified | `redirects()` from catalog aliases. Empty today; the mechanism exists for later. |
| `scripts/new-lesson.ts` | new | Scaffolds a scene file and a catalog entry. |
| `scripts/tune.ts` | modified | `--line`, `--level`, `--json`, `--beats`. |
| `tests/lessons.test.ts` | modified | Catalog invariants: every `requires` exists, appears earlier in `PATH` and forms no cycle; minutes 3–12; at least one tag; codes unique; `PATH` lists every live lesson exactly once; `SCENES` covers every slug; the capstone test becomes a per-story test. |
| `tests/catalog.snapshot.json` | new | Committed slug → code map. A test compares it with the catalog, so any code change shows up in review. |
| `tests/browser/site.spec.ts` | modified | Home lists every station. The phone level filter works. "Next stop" follows `PATH`. Every story passes the capstone checks. |

**Also in M5:**
- **Final codes, once** (A6). Number each line in its §6.2 row order (N1, N2, N3… in level order), including codes for lessons that are not built yet, and record them in the snapshot. Existing lessons move to their final codes now (the Data line shifts by one so Indexes can be D1). After M5, codes never change. A line can show a gap until its missing lessons land. The capstone's code becomes S0.
- **Working codes vs final codes.** This plan and `curriculum.md` name lessons by their working codes. The slug is the stable key; look a lesson up by slug.
- **`PATH`** from §6.5, filtered to live lessons. `neighbours()` and the dock's "Next stop" follow it. The home page's start button points at the first live lesson in `PATH`, which is F1 until N1 exists in M6.
- **Line colours** for N and O join the tokens now, with their ink variants, even though those lines are empty until M6.

**Acceptance:**
- [x] The home page's JavaScript no longer includes any lesson's `build` code. After `npx next experimental-analyze -o`, the first-load chunks of `/` and `/learn/[slug]` hold the catalog but no scene text; each lesson's scenes are a chunk of their own of 4–8 KB raw. First load is 192 KB gzipped for `/` and 191 KB for a lesson page, plus its scene.
- [x] Every existing URL still loads: the per-lesson browser test opens all 18 lessons and the capstone on every project.
- [x] The map shows three zone bands at 1440 px (a browser test checks a station sits in its level's band) and a collapsible board at 390 px (a test filters it by level and searches it).
- [x] The capstone behaves as before on `StoryPlayer`. Its stage-clearing test runs for every story with the same rule and the same designs; the browser checks are the same, run for every story.

Gates on 2026-10-24: typecheck, 134 unit tests, build, and the browser suite: 452 tests, of which 436 passed and 11 were skipped in the full run; the 4 frame budgets passed in their own run, and one keyboard test that lost a race under load (`]`, then `[`) now pauses the scene first and passes 16 of 16. Screenshots of the home page, the map with a station card, the journey card, a lesson and the story player at 1440×900, 1280×720, 390×844 and 844×390, light and dark, were checked by eye.

**Decisions made while building M5:**
- **Final codes follow the row-order rule literally.** Consistency vs availability is D7, not D5: as an advanced lesson it comes after connection pools (D5) and failover (D6). "Shifts by one" holds for the old D1–D3 only. The other moves from working codes: latency vs bandwidth N3, handshakes N4, DNS N5, windows N6, push vs poll N7, timeouts N8, congestion N9, head-of-line N10, L4/L7 N11, pipelining N13, delivery guarantees N14, backpressure N15, nearest region N16; negative caching C5, write strategies C6; cascading failures R6, cold caches R7, hedged requests R8.
- **Stories are numbered in §6.3's row order, which is their build order**, so their codes arrive without gaps: web crawler S1, video premiere S2, chat S3, flash sale S4, ride matching S5, news feed S6, payments S7, click counting S8.
- **The catalog holds the planned course too** (`status: "planned"`): each entry's title, why, level, minutes, tags and prerequisites from the curriculum. The snapshot, the path and the prerequisite graph are checked against one list, and `npm run new-lesson` turns an entry live. Planned entries have no page and are not drawn. The owner chose a map of live lessons only.
- **A live entry's prerequisites are live ones only**, or the map would dim it for good. The curriculum's edges to lessons not built yet are comments in `catalog.ts`, to add when they land: N1 before F1, D1 before D2, N2 before A3 and D7, N8 before R2.
- **A story's `requires` are the lessons it rides, in ride order**, rather than a separate `stops` field. The map draws the journey's route and its card lists the stops without loading the story's code. The capstone rides C1, F3, F4, D2 and R1.
- **`StoryDef`**: `controls` (counts and switches), `start`, `cost`, `scene`, `targets`, `metrics`, `stages`, `win` and an optional `lead` for the strip ("40 a second"). Each stage carries `params` (what it throws at the system) and the `solution` it was made for, which the tests use. `holds()` keeps the capstone's rule: a missing response time fails, and failures are always measured once a response time is.
- **A lesson page reads its scenes with `use()` on a cached promise that records how it settled**, rather than `React.lazy`: a scene is data, not a component. A module fetched ahead (the next stop, once the page is idle) renders at once with no fallback. The story player alone is `React.lazy`, so lesson pages don't carry it.
- **Static HTML still holds each lesson in full.** The prerender waits for the scene; React swaps it in for the shell fallback within the first frame (measured: under 20 ms on the production build). The fallback has class names of its own and is `inert`, so nothing finds or focuses it in that moment, and the visit is recorded outside the Suspense boundary.
- **`all.ts` loads everything at once** for the tests, `tune`, `new-lesson` and the glossary page (a server component, so it ships nothing). No client component imports it.
- **Next stop follows the path.** After the capstone it is D7, the one advanced lesson live; D7 ends the course for now, and its Recap points at the route map.
- **The poster** is generated from the catalog: columns of 120 px, zones as bands (the middle one tinted), line heads beside a frame that pans. It fits 1440 px without panning at M5; at 1280 px it pans, and the edge with more map fades out. The next stop wears a START or NEXT flag. A station whose prerequisites aren't visited has a lighter ring and a muted name, never a lock.
- **Station cards are pictures, not controls**: `aria-hidden`, no links, one at a time, shown on hover (after 140 ms) or keyboard focus. The station's own link carries its words, its visited state and what it is best seen after. Mini scenes don't feed the lesson-to-lesson intro (`Stage remember={false}`).
- **The phone hero is the scene's front half** (users, balancer, three servers, the same traffic, crash and beats) in a sheet a little taller than wide. In the planned 200 px ticker the full scene's labels collided; the stage's vertical layout reads at full size.
- **Layout fix found by the journey card:** a label no longer settles on its own station's shoulder badge. The check had looked only at other stations' badges.
- **The home page has no eyebrow over its heading**: "an animated field guide" moved into the lede. "How to read a scene" shows each of the seven marks happening once, on its own short rail, as the list comes into view (no loop), with a button to play them again; under reduced motion each rests at the moment that tells its story.
- **The masthead's line index** (each line's roundel, name and a pip per lesson, filled once visited) is the plan's "continue card and per-line progress", folded into the masthead so returning visitors don't push the map down. The start button reads "Continue at …" once anything is visited.
- **`LineId` "capstone" became "stories"** (tokens `--l-stories`). `Line` gained no `level` or `order`: a line spans levels, and `LINES` is in the map's order.
- **Not built:** a still of the next lesson in the continue card on phones (the start button carries it), and a story-specific stage-fit sweep of each stage's solution (the journey card exercises the built-out capstone at three sizes by eye).

### How M6–M10 run

Each of these milestones has the same internal order:

1. **Engine PR first.** The batch's spec fields, behaviour, metrics, effects and rendering, with one unit test per hook and the catalog-wide property tests. Every existing lesson's numbers must be unchanged: compare `npm run tune -- --json` before and after.
2. **Lesson PRs next,** 4–6 lessons each, one line per PR. These may run in parallel sessions (D10).
3. **Story PRs last,** once every batch a story needs has landed (§6.3).

Every new lesson follows §8 and its curriculum §3 row. Add a `requires` entry only once both lessons are in the catalog, so the prerequisite test never points at a missing slug. When a new lesson is the prerequisite of an existing one (N2 before A3, N13 before R2), add that edge in the same PR.

### M6 — Engine B1 (small hooks) and 15 lessons (L)

**Goal:** the small engine hooks land, then the lessons they unlock. This includes the first beginner networking lessons, so the course can start at N1.
**Read first:** architecture §2.0, §2.1, §2.3.0, §2.3.1, §2.3.8, §6.1, §7.2; curriculum §2 for NC1, NC6, NC10, NC13, NC15–NC18, NC22, NC32–NC34, NC36–NC38; the M6 rows of §6.2.
**Skills:** `testing`, `safe-refactor` (for the engine split), `taste-ux-copy` (lessons).
**Lessons:** N1, N4, N9, N13, N16, N18, F5, F6, C7, D1, R4, R5, R7, O1, O2.

| Path | Change | What |
|---|---|---|
| `src/lib/sim/engine.ts` | modified | Becomes a re-export of `engine/` so existing imports keep working. |
| `src/lib/sim/engine/*.ts` | new (split) | Split by concern (core, routing, cache, data, transport) with no behaviour change, then the B1 hooks: `LinkSpec` (ms, jitter, loss, parallel, perCostMs, label), hash-based link fate, `logicalId` and `hop`, `holds()`, `Call` object form, `serviceBy`, `tail`, `failRate`, `shed`, `priority`, `bulkheads`, `byTag`, `readYourWrites`, `emit`, `bloom`, `seedKeys`, `batch`, `deadlines`, `nearest`, per-server version weights and error rates (canary), `drain(id)`, crash on sustained overload with a cold-restart ramp, stale-on-error, cached addresses that can point at a moved node, and a per-request wire/wait/work breakdown on `Done`. |
| `src/lib/sim/types.ts` | modified | The B1 fields; `Result` gains `conflict` (unused until M9); new `MetricId`s and `FxKind`s. |
| `src/lib/sim/invariants.ts` | new | Test-only `accounted`, `noLeakedHolds`, `arrivalTrace`. |
| `src/lib/sim/metrics.ts` | modified | `p99`, `wasted`, `onTime`, `filtered`, `batchSize`, `lost`, `refused`, `availability` (long window), `budgetLeft`, `breakdown` (wire, wait, work). |
| `src/components/stage.tsx`, `stage-draw.ts`, `glyph.tsx` | modified | Lost-on-link effect; dashed outer ring for retransmits; stretched dots for transfer time on thin links; bulkhead dividers; batch clusters; SHEDDING, DEADLINE, v1/v2 badges; link labels from `LinkSpec`; an availability gauge for F6; the wire/wait/work bar for N1. |
| `src/lib/lessons/kit.ts` | modified | `link()`, `col(i, n)` and `scene.fast`/`scene.slow` presets (architecture §7.2). |
| `src/lib/lessons/scenes/*.ts`, `catalog.ts`, `glossary.ts` | new/modified | The 15 lessons. |
| `tests/sim.test.ts` | modified | One test per hook (architecture §2.1 table) and the four property tests over every figure (architecture §6.1). |

**Acceptance:**
- [x] Every existing lesson's tuned metrics are unchanged after the engine PR: `npm run tune -- --json` is byte-for-byte the same before and after.
- [x] Lossy-link scenes lose the same `(logicalId, attempt)` set in both worlds (`tests/hooks.test.ts`, two worlds with different downstreams).
- [x] Every new lesson passes claims, beats validation, fairness and stage-fit.
- [x] The home page's "Start" button points at N1.

Engine PR gates on 2026-10-24: typecheck, 166 unit tests (28 in `tests/hooks.test.ts`, 3 catalog-wide properties in `tests/invariants.test.ts`, one new scene rule), build, and the browser suite: 452 tests, of which 441 passed and 11 were skipped, the 4 frame budgets included.

**Decisions made while building the M6 engine PR:**
- **The split is by concern, into seven modules** (`control`, `clients`, `transport`, `routing`, `cache`, `data`, `work`) beside `sim.ts` (state, the tick loop, the public controls) and `model.ts` (the runtime types). Each module attaches its methods to `Sim.prototype`; `sim.ts` declares them once in `interface Sim`. Proof of no change: a fingerprint of 88 scenes (every answer, job, effect, note and node state, hashed every 250 ms over 9 s) and `tune --json`, both identical before and after.
- **Hooks built:** `LinkSpec` (`ms`, `jitterMs`, `loss`, `parallel`, `perCostMs`, `label`), link fate, `logicalId` and `hop`, the wire/wait/work breakdown on `Done`, `serviceBy`, `tail`, `failRate`, `shed`, `order: "lifo"`, `priority`, `bulkheads`, `byTag`, `deadlines` with `retry.deadline: "shared"`, `nearest`, `weighted` with `weights` and `rollback` (the canary), `version` (a badge only), `drain(id)` and `boot(id, warmupMs)`, `overload` (a crash after a sustained overload, a restart, then a cold ramp of workers), keys that don't exist (`absent`) with `negativeTtlMs` and `bloom`, and `sloWindowMs`/`sloTarget`. Metrics: `p99`, `wasted`, `lost`, `availability` (shown in nines), `budget`, `wire`, `wait`, `work`, `filtered`.
- **Moved to the milestones whose lessons use them:** `readYourWrites`, `emit`, the `Call` object form, stale-on-error, cached addresses, `seedKeys`, `batch`, `hedge`, and `Result` `"conflict"` (M9). No M6 lesson needs them, and each is easier to get right against the lesson that shows it. `onTime`, `refused` and `batchSize` are not added: `availability` and `rejected` say the same for now. `budgetLeft` is called `budget`, and `breakdown` is three metrics (`wire`, `wait`, `work`), so a table can give each its own row.
- **A link's rules:** a payload costs `perCostMs × cost` on a write's way out and a read's answer on its way back, not on the small message in the other direction. A crossing on a link with `parallel` lanes waits at the link's start for a free lane. A lost crossing vanishes 35–85 % of the way along (its fate decides where) and stays `lost` until whoever waits for it gives up.
- **Fate:** `fate(link, logicalId, attempt, hop, salt)` is a hash, never a draw from a stream, so two worlds lose and delay the same crossings whatever order things happen in. `logicalId` hashes the client's id with its count of requests sent; retries, clones and a server's give-up answer keep it. A fix that inserts a node before a lossy link changes `hop` on that link, and with it the link's fates (noted in CLAUDE.md).
- **Honouring deadlines:** a server refuses at once a request it can't finish in the time left; a request whose caller has gone is turned away when a worker would take it (a slate answer, not a silent drop, so the worker, balancer count and cache readers it holds on its way back let go); and a blocking server stops waiting at the deadline.
- **`holds(n)` is a method on `Sim`**, so `NodeRt` stays a plain record. `reconfigure` and `setUp` keep their per-container handling: a held request unwinds by itself when its answer reaches a removed node, and a hung one waits for its node to come back, so treating every container alike would change behaviour.
- **Invariants live in `src/lib/sim/invariants.ts`** (tests only): `accounted(sim)`, `leakedHolds(sim)` (the problems as sentences, empty when there are none, so a failure says what leaked) and `arrivalTrace(spec)`. The trace keeps its fields; the ids follow from the client and the order.
- **Tests:** `tests/hooks.test.ts` has one test per hook, plus the books checked every 50 ms on a scene with every hook at once. `tests/invariants.test.ts` runs the four properties over each step of every lesson, the hero and every story stage. `tests/sim.test.ts` keeps the original engine tests. Each hook test was checked against a mutation of its hook: 22 mutations, all caught.
- **Bugs the property tests found, now fixed.** (1) A server that gave up on a call left a ghost that the client's deadline later recorded a second time: in R2, 6 of 233 requests were counted twice. (2) A request let go by a hung node (when the node came back, or past 60 hung on it) was marked ended while its caller still held a worker for it, and a client calling a hung node directly never recorded it at all. Now it is lost, and its caller gives up in time. (3) A lost crossing, or a request dropped for its deadline, kept a balancer's count of requests outstanding. Of the existing scenes only R2's changed, and its tuned numbers did not.
- **Scene rule:** a scene whose links lose messages gives every client a timeout and every blocking server a call timeout or honoured deadlines (`tests/lessons.test.ts`).
- **Stage:** a lost crossing leaves a red cross on its rail where it vanished; it is a new Key row ("Lost") that a lesson opts into. A lookup the existence check answered gets the hit's faint green ring. Rail captions come from `LinkSpec.label` as well as `linkLabels`. New badges: SHEDDING (held 300 ms past each refusal, so it doesn't flicker) and versions (v1, v2). New sub-labels: "rolled back", "restarting…", "warming up · 2/4 busy". Bulkhead dividers, stretched dots on thin links, retransmit rings, the availability gauge and the wire/wait/work bar land with R5, N3, N1 and F6, each designed against the lesson that shows it.

**Decisions made while building the M6 networking lessons (N1, N3, N5, N8, N13, N16):**

Networking PR gates on 2026-10-24: typecheck, 189 unit tests, build, and the browser suite: 548 tests, of which 537 passed and 11 were skipped, the 4 frame budgets included. N1, N3, N5, N8, N13 and N16 were checked by eye at 1440×900, 1280×720, 390×844 and 844×390, light and dark.

- **Where the time goes is drawn in the table, not on the stage.** Rows of `wire`, `wait` and `work` ("Travel", "Waiting", "Working") each carry a thin ink rule under their number, as long as that part's share of the column's whole. N1's explore step flips them as the learner drags the server closer. The kit gained `M.p50` ("Typical response"), `M.wire`, `M.wait` and `M.work`. Following a request already shows the same split in its strip.
- **A payload on a thin link is stretched:** the engine records each crossing's transfer time (`Req.xfer`, output only), and the stage draws the answer as a bar whose head crosses at the link's latency and whose tail follows one transfer time behind. N3's 1 MB file fills the whole wire; its 2 KB page stays a dot.
- **N3 keeps every request the same size in the trace.** The answer's size lives in the link's `perCostMs`, so both trade-off steps send identical traffic. The line sends one answer at a time (`parallel: 1`).
- **The fairness test needs 5 identical arrivals, not 50.** Some lessons send one request at a time so each can be watched; five arrivals compared exactly still prove the traffic is the same.
- **N5 has no "move the server" break.** Stale cached addresses need the cached-address hook, which moves to a later milestone; N16 shows a stale cached answer under a fault, and N5 teaches the move in a check and its catch. N5's name servers sit in one column, so the phone's tall layout keeps four rows.
- **N8 changed the engine:** a node that honours deadlines now also stops work in progress once its deadline passes, and its admission estimate counts half a service for a busy worker to free up. With the slowed database, wasted work falls from about two thirds to about 2 %. No existing scene honours deadlines, so the fingerprint is unchanged.
- **N13 batches by asking fewer, slightly longer queries** (5 ms for one item, 1 ms more per extra item), so the users and their traffic are the same in both steps.
- **N16 models a DNS answer's time to live as a router that re-checks health once per TTL**; anycast checks every 100 ms. Each group of users has its own router (nearest by link latency). Its window is 4 s, so the comparison covers the outage.
- **Callouts keep clear of rail captions**, and one pointing at a captioned rail ends its leader at the top of the caption. **Balancers say how they pick:** "nearest healthy", "by weight".
- **Edges added:** N1 before F1, N8 before R2. The home page's start button now points at N1, the first live stop on the path.

**Decisions made while building F5, F6, C5 and D1:**

Gates on 2026-10-24: typecheck, 207 unit tests, build, and the browser suite: 616 tests, of which 605 passed and 11 were skipped, the 4 frame budgets included. F5, F6, C5 and D1 were checked by eye at the four sizes, light and dark.

- **Three lesson PRs, not one per line.** Networking has six M6 lessons; Foundations, Caching and Data have four between them; Resilience and Operating have five. Each PR keeps to the plan's 4–6 lessons.
- **F5 needed a hook: `NodeSpec.sessions`.** A server keeps its users' sessions in memory; a user whose session is on another server, or was lost in a crash, is signed out once (an error) and signed in from then on. The sticky balancer hashes user ids (`hash`), so a crash re-spreads most users, and server 2's return moves its users back again. The fix's session store is 4 ms away, in the same data centre.
- **C5 needed a hook: `ClientSpec.absentKeys`,** the size of the pool missing ids are drawn from (one draw, so traffic is unchanged). C5 has three steps: no defence, remember "not found" (which works only while the bot repeats its 40 ids: a knob), then an existence check that stops missing ids either way.
- **F6 warms up for 12 s** (`warmMs`) so its 20 s availability window already holds about 720 answers when the learner crashes the server. The claim test now runs a scene's warm-up before averaging, as the player does; the one other lesson with an armed fault and a warm-up (D4) still passes. The error budget row draws its remaining share as a gauge, the same ink rule as the time rows. The availability gauge the plan named is this row.
- **D1 prices reads and writes with `serviceBy`:** a scan costs 0.6 ms per 1,000 rows, an index 1 + ¼·log₂(rows) ms, and a write 4 ms, or 10 ms with the index to update. "Double the table" rebuilds the scene with twice the rows.
- **Edge added:** D1 before D2.

**Decisions made while building R4, R5, R6, O1 and O2:**

Gates on 2026-10-24: typecheck, 227 unit tests, build, and the browser suite: 696 tests, of which 685 passed and 11 were skipped, the 4 frame budgets included. A first full run failed R4's panel fit at 1280×720 (fixed by cutting a knob) and the keyboard test on both phone projects, the M5 race again: the test now steps back to the first build line before checking the keys, and passed 20 of 20. R5, R6, O1 and O2 were checked by eye at the four sizes, light and dark.

- **No engine changes.** Each lesson uses the batch 1 hooks as built.
- **R4's spike rebuilds the scene with browsing at 110 a second** (an armed `reconfigure`), so the arrivals stay identical until the learner presses it. Shedding keeps checkout (`keep`) and serves it first (`priority`). An Order knob (checkout first, newest first, oldest first) was cut: with two knobs the panel overflowed 1280×720.
- **R5 keeps workers per tag:** checkout's 4 (`bulkheads`); browsing, untagged in the bulkhead, uses the other 6.
- **R6 crashes a server swamped for 0.4 s** (more than 16 waiting) and restarts it 0.7 s later with its workers returning over 1.2 s. The fix has five servers and sheds past 8 waiting; its knobs show that shedding alone also stops the cascade, at the cost of users turned away. Five servers in a row make small stations on a portrait phone; their labels stay full size.
- **O1's canary replaces the fourth server** and gets its share by weight. A rollback lasts for the rest of the run: the balancer never sends to the canary again, even after v1 is back.
- **O2's deploy is an armed sequence per server** (restart, stop if still busy at the drain limit, back after 0.3 s), fired from one custom action; its undo cancels the rest and starts any server that is down. A drained server goes off once idle, and is stopped only if it still holds work when its drain time runs out.

### M7 — Engine B2a (messages and delivery) and 7 lessons (L)

**Goal:** a message can be acknowledged, resent, deduplicated, redelivered, dead-lettered, held back by a full consumer, published reliably with an outbox, and ordered per key in a partitioned log.
**Read first:** architecture §2.3.0, §2.3.2, §2.3.6, §2.3.10, plus back-pressure (§1.1 row 10), idempotency (row 12) and outbox (row 14); curriculum §2 for NC2, NC11, NC12, NC14, NC28, NC29.
**Lessons:** N2, N15, N17, A4, A5, A6, A7. **Story:** S8 web crawler.

| Path | Change | What |
|---|---|---|
| `src/lib/sim/engine/transport.ts`, `types.ts` | modified | `ClientSpec.transport` (fire or ack, ack timeout, max resends); `NodeSpec.ackOn` and `idempotent`; queue `ack` (receive or finish, visibility timeout, max deliveries, dead-letter target); queue `backpressure` (high, low, wait or reject); db `outbox` relay; partitioned queue (partitions by key hash, one consumer per partition, offsets). |
| `src/lib/sim/metrics.ts` | modified | `delivered`, `duplicates`, `resends`, `ackLag`, `redelivered`, `deadLettered`, `lostJobs`, `duplicateJobs`, `duplicateEffects`, `lostEvents`, `consumerLag`. |
| `src/components/stage-draw.ts`, `glyph.tsx`, `legend.tsx` | modified | Ack dots (small, green, travelling back); unacked copies stacked beside the sender; invisible in-flight jobs on the queue's lower row; dead-letter queue rim; partition lanes inside a queue; per-lesson Key rows through `FigureDef.key`. |
| `src/lib/lessons/scenes/*.ts`, `stories/web-crawler.ts`, `catalog.ts`, `glossary.ts` | new/modified | The 7 lessons and S8. |
| `tests/sim.test.ts` | modified | The three-scene ack test (fire, ack, ack plus idempotent), the queue-ack tests (architecture §2.3.6), back-pressure, outbox and partition-order tests. |

**Acceptance:**
- [ ] N2 shows all three behaviours on one stage: fire-and-forget loses messages, ack-and-resend delivers ≥99% with duplicates, and an idempotent receiver brings duplicates to zero.
- [ ] A5's poison job reaches the dead-letter queue after the configured attempts and the line moves again.
- [ ] S8 passes its per-stage tests.

**Decisions made while building the M7 engine PR:**

Engine PR gates on 2026-10-24: typecheck, 237 unit tests (41 in `tests/hooks.test.ts`), build, and the browser suite: 680 passed, 11 skipped and 1 failed. The failure was R2's breaker test, which had also failed once under load in M6: the step can take more than 5 s to draw under a full suite. Its first wait is now 15 s, and it passes 16 of 16. The 4 frame budgets passed in their own run.

- **N2's acks use request and response, not a sender-side transport.** Over a lossy link, the client's timeout and retry already resend, and the receiver's answer is the ack: `NodeSpec.replies: "ack"` draws it small and green. The sender-side transport the architecture sketches (an unacked map, a send buffer, windows) moves to M8, where windows and flow control need it.
- **Idempotency is a note per logical message** (`NodeSpec.idempotent`, keyed by sender and `logicalId`). `true`: a repeat is answered from the note, without the work, and a database applies a write once. `false`: the repeat is done again and counted (`duplicates`). Unset: no notes. Notes are forgotten after 30 s.
- **A queue that keeps jobs until acked** (`NodeSpec.ack`) hands out a copy and keeps the job invisible, keyed by the copy, so a late ack from an earlier copy can't clear a newer one. Past `visibilityMs` the job goes back to the front of the line; past `maxDeliveries` it goes to `deadLetter`, a queue with no workers that just stores it (a red rim on the stage). `ordered` keeps one job out at a time. A worker that crashes loses its copies: redelivered if acked when done, lost if acked on receipt (`lostJobs`). A paused worker still keeps ordinary jobs, as before.
- **Poison jobs** (`ClientSpec.poison`) are drawn only when a scene asks for them, so every other scene's traffic is unchanged; every worker fails them.
- **Back-pressure** (`NodeSpec.backpressure`): `wait` holds the producer's request at the queue until the line is back under its low mark, so the producer slows down while its arrivals stay the same; `reject` turns the job away; `drop-oldest` loses the oldest. A queue that crashes under overload loses every job in it.
- **The outbox** (`NodeSpec.outbox` on a database) stores an event with each write and relays it until the broker accepts it, resending after `retryMs` (at least once). `lostEvents` compares the database's notes with the consumer's.
- **Partitions are separate queues** behind a hashing balancer; `consumers: "first"` gives each one consumer that fails over in order. `reordered` counts jobs finished before an earlier job for the same key.
- **Metrics:** `duplicates`, `redelivered`, `deadLettered` (neutral), `lostJobs`, `lostEvents`, `reordered`, `consumed`. `delivered` is `answered`, `resends` is `amplify`, duplicate jobs and effects are `duplicates` at the nodes named, and consumer lag is `queue` or `jobWait`; `ackLag` is not added.
- **Stage:** acks are small green dots; a queue's sub-label adds jobs out with workers ("· 3 out") or producers held back ("· 5 held"); rings mark a repeat answered from notes (slate), a redelivery (cobalt) and a dead letter (red); "Ack" is a Key row lessons opt into. Not drawn: unacked copies beside a sender (no sender transport) and partition lanes inside one queue (partitions are separate queues).
- **Proof of no change:** all 176 earlier scenes hash the same and `tune --json` is byte-identical. Each new hook has a test in `tests/hooks.test.ts`, checked against a mutation (14 of 14 caught), and a scene with every batch 2a hook settles with every request accounted for and nothing held.

**Decisions made while building N2, N14 and N15:**

Gates on 2026-10-24: typecheck, 249 unit tests, build, and the browser suite: 744 tests, of which 733 passed and 11 were skipped, the 4 frame budgets included. A first full run timed out on three phone tests that pass alone (the suite now loads one dev server with three workers), so Playwright's assertion timeout is 10 s instead of 5 s. N2, N14 and N15 were checked by eye at the four sizes, light and dark.

- **N2 is request and response over a lossy wire.** The receiver answers with an ack (`replies: "ack"`) and isn't idempotent, so a lost ack shows as "Done twice"; the resend is the client's retry, and the ack timer is its timeout. The "cut the link" break was left out: the lesson needs no fault to make its point.
- **N14 crashes worker 2 while it holds two jobs.** Acked on receipt they're lost; acked when done they're handed out again once the visibility timeout passes. Dragging the timeout below the job time shows duplicates; "exactly once" is named as at least once plus idempotent workers, which A4 builds on.
- **N15's unbounded queue runs out of memory** (`overload` on the queue: more than 60 waiting for 0.3 s) and loses every job in it. The bounded queue holds 20, with a knob for what full means (the producer waits, turn new jobs away, drop the oldest). Its option labels were shortened to fit 1280×720.
- **Edges:** N2 before A3 and D7. N15's curriculum prerequisite N6 joins when N6 is live (M8); for now N15 requires A1 only.
- **The kit gained `queue()`.**

**Decisions made while building A4, A5, A6 and A7:**

Gates on 2026-10-24: typecheck, 265 unit tests, build, and the browser suite: 812 tests, of which 801 passed and 11 were skipped, the 4 frame budgets included. Earlier full runs each lost one or two different tests to timing under load. One cause was a click made before the page had hydrated, so the browser tests now share a fixture (`tests/browser/fixtures.ts`) that waits, after loading a lesson or story, until the stage has measured itself. A6 opens its reduced-motion still at 5 s, because lost events are only counted 3 s after an order. A4–A7 were checked by eye at the four sizes, light and dark.

- **A4 is a payment retried after a timeout.** The ledger slows to 0.6 s while shoppers retry after 0.4 s, so the first charge lands after the retry has been sent. With keys, the ledger is idempotent (`idempotent: true`), and a repeat gets the first result back.
- **A5's break spawns exactly one poison job,** the same in every world (an armed event calls `spawn` with `poison`), rather than turning poison on for a moment, which at 8 jobs a second sometimes produced none. Its button reads as on while that job is in the line or out with the worker. The worker sits 5 ms from its queue, so the ordered line keeps up until it's poisoned.
- **A6 crashes the broker for 1.5 s.** The dual write saves orders whose events are then lost; the outbox relays them once the broker is back. `lostEvents` waits 3 s before counting an event as lost, which is longer than the relay's resend after an outage. The relay's rail (database to broker) and a dead-letter queue's rail are now drawn.
- **A7 has three steps:** one consumer (it falls behind), three consumers sharing one log (fast, but an account's later event can finish first), and three partitions by account (fast and in order). It uses 126 accounts with some much busier than others (skew 1): the hash leaves no partition nearly empty, and busy accounts often have two events in flight. Each partition is read by its own consumer, with the next one as its fallback (six rails rather than nine), and keeps its events ordered with acks.
- **Lost events, dead letters and reorders were proved in `tests/hooks.test.ts`** before any of these lessons used them.

### M8 — Engine B2b (connections and real time) and 10 lessons (L)

**Goal:** windows and congestion control, connection setup and reuse, head-of-line blocking, L4 vs L7, held connections with push, heartbeats, and replica promotion.
**Read first:** architecture §2.3.3, §2.3.4, §2.3.5, §2.3.7, §2.3.9, §2.3.10; curriculum §2 for NC3, NC4, NC5, NC7, NC8, NC9, NC24.
**Lessons:** N5, N6, N7, N8, N10, N11, N12, D6, D7, R8. **Stories:** S7 video premiere, S2 chat, and optionally S0's fifth stage.

| Path | Change | What |
|---|---|---|
| `src/lib/sim/engine/transport.ts`, `types.ts` | modified | `ClientSpec.window` (fixed or AIMD), `NodeSpec.advertise`; `ClientSpec.connection` (handshake RTTs, keep-alive, max, streams one or multiplex) and server `pool`; L4 mode on an lb pins connections; `ClientSpec.subscribe` and `NodeSpec.hold` for push; `heartbeat`, with `health` rewritten as sugar over it; replica promotion with sync or async replication acks. |
| `src/lib/sim/metrics.ts` | modified | `inFlight`, `window`, `goodput`, `bufferWait`, `dropped`, `connectWait`, `handshakes`, `connections`, `detectMs`, `falseAlarms`, `pushLag`, `fanout`, `lostAckedWrites`. |
| `src/components/stage-draw.ts`, `glyph.tsx` | modified | Window bracket meter; handshake dots (small muted rings); connection sockets under clients; pinned sockets for held connections; push dots; `gateway` glyph; promoted-replica badge. |
| `src/lib/lessons/scenes/*.ts`, `stories/video-premiere.ts`, `stories/chat.ts`, `catalog.ts`, `glossary.ts` | new/modified | The 10 lessons, S7 and S2. |
| `tests/sim.test.ts` | modified | Window, AIMD, connection, heartbeat and push tests (architecture §2.3.3–§2.3.9). The existing health-check test still passes through the `heartbeat` sugar. |

**Acceptance:**
- [ ] `unacked.size ≤ effectiveWindow` holds at every tick in every scene.
- [ ] N7 shows p50 ≈ 4 × RTT + service on new connections and ≈ 2 × RTT + service with keep-alive.
- [ ] S7 and S2 pass their per-stage tests.

### M9 — Engine B3 (coordination) and 5 lessons (L)

**Goal:** fan-out-and-wait, quorums, leader election with log replication, locks and leases with compare-and-set, and sagas. Then the four stories that need them.
**Read first:** architecture §2.4; curriculum §2 for NC25, NC26, NC27, NC31, NC35; the Secret Lives of Data notes in pedagogy §1.
**Lessons:** D8, D9, D10, A9, R9. **Stories:** S1 flash sale, S5 ride matching, S3 news feed, S6 payments.

| Path | Change | What |
|---|---|---|
| `src/lib/sim/engine/coordination.ts` | new | `fanout()` (scatter-gather, wait for k), hedging on an lb, `quorum`, `cluster` roles, terms and votes, Raft-style append and commit, `lock` kind with lease, waiters and fencing token, compare-and-set writes, `saga` steps with compensations. |
| `src/lib/sim/metrics.ts` | modified | `hedged`, `leaderless`, `term`, `committed`, `uncommitted`, `lockWait`, `expired`, `doubleBookings`, `lostUpdates`, `inconsistentOrders`, `conflicts` as a share. |
| `src/components/stage-draw.ts`, `glyph.tsx` | modified | Padlock glyph; term and role badges; vote and append dots (small, muted, directional); `W=2 R=2` badge; compensation dots walking back along the chain. |
| `src/lib/lessons/scenes/*.ts`, `stories/*.ts`, `catalog.ts`, `glossary.ts` | new/modified | The 5 lessons and S1, S5, S3, S6. |
| `tests/sim.test.ts` | modified | Every test in architecture §2.4. |

**Acceptance:**
- [ ] Crashing the leader elects a new one within `max(electionMs) + 2 × heartbeatMs`, and a minority partition never elects.
- [ ] With W + R > N, stale reads stay at zero under replication lag.
- [ ] D10 shows double bookings above zero without a lock and exactly zero with one.

### M10 — Engine B4 (streams and durability), 2 lessons and the final pass (M/L)

**Goal:** event-time windows and write-behind durability, the click-counting story, then a full accessibility, performance and copy pass over the whole course.
**Read first:** architecture §2.5 (windows and the durability row), §6.4; curriculum §2 for NC20 and NC30.
**Skills:** `taste-accessibility`, `animation-performance`, `taste-web-performance`, `improve-animations`, `release-check`.
**Lessons:** A8, C5. **Story:** S4 click counting.

| Path | Change | What |
|---|---|---|
| `src/lib/sim/engine/storage.ts` | new | Stream `window` (size, slide, allowed lateness) with `ClientSpec.lateness`; cache write modes (through, behind, around) with a dirty buffer lost on crash. |
| `src/lib/sim/metrics.ts` | modified | `lateDropped`, `windowLag`, `lostWrites`. |
| `src/lib/lessons/scenes/*.ts`, `stories/click-counting.ts` | new | A8, C5 and S4. |
| `tests/browser/visual.spec.ts` | new | Optional visual snapshots under reduced motion with the canvas masked: one lesson per line and each story's first stage, light and dark. A separate, non-blocking job. |
| `README.md`, `CLAUDE.md` | modified | Describe v3: levels, lines, journeys, beats, follow, the engine batches, and the authoring rules in §8. |

**Acceptance:**
- [ ] Lighthouse accessibility ≥ 95 on the home page and three lessons.
- [ ] No lesson page ships more than 200 KB of gzipped JavaScript.
- [ ] A run on a mid-range phone records no frame over 34 ms on the busiest scene.
- [ ] All 57 lessons and 9 stories pass every gate.

### M11 — Optional: a learning record (S/M, only with the owner's agreement)

Pedagogy §5 describes a privacy-safe, localStorage-only event ring buffer, a `/progress` page with export and clear, and a dev-only `/stats` view to tune predictions and checks. It changes the `CLAUDE.md` rule on progress storage, so it waits for an explicit yes.

---

## 8. Authoring rules for every lesson (v3)

A lesson is ready when all of these hold. The tests enforce the ones marked (t).

1. **Shape.**
   - A hook (≤16 words, a question the learner has felt) and a one-line why.
   - Two or three figures with allowed tones (t).
   - At most 2 knobs and 4 metrics per figure (t).
   - Figure captions ≤25 words that describe the setup, not the outcome (t).
2. **Build.** One line per node, ≤9 words, label then what it does with a number: "Server: 4 workers, 120 ms each."
3. **Beats.**
   - 3–6 per figure, each ≤14 words (t: ≤16).
   - Verb first: Watch, Count, Find, Press, Drag, Compare.
   - Each names exactly one on-stage thing and points at it with `focus`.
   - One change per beat. Every beat must fire in a test run (t).
4. **Terms.** Plain words first, then the name in the next beat, marked `[[term|plain]]`. Never use a term before the beat that names it (t).
5. **Dots.** Name a dot kind by colour, shape and meaning at its first appearance in the lesson. New meanings use size, outline, dashes, rings, badges and meters, never a new colour.
6. **Prediction and checks.**
   - One prediction before the break, with 2–3 options whose wrong answers are real misconceptions. The engine must agree with the answer (t).
   - One or two checks on the Recap, each with a ≤25-word why shown for right and wrong.
7. **Numbers.**
   - Every latency or share shows a unit and a target.
   - Prose says "the slowest 1 in 20"; "p95" appears only in the glossary and advanced lessons.
8. **Fairness.**
   - Problem and fix share clients, seed, `sloMs`, `timeoutMs`, `timeScale` and `windowMs` (t).
   - Faults pair by id and hit both worlds (t).
9. **Claim.** The fix beats the problem by ≥8% on the headline metric (t). A trade-off pair declares its claims explicitly.
10. **Fit.** Stage-fit passes on all four projects (t). No caption, beat or label is clipped.
11. **Recap.** Use it when / The catch / Seen in, plus a ≤8-word rule and, for advanced lessons, one "In an interview, say…" line.

---

## 9. Dependencies

- **Runtime packages:** none added (A1).
- **Dev packages:** none required. `npx next experimental-analyze` ships with Next 16.1+.
- **Fonts:** Newsreader joins through `next/font/google`, self-hosted at build time. No runtime requests.
- **Config:**
  - Two new Playwright projects in M1.
  - `redirects()` in M5 reads catalog aliases (empty at first).
  - No environment variables.
- **Ordering:**
  - M0 → M1 → M2 → M3 → M4a → M4b → M5, strictly.
  - Then M6 → M7 → M8 → M9 → M10 for the engine PRs, because each batch builds on the previous one's `logicalId`, `holds()`, link model and transport.
  - Within each of M6–M10, the engine PR lands before its lesson PRs, and lesson PRs land before the stories that use them.
  - Lesson PRs from an earlier batch may still be open while the next engine PR is written, as long as they don't touch `src/lib/sim/`.

## 10. Verification

Run these from the repo root at the end of every milestone and before every PR.

```bash
npm run typecheck && npm test && npm run build
```

```bash
npx playwright install chromium
```

```bash
npm run test:browser
```

```bash
npm run tune
```

From M5 on, also check bundle shape. The `-o` flag writes the analysis files without starting the analyzer's web server.

```bash
npx next experimental-analyze -o
```

Visual check: run the dev server through the preview tool (`.claude/launch.json` defines `system-lab` on port 3100). Capture 1440×900, 1280×720, 390×844 and 844×390 in light and dark for the lessons the milestone touched, and look at every one.

## 11. Rollback

- **Reversible:** every milestone is one PR. Revert the merge commit on `main` and Vercel redeploys the previous build. There is no data, no migration and no third-party write.
- **Irreversible:** none. The only user-visible commitment is URLs. Slugs never change, and M5 adds aliases and redirects for any future move.

## 12. Open questions for the owner

These do not block M0–M4. Each has a default the plan follows.

1. **Learning record.** Keep progress storage to the visited list (default), or allow M11's prediction and check history?
2. **A fourth typeface.** Newsreader for titles (default), or stay with three faces?
3. **Branches and PRs.** One PR per milestone with Vercel previews (default), or direct commits to `main`?
4. **Catalog size.** 57 lessons and 9 stories (default). Curriculum §8 shows how to trim to 48 lessons by dropping nine should-haves, if a smaller course is preferred.
5. **Data line codes.** Shift the existing Data codes by one so Indexes can be D1 (default; slugs and URLs don't change), or keep today's codes and give Indexes the next free code?
