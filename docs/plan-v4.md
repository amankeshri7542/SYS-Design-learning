# System Lab v4 plan: finish, deepen, and map your own system

- **Status:** written 2026-10-25 by Claude Opus 5.5, in the session that finished part cards. Phase 0 built and committed locally on `v3/part-cards`. Each later phase records its build-time decisions under its own heading, as `plan-v3.md` did.
- **Owner context:** the owner asked for this plan and its build in one session, then left. Every decision below that would normally be a question was made and is marked **(decided)**, with the reasoning, so it can be reversed cheaply. Nothing was pushed or merged; commits are local.
- **Reads before this one:** `CLAUDE.md`, `docs/plan-v3.md` (its §8 authoring rules still hold), `docs/research/design-audit.md` (the art direction), `docs/research/pedagogy.md` (why beats, prediction and part cards work), `docs/research/curriculum.md` (the backlog this plan draws on).

---

## 1. Problem, goals, non-goals

### Problem

v3 shipped the course: 57 lessons on seven lines, nine journeys, a deterministic engine with six optional modules, one-screen players, beats, predictions, a learning record. Three things now stand between it and "the best interactive way on the web to understand systems":

1. **Small details aren't self-explanatory.** A beginner meets "Shard router · key → 3 nodes" and has to open the Key, which explains dots, not parts. (Part cards, Phase 0, answer this.)
2. **The first minute reads like a syllabus.** The home page leads with counts ("57 lessons on 7 lines"), a code-speak button ("Start at N1"), a wall of 57 pips, and puts "How to read a scene" 7,600 px down. On a phone the live scene is below the fold. Nine 540 px journey cards follow, each a live scene with a pill cluster.
3. **It only teaches our systems.** Learners and working engineers can't put *their* architecture on the stage, crash a part of it, and see what happens. Nothing else on the web does this with an honest simulator; it is the owner's big idea and the product's moat.

### Goals

- **A. Finish and deepen the teaching product:** part cards to a shippable bar; a first minute that is a ride, not a wall; curiosity loops (part → lesson → journey); a few net-new concepts only where the engine teaches them honestly.
- **B. "My System":** describe, import or replay your own system and understand it visually, in four levels: a guided builder (L0), structured imports (L1), trace replay from files (L2), and optional live connectors (L3). L0–L2 work with zero backend.
- **C. Craft:** keep the Field Guide + transit direction; one composition per first viewport; no card spam, pill clusters or glow; relatable labels; parity at 1440×900, 1280×720, 390×844, 844×390, light and dark, reduced motion.

### Non-goals

- Accounts, a cloud backend, analytics, AI features, or user content shared through a server (unchanged from v3). Level 3 proposes the smallest exception and waits for the owner (§5, Phase 5).
- A general diagramming tool. "My System" draws what the engine can simulate honestly; it is not Excalidraw, and not Datadog.
- Free-form drag-and-drop canvases. Structure is edited in the panel; the stage lays itself out (decided, §4 D4).
- New runtime dependencies. YAML, CSV, OTLP and Zipkin parsing are small hand-written readers for the subsets we accept (decided, §4 D7).

---

## 2. What exists now (audit, 2026-10-25)

| Area | State | Evidence |
|---|---|---|
| Engine | Deterministic, fixed tick, seeded per-node streams. Core (`core.ts`) plus six optional modules loaded on demand (`needs.ts`, `loadModules`). Rich `SceneSpec`: 30+ node features from caches to quorums, sagas, stream windows. | `src/lib/sim/types.ts`, `CLAUDE.md` |
| Players | `LessonPlayer` (problem/fix in lockstep, beats, prediction, armed faults, Recap), `StoryPlayer` (stages, controls, cost, targets). Both on `Shell`. | `player.tsx`, `story-player.tsx` |
| Stage | SVG stations + canvas dots; three layouts (wide, compact, tall); label-aware frame; callouts; follow one request; motion tokens. | `stage.tsx`, `layout.ts` |
| Catalog | 57 lessons + 9 journeys live, frozen codes, `PATH`, `FAST_LANE`, prerequisites dim the map. | `catalog.ts` |
| Home | Masthead + hero scene + line index; route poster (desktop) / board (phone); fast lane; nine journey cards; "How to read a scene". | `page.tsx`, screenshots in §3.2 |
| Learning record (M11) | localStorage ring of 600 events + tallies; `/progress`; `npm run stats`. | `record.ts`, `progress-view.tsx` |
| Weight | Lesson pages 193–199.7 KB gzipped JS; 134 KB is React + Next. Home 224 KB. **Turbopack does not drop unused exports**, so a module's every export ships with any page that imports it (measured 2026-10-25: `clearRecord` and `MetricList` were on lesson pages). | `scripts/weight.mjs` pattern below |
| Part cards (branch `v3/part-cards`) | Built in Phase 0 below. | — |
| Gates | typecheck; 403 unit tests; build; ~1,240 browser tests on four sizes + two frame-budget projects. | `package.json` |

### What `StoryDef` already proves

A journey is data: `controls` (counts and switches), `cost`, `scene(design, stage)`, `targets`, `metrics`, stages with params. That is most of a "My System" model already: a design is a set of values compiled into a `SceneSpec`, judged against targets under traffic and failures. The builder generalises it from fixed controls to a user-described graph.

---

## 3. Gap analysis

### 3.1 Concepts

Every canonical curriculum's first and second rings are live (curriculum §1.1). Remaining gaps, from `curriculum.md` §3 backlog, filtered by the "is it dots?" test and by what "My System" will make learners ask:

| Priority | Concept | Why now | Engine | Shape |
|---|---|---|---|---|
| 1 | **O3 Headroom and N + 1** | "What breaks if X dies" (My System) is exactly this question; beginners need it before they size anything. | crash + counts exist | problem "Exactly enough" / fix "N + 1 at 60%" |
| 2 | **C8 Hot keys and local caches** | Celebrity keys are the most-asked interview failure; `hot` traffic exists; journeys S6/S8 hint at it. | `hot`, caches, ring | problem one shard on fire / fix per-server L1 |
| 3 | **R11 Rate limits across many servers** | Every real limiter is distributed; teaches "local counters multiply the limit". | `limit.shared` exists | problem local counters / fix shared counter (extra hop) |
| 4 | **A10 Scheduled jobs and the midnight burst** | Relatable, beginner-friendly, cheap (client rate functions). | rate functions | problem midnight on every server / fix spread with jitter |
| 5 | **O4 Tracing a request** | Bridges the course to My System L2: a lesson about the waterfall the replay shows. | follow + flight strip | problem "a number with no story" / fix "a trace" |

Not taught as lessons (not dots, or folded elsewhere): back-of-envelope (becomes the builder's sizing hint), B-tree vs LSM, typeahead, geo indexes, collaborative editing.

### 3.2 UX (roast, by screen)

| # | Finding | Severity | Phase |
|---|---|---|---|
| U1 | Phone home: the live scene starts below the fold, behind a 57-pip line index. | P0 | 1 |
| U2 | "Start at N1": a code a newcomer can't read. No sense of a first ride or its length. | P1 | 1 |
| U3 | The dot vocabulary (How to read a scene) is 7,600 px down; the hero can't be asked anything. | P1 | 1 |
| U4 | Nine full-width journey cards (~4,600 px) with lesson pill clusters: card spam. | P1 | 1 |
| U5 | Route map labels collide in zone 2 ("…WebSockets" runs into "Timeouts and deadline propagation"); line blurbs end in ellipses. | P2 | 1 |
| U6 | Lesson Recap ends at "Next stop"; it never says where the idea is used in a journey. | P2 | 1 |
| U7 | 375 px phones truncate the dock's Next to "Conti…". | P2 | 1 |
| U8 | Station details need the Key (fixed by part cards, Phase 0). | P0 | 0 |
| U9 | Part cards on small screens could land on the next station, so it took two taps to read another part (found and fixed in Phase 0). | P1 | 0 |

### 3.3 Beginner retention

- **First 60 seconds** must teach the dots and parts without the Key: the hero answers "what is this part?" on tap, and a one-row legend sits under it.
- **A ride, not a wall:** first-time visitors see Ride 1 (five stops, ~20 min) with the first stop's name and minutes on the button; returning visitors see "Continue" and their line progress.
- **Curiosity loops:** part card → "Learn more in C1" (Phase 0); Recap → the journey that uses this idea (Phase 1); journey stage → the lesson behind its fix (exists as stops).
- **Map anxiety:** keep dimming as "best after", never locks; the map stays the second screen, not the first.
- **Progress without gamification:** the line index with filled pips and the M11 `/progress` page are enough; no streaks, points or confetti.

### 3.4 My System

Nothing exists. Requirements from the owner: four levels; every major system shape representable; dead-simple UI on one screen; "Explain like I'm new"; "What breaks if X dies"; compare designs; reuse the stage language and engine; Level 3 gated.

---

## 4. Architecture decisions

### D1. `SystemDoc` is the user-facing IR; `SceneSpec` stays the execution IR (decided)

- **Options:** (a) import straight into `SceneSpec`; (b) a small serialisable document above it, compiled to `SceneSpec`.
- **Chosen:** (b). `SceneSpec` carries functions (rate curves, scripts), layout coordinates and engine tuning (slots, service ms, queue limits) that users shouldn't have to know, and it changes with the engine. `SystemDoc` is plain JSON, versioned (`v: 1`), validated with plain-English messages, small enough for a URL, and the single target of every importer (L1) and the trace reducer (L2).
- **Cost:** a compiler (`compile(doc) → { spec, notes }`) to maintain alongside the engine. The compiler is pure and unit-tested for every template and importer fixture.

### D2. Everything stays in the browser for L0–L2 (decided)

- Builder state lives in component state, saved to `localStorage` (`syslab.v1.systems`, the last 12 systems) and shareable as a link whose fragment holds the compressed doc (`/my-system#s=…`; fragments never reach a server). Compression: `CompressionStream("deflate-raw")` + base64url, with a plain base64url fallback.
- Imports and traces are read with `File.text()` or a paste box; nothing is uploaded. Traces are reduced to a `SystemDoc` plus a few sampled requests, and the raw file is dropped from memory (PII, §9).
- This keeps `CLAUDE.md`'s "no cloud, accounts or backend" true through Phase 4.

### D3. One player for user systems, reusing the shell, stage and lockstep (decided)

- `SystemPlayer` (lazy, like the other players) on `Shell`: bar · stage | panel (editor + numbers) · dock. Its stage is the same `Stage` with part cards; its comparison is the same `Compare` table over two lockstep worlds ("Your design" vs "With the change").
- **Why:** one visual language; frame budgets, stage-fit and reduced motion already proven.

### D4. Structure is edited in the panel; the stage lays itself out (decided)

- **Options:** a drag-and-drop canvas; a structured editor plus automatic layout.
- **Chosen:** structured. A part list ("Users → Load balancer → App ×3 → Cache → Database") where each part has a kind, a name, a count, two or three plain settings, and "sends to". The stage computes a layered layout (longest path from the users = column; order within a column by the average of the parents' rows, to keep rails from crossing) and fits it with the existing frame code.
- **Why:** drag-and-drop is hard on phones, hard to make accessible, and invites hairballs. Automatic layout keeps every user system legible at all four sizes and passes stage-fit. Tapping a station opens its part card with the same edits inline, so editing still happens "on the stage".

### D5. Groups, not hairballs (decided)

- A part with a count (App ×3) compiles to that many stations up to 4, and to one station with the summed workers above 4 ("App ×12", one node whose card says it stands for 12). Crashing "one of 12" removes a twelfth of its workers (reconfigure), so the numbers stay honest.
- At most 14 stations on the stage. Importers and the trace reducer group beyond that (§6.4) and say what they grouped.

### D6. Faults and "What breaks if X dies" are computed by the engine, headless (decided)

- Every part gets generic faults: crash, slow down (service time ×5), and for links, cut. Plus traffic: surge ×3.
- **Blast radius:** for each part, run a headless copy of the scene for 4 simulated seconds with that part down from 1 s, against the baseline, and report failed share, response time and what queued. Ranked, in sentences: "If **Database** dies, 100% of requests fail for as long as it is down. Single point of failure." Deterministic, a few hundred ms in a worker-free loop, cached per doc hash.
- **Why:** it is the honest version of the owner's "what breaks if X dies": measured, not guessed.

### D7. Hand-written readers for a narrow set of formats (decided)

- **L1:** System Lab JSON (`SystemDoc`); an arrow DSL (`Users -> LB -> API x3 -> Cache -> Postgres`, one chain per line); CSV edges (`from,to,rps,latency_ms`); docker-compose YAML (services, `depends_on`, `image`) through a small YAML-subset reader (maps, lists, scalars, comments; no anchors or flow collections; errors name the line); Kubernetes-ish service lists in the same subset; OpenAPI 3 JSON or YAML (paths grouped by tag or first segment behind a gateway).
- **L2:** OTLP JSON (`resourceSpans`), Jaeger JSON (`data[].spans` + `processes`), Zipkin v2 JSON (span arrays).
- **Why:** no new dependencies (owner rule), and every accepted file is one we test with fixtures. Unsupported input gets a plain-English error naming the line and what we expected.

### D8. Kinds are inferred from names, then confirmed (decided)

- `postgres|mysql|aurora|mongo|dynamo|spanner|cockroach|db|database|store` → database; `redis|memcached|cache` → cache; `kafka|kinesis|pulsar|log` → log; `rabbit|sqs|queue|nats|celery|sidekiq` → queue; `nginx|envoy|haproxy|traefik|alb|elb|lb|balancer|ingress` → balancer; `gateway|kong|apigee` → gateway; `cdn|cloudfront|fastly|akamai|edge` → CDN; `stripe|paypal|adyen|twilio|sendgrid|s3|external` → someone else's service; `worker|consumer|job` → worker; anything else → service. The import screen shows each guess with a one-tap change.

### D9. Level 3 needs an owner decision (proposed, not built)

See Phase 5. In short: prefer a **local agent** (`npx syslab-agent`) that reads the user's own collector and serves a reduced `SystemDoc` on `localhost` with CORS, so no secret ever leaves the user's machine and the site stays static. A Vercel proxy is the fallback and requires changing the rule.

### D10. Page weight is a design input (decided)

- Lesson and story pages stay ≤ 200 KB gzipped JS, measured with `scripts/weight.mjs` (added in Phase 1) on the production build, prefetches and the idle next-stop fetch off.
- Because unused exports ship, code used by one kind of page lives in a module only that page imports (Phase 0 moved `MetricList` and `useSceneBeats` to `scene-run.tsx`, the term card to `term-card.tsx`).
- `/my-system` has its own ≤ 200 KB budget; importers and the trace reducer load only when used.

### D11. Branches (decided)

One local branch per phase, each based on the previous: `v3/part-cards` (Phase 0) → `v4/p1-first-ride` → `v4/p2-my-system` → `v4/p3-import` → `v4/p4-replay`. Commits are local until the owner asks to push and open PRs (they merge in order, as the v3 stack did).

---

## 5. Phases

Every phase that changes product code ends with the gate, a screenshot pass at the four sizes in light and dark (and reduced motion where motion changed), a written self-roast, fixes, and the gate again:

```bash
npm run typecheck && npm test && npm run build
npm run dev -- --port 3100   # reused by Playwright
npm run test:browser
node scripts/weight.mjs 3300 # against `npx next start -p 3300` on the fresh build
```

### Phase 0: finish part cards (S, done 2026-10-25)

**Goal:** tapping or clicking any station's name explains it in place: what it is, what it does here, what it is doing now, how to read its drawing, and the lesson that teaches it. Fewer trips to the Key; the Key stays as the dot vocabulary.

| Path | Change |
|---|---|
| `src/lib/sim/part-words.ts` | new: 60 concepts (name, ≤20 words, lesson); `conceptKey` from features, then name, then kind; `hereOf` (build lines), `setupOf`, `nowOf`, `readOf`. |
| `src/lib/sim/describe.ts` | new: `describe()` moved out of `stage.tsx` (the stage and the card read the same state, and it is testable). |
| `src/components/part-card.tsx` | new, lazy: the card; placed beside, under or over the station, or beside or under the stage, wherever it covers the fewest other stations; re-placed when the stage moves; Esc returns focus. |
| `src/components/stage.tsx` | hit buttons over stations (≥40 px), one Tab stop with arrow keys in flow order, hover after 320 ms, dotted cue under names. |
| `src/lib/lessons/all.ts`, `app/learn/[slug]/page.tsx`, `types.ts` | `partLessons(slug)` → `PageNav.learn`: the server sends the lessons a page's cards link to, so the catalog never reaches the page. |
| `src/components/scene-run.tsx`, `term-card.tsx`, `cards.tsx`, `follow-track.ts` | weight: hero/journey-only code and the term card split out; the Recap and the follow tracker lazy. |
| `src/lib/record.ts`, `progress-view.tsx`, `scripts/stats.ts` | record kind `part` (a card pinned, or read under the pointer for 1.2 s). |
| `tests/part-words.test.ts`, `tests/browser/part-card.spec.ts` | new (below). |

**Acceptance (all met):**
- [x] Every station on every page (every scene at each knob's ends and every journey design and stage: >1,000 stations) resolves to a concept with ≤20 words and a live lesson.
- [x] 27 named edge cases resolve as intended (sticky vs shard router, writer endpoint before failover, D9's fixed leader, origin, regions, shards that are servers, broker, sender/receiver, DNS servers, DLQ, partitions…).
- [x] Every station's Here / Now / Read it lines are complete sentences at every step after a fault (no `undefined`, `NaN`, raw terms or placeholders).
- [x] Browser: name opens the card; Esc closes and returns focus; a press elsewhere closes it; another name switches it; hover shows it (mouse); one Tab stop with arrows; the card follows a resize; a journey's stations work; the card stays inside the window and the document never scrolls; at 390×844 and 844×390 the card never covers another station.
- [x] Weight: D9 (heaviest) 199.7 KB vs 199.6 on `main` with the same script; journey pages ≤195.3.
- [x] Full browser suite green.

**Decisions made while building Phase 0:**
- **The card never covers the station it explains, and covers as few others as it can.** First version placed it right of the station; at 1280×720 and on phones it covered the next station, so a second name took two taps. Placement now scores seven spots (beside, under, over the station; under, right or left of the stage) by the area of other stations covered.
- **A step switch or resize no longer closes the card;** it follows its station and closes only when the station leaves the scene. (The first version closed whenever the layout changed, which included the moment following a request started.)
- **"Here" keeps a group's line whole** ("Three regions: 30, 8 and 4 requests a second.") and joins two lines about one station (A3's users); a knob that changes the station drops the line rather than show a wrong number.
- **Hover opens after 320 ms**, not 280, so moving across the stage doesn't flash cards; hover cards are recorded only after 1.2 s.
- **The lesson link says "Learn more in C1 Caching"**, and the kind line is hidden when the name already says it ("App server" is a server).

### Phase 1: the first ride (M) — branch `v4/p1-first-ride`

**Goal:** a first-time visitor understands the visual language within a minute and starts a short, named ride; a returning learner sees where they are. The page gets shorter and calmer.

| Path | Change |
|---|---|
| `src/app/page.tsx`, `src/components/home-start.tsx` | Masthead v2. One-sentence lede without counts. First visit: **Ride 1** card: "How the web answers you", five stops as roundels with titles (the first five of `PATH`), ~minutes, primary button "Start the ride" with the first stop's title and minutes; the line index moves out of the masthead. Returning: "Continue: C2 Content delivery networks · 6 min" and the line index (pips). |
| `src/components/hero.tsx` | The hero's stations open part cards ("Tap any name"). A one-row legend under the sheet: request, late, answered, failed, turned away, stale (shape + colour, from `legend.tsx`'s marks). |
| `globals.css` | Phone masthead order: headline, live scene, button, ride card. Desktop: unchanged composition (copy | scene), shorter. |
| `src/components/journeys.tsx` | **Featured journey + list.** One live scene (the next journey not finished, or S0) beside a compact list of all nine (code, title, one line, stages · minutes). Selecting a row swaps the featured scene in place; "Ride it" goes to the story. No pill clusters: a journey's lessons show as a row of roundels with codes. |
| `src/components/route-map.tsx` | Fix zone-2 label collisions (wrap long titles to two lines within the column, or stagger); line blurbs not cut mid-word (two lines, then the full sentence in the station's `title`). |
| `src/components/cards.tsx` (Recap), `PageNav` | "Where it's used": the journeys that ride this lesson, as links ("Ride it in S0 Keep a URL shortener alive"). |
| `src/components/player.tsx`, `globals.css` | Dock Next at ≤380 px: icon-led label ("Continue" fits, no ellipsis). |
| `src/lib/lessons/scenes/request-and-response.ts` | N1's first step ends its build lines with a beat inviting a tap on a name ("Tap Server's name to see what it is and how to read it."), so the first lesson teaches part cards. |
| `scripts/weight.mjs` (from the Phase 0 scratch script), `package.json` `weight` script | The measurement, committed. |
| `tests/browser/site.spec.ts`, new `home.spec.ts` | First-visit masthead (ride card, no line index), returning masthead (continue + pips), phone: hero scene's top within the first viewport; journeys: one live scene, list selects; hero part card opens. |

**Acceptance:**
- [x] On a 390×844 phone, the hero scene's top edge is inside the first viewport, and the primary button within 1.3 viewports (`home.spec.ts`; a phone held sideways checks the scene only: 390 px is too short for both).
- [x] A first-time visitor's primary button names the first lesson in words, with minutes ("Start: A request and a response · 4 min").
- [x] Home page height at 1440×900: 7,635 → 3,244 px (−57%).
- [x] No route-map station label overlaps another (`home.spec.ts`, desktop sizes).
- [x] Every lesson ridden by a journey links to it from its Recap ("Ride it in").
- [x] Lesson pages 188–196.3 KB (from 193–199.7); home 212 KB (from 225.7).
- [x] Stage-fit, motion and frame budgets green.

**Decisions made while building Phase 1:**
- **The ride is the path's first five stops** (N1, N3, F1, N4, N5; about 22 minutes), named "How the web answers you". Once all five are visited the masthead switches to "Continue: <next on the path>" and the line index; until then the ride card marks visited stops and the button continues the ride.
- **"Pick a station" became a plain link** ("or pick any station"): the ride's button is the one thing to press, and the pair no longer wraps at 1280 px.
- **The hero's stage has a height of its own** (`clamp(300px, 44svh, 460px)`), and the controls and the dot row add to the figure. Squeezing the stage to make room for the dot row had two labels collide at 1280×720.
- **Phones drop the hero's numbers** (the transport and the dot row stay): the numbers belong to lessons, and without them the ride's button is within reach.
- **Journeys are tabs down the left in code order** (S0…S8), the selected one running on the right with its stops drawn like the ride's. The page opens on the first journey not ridden. The pill clusters are gone.
- **Map names wrap greedily to three lines of 16 characters at 13 px**; the two titles that would need four ("L4 vs L7: …", "Sagas: …") show the part before the colon. The Networking blurb was shortened, and blurbs may take four lines.
- **N1 teaches part cards** with a sixth beat: "Tap Server's name: a card says what it is and how to read it."
- **The paused-beat button says "Next" below 380 px** rather than a cut-off "Continue"; every control stays.
- **A live claim waits for its numbers:** a Recap opened before the worlds have measured anything showed "waits — instead of —"; it now leaves the sentence out.
- **Weight:** the root `not-found.tsx` is sent with every page, and its `Link` put a second copy of `next/link` (3.5 KB) on every lesson page. It now uses plain links (`SiteHeader plain`). `npm run weight` measures it.
- **Not done:** the hero's stations aren't part of the stage-fit sweep (it covers lessons and journeys' first stages); the map's labels are checked at desktop sizes only (phones use the board).

### Phase 2: My System, Level 0 (L) — branch `v4/p2-my-system`

**Goal:** in under a minute, a learner picks a template (or starts blank), sees it running, crashes a part, reads "what breaks if X dies", changes the design and compares — all on one screen, all in the browser.

| Path | Change |
|---|---|
| `src/lib/system/doc.ts` | `SystemDoc`, `PartDoc`, kinds, defaults, `validate(doc) → Issue[]` (plain English). |
| `src/lib/system/compile.ts` | `compile(doc) → { spec, notes, map }`: parts → nodes (counts and groups, D5), links → `to`/`calls`, kind settings → engine fields, traffic → clients, layered layout → `at`, `sloMs`/`timeoutMs` from targets. Deterministic (seed from a hash of the doc). |
| `src/lib/system/templates.ts` | 12 templates (§6.3), each a `SystemDoc` with a one-line story. |
| `src/lib/system/blast.ts` | Blast radius (D6): per-part headless runs, ranked sentences; single points of failure. |
| `src/lib/system/explain.ts` | "Explain like I'm new": beats generated from the graph (the path a read takes, then each part in one line, then the busiest part), using `part-words` concepts. |
| `src/lib/system/share.ts` | Save/load in `localStorage`; encode/decode the link fragment. |
| `src/app/my-system/page.tsx` | Static page; template gallery for the first view; `SystemPlayer` lazy. |
| `src/components/system-player.tsx` | The player (D3): editor panel, stage with part cards that edit, faults in the dock, blast radius, compare. |
| `src/components/system-editor.tsx` | Part list, add-part menu (plain words), per-part settings, "sends to". |
| `src/components/brand.tsx`, `page.tsx` | "My system" in the header and a masthead secondary button. |
| `tests/system.test.ts` | Every template compiles, validates, runs 5 s with every request accounted for and no leaked holds (`invariants.ts`); determinism; blast radius stable; share round-trips. |
| `tests/browser/my-system.spec.ts` | Template → running in one tap; crash a part; blast report; add a cache; compare; share link reopens the same system; four sizes fit; stage-fit on every template. |

**Acceptance:**
- [x] From `/my-system`, one tap on a template shows it running with labelled parts; the document never scrolls; on phones only the panel does (`my-system.spec.ts`).
- [x] Every template passes the lessons' stage-fit checks at four sizes (labels inside and full size, no collisions, nothing over a station, no rail through a label, 40 px targets on phones) and the engine invariants (`system.test.ts`).
- [x] "What breaks if…" measures every part's outage on a headless copy and names the single points of failure with numbers; every "Try the fix" is checked to make that outage "barely noticed".
- [x] Adding any part to any template (where it fits), removing it, copies, settings and "sends to" leave a doc that compiles and runs (unit test over every template × kind); controls are ≥ 40 px on touch.
- [x] A shared link reopens the identical system in a fresh browser; the system travels in the link's fragment and nothing is sent anywhere.
- [x] `/my-system` 164 KB (gallery) and 197.4 KB with a system open; lesson pages 189.5–196.7 KB, journeys about 190.

**Decisions made while building Phase 2:**
- **Thirteen part kinds now** (users, bots, DNS, CDN, balancer, limiter, service, worker, outside service, cache, database, queue, topic) and ten templates: web app, read-heavy with copies and failover, shop, background jobs, event-driven orders, video to the world, crawler, write-heavy (shards), social feed (a celebrity key), start small. All run on the engine's core: no optional module loads. **Not yet:** multi-region, chat (held connections), flash sale (locks), payments (idempotency and sagas) and click counting (stream windows); each needs a kind wired to an optional module (§6.2 lists the mapping) and a template, in Phase 2b.
- **People share one tag** (`users`), so the table and "What breaks" count people's requests apart from bots' (a limiter then gives all people one budget: "Users" stands for many people).
- **"It dies" means** one of several copies, a database's main copy (its read copies and failover are the point), one shard, or the whole part (`outage.ts`); the crash menu and "What breaks" take down the same stations. A part drawn as one station for many copies loses one copy's workers in "What breaks".
- **Every outage of consequence comes with the usual fix**, in a sentence; where the builder can draw it (a second copy, a copy that takes over), "Try the fix" opens it beside yours on the same traffic, and the tests prove it turns the outage to "barely noticed". Caches say honestly that in this model nothing falls back to the database unless your code does.
- **Writes go through a cache, which forgets its copy** (`invalidate`): the common cache-aside pattern, and it keeps write rails from cutting across labels. A cache in front of a database with read copies passes writes straight to the database's writer (a cache has one way on).
- **Adding a part puts it where it usually goes**: a cache in front of the first database, a balancer/limiter/DNS/CDN in front of what the users talk to, a queue or topic after the first service with a worker taking from it. The menu offers only kinds that fit (`canAdd`).
- **Faults sit in the panel**, under the tabs, as a lesson's do: a "Break something" menu (crash, or slow a part down 5×) and a surge of traffic ×3. The dock keeps the transport.
- **"Explain like I'm new"** walks the parts in the order a request meets them, one beat each on the strip, the stage dimming everything else; its words load the first time.
- **Systems open 2.5 s in**, so caches are warm and the first numbers are the steady ones. The shop's target is 0.6 s (a page target) and its breaker starts off: the breaker is the fix to try when recommendations hang.
- **A lone database's extra stations have short names** ("Writer", "Copy 1", "Shard 1"); with several databases, each says whose it is. Long names collided on a landscape phone.
- **Weight:** the stage no longer imports the lesson runner: the strip and callout moved to `strip.tsx`, plain narration text to `rich.tsx`, scene beats to `scene-beats.ts`, the site header and footer to `site.tsx`. "What breaks" and the tour load on first use.
- **Not built in this phase:** following one request in the builder (the lesson's follow tracker needs a client to follow; easy to add), editing link latencies or regions, and a still preview of each template in the gallery (the list shows each one's shape in arrows instead).

### Phase 3: Level 1, structured import (M) — branch `v4/p3-import`

| Path | Change |
|---|---|
| `src/lib/system/import/{dsl,csv,yaml,compose,openapi,json}.ts` | Readers (D7). Each returns `{ doc, notes, errors }`; errors carry a line number and a fix ("Line 4: `-> ->` has nothing between the arrows."). |
| `src/lib/system/infer.ts` | Kind inference (D8) and default sizing from given rates and latencies (workers = ceil(rps × ms / 1000 / 0.6), so parts start at ~60% busy). |
| `src/lib/system/group.ts` | Grouping to ≤14 stations (§6.4), reused by Phase 4. |
| `src/components/system-import.tsx` | Paste box + file picker + format auto-detect + preview of guesses with one-tap kind changes; lazy. |
| `tests/import.test.ts` | Fixtures per format, good and broken, with exact messages; round trip import → compile → run. |

**Acceptance:**
- [x] Arrows, CSV of calls, System Lab JSON (or a list of calls) and docker-compose YAML read into a system that compiles and runs (`tests/import.test.ts`, fixtures inline).
- [x] Every error a reader finds names its line and what to do ("Line 1: there's nothing after an arrow.", "Line 4: anchors and merges (& * <<) aren't read here; paste the file with them written out.").
- [x] Numbered copies (`api-1`, `api-2`) count as one part; past 24 parts the rest are grouped as "Other services", and the notes say so.
- [x] Nothing leaves the browser: the text is read in the page; a file is read with `File.text()`.
- [x] Weight: the import box ships with the gallery but its readers and sizing load on "Open it": `/my-system` 165.5 KB, 199.1 KB opened from a link (the closest page to the budget); lesson pages unchanged (≤196.7).
- [x] An import opens healthy: no part saturated, its queue empty, its people's p95 within its target, and every guess, addition and size said in a note (`tests/import.test.ts`, `my-system-import.spec.ts` at four sizes).
- [ ] OpenAPI and Kubernetes service lists: not built (below).

**Decisions made while building Phase 3:**
- **Kinds come from names, then images** (`import/infer.ts`); a bracket says it outright (`Orders [database]`). The editor gained "What it is", so any guess is one change away.
- **The reader draws what a person would:** a cache and a database called by the same part become cache in front of database; a part nothing calls that "depends on" a queue another part feeds takes jobs from it (a worker); whatever is published (`ports`), or nothing calls, gets Users in front; a sender talking to several parts gets a load balancer; arrows the engine can't draw are left out. Each change is a note, shown above the parts when the system opens.
- **Grouping is by part count (24), not stations (14 in §6.4):** copies above four already draw as one station, so 24 parts stay readable; stage-fit is checked on templates, not on imports, which vary.
- **An import opens healthy** (`import/size.ts`): a file rarely says how many workers a part has, so each part that does work and wasn't given a number gets enough to run about 60% busy, measured on headless runs of the engine (doubling while a line keeps growing); if its slowest 1 in 20 already take longer than the usual 400 ms, "working" means about half again what it takes now. Both are notes, so the person can set their own numbers. Under 25 ms for the example.
- **Queues and topics hand work to workers only** (`SENDS`): nobody waits on a job for an answer, which is what the engine's consumers model; an import draws a service fed only by a queue as a worker, and says so.
- **"What it is"** changes a part's kind in the editor; arrows the new kind can't send or take are dropped, and copies go if it has none.
- **The import box is plain markup with the gallery;** its readers (`read.ts`, `graph.ts`, `infer.ts`) and the sizing engine load on "Open it", so a shared link doesn't fetch them. `detect.ts` names the format as someone types. It refuses text over 1,000 KB, says so if its code can't load, and can't be opened twice at once.
- **Found while checking:** on phones the builder lost its way back (the lesson bar's line of stops is hidden there, and the back button sat in it); it now stays, 40 px on touch. A template opened and left as it came is no longer added to "Yours".
- **Not built:** OpenAPI (paths need an L7 gateway kind that routes by path, which the engine has as `byTag` but the builder doesn't expose yet) and Kubernetes manifests (multi-document YAML with services and deployments; the YAML reader handles one document). Both belong with Phase 2b's advanced kinds.

### Phase 4: Level 2, trace replay from files (L) — branch `v4/p4-replay`

| Path | Change |
|---|---|
| `src/lib/system/trace/{otlp,jaeger,zipkin}.ts` | Readers to one `Span` shape (service, parent, kind, start, end, status, a whitelist of attributes). |
| `src/lib/system/trace/reduce.ts` | Spans → service graph (parent service → child service edges), per-service rate, self time p50/p95, error share → `SystemDoc` calibrated so the simulation reproduces the measured second; picks sample requests: one typical, the slowest, one failed. |
| `src/components/replay.tsx` | Replay a request on the user's map: the path lit (focus), one dot moving hop by hop with the trace's real timings (scaled), and the flight strip's wire/wait/work waterfall from the spans. "Replay the second" runs the calibrated simulation. |
| `src/lib/system/trace/scrub.ts` | PII: only whitelisted attributes are kept; values that look like emails, tokens, IPs or IDs are dropped; the raw file is released after reduction. |
| `tests/trace.test.ts` | Fixtures for the three formats (synthetic, no real data); reduction stable; grouping; scrub removes PII patterns. |

**Acceptance:** a 200-service trace becomes ≤14 stations with one click to change grouping (by service, by namespace/prefix, by kind); the failed request's waterfall matches its spans to the millisecond; the calibrated second's p95 is within 15% of the trace's.

As built (2026-10-25), tests in `tests/replay.test.ts` (fixtures in `tests/traces.ts`, all synthetic) and `tests/browser/my-system-trace.spec.ts`:
- [x] A Jaeger, Zipkin or OpenTelemetry file (OTLP/JSON as one object or one a line, Tempo's `batches` too) opens on `/my-system` as the system its requests ran through, read in the browser with `File.text()`; the same requests in each format make the identical system, and it compiles and runs.
- [x] Nothing personal survives: the fixtures plant emails, user IDs, IP addresses, a token in a URL and a pod hash in attributes, operation names and service names, and none reaches the spans, the system or its notes (unit test), or the page and this browser's storage (browser spec). A trace file's text is never put in the box.
- [x] A 200-service trace becomes 12 parts and at most 12 stations, each grouping said in a note.
- [ ] One click to change the grouping (by service, prefix or kind): not built. Grouping is automatic and deterministic.
- [x] Errors name what was wrong: JSON that doesn't parse (by line), JSON that isn't a trace (naming the three shapes read), a Jaeger span whose process is missing (by trace and span), a file with no spans that have times.
- [x] It opens healthy (sized like any import) and says how close it runs: each request's work across the parts is within 15% of the trace's (104 ms against 93 ms on the shop fixture).
- [ ] The calibrated second's p95 within 15% of the trace's: not met, and the note says so. The shop fixture's model answers half its requests within 334 ms against the trace's 50 ms (see the calibration decision below).
- [ ] The failed request's waterfall on the stage (`replay.tsx`, "Replay the second"): not built. The notes tell the slowest request's story (its time and where it went) and where a failed one broke, how far in, and the way there.
- [x] The browser spec opens a trace at all four sizes; the stage meets the stage-fit rules there, except label overlap on phones (below).
- [x] Weight: `/my-system` 165.4 KB, 199.1 KB opened from a link (a template's or a trace's), as in Phase 3; the readers load only when a trace is opened.

**Decisions made while building Phase 4:**
- **One span shape, made safe as it is read** (`trace/span.ts`). Each reader (`jaeger.ts`, `zipkin.ts`, `otlp.ts`) hands over spans; trace and span IDs become numbers in reading order and the file's own are dropped once parents are found; names are cleaned (`scrub.ts`). The format is recognised by its shape; `detect.ts` says "trace file" from the first 4 KB, so the gallery carries none of the readers.
- **What is kept** (`scrub.ts`): service and operation names, with query strings, quoted text, URL hosts, emails, IP addresses, UUIDs, long hex, long tokens and any word that is a number or has two digits taken out (`GET /users/{id}`; `v2`, `s3`, `oauth2` stay). A service named only by an address is lettered ("Service A"): a number would read as a copy. Of attributes, only `peer.service`, `db.system`, `messaging.system` and the destination are read, and kept as a kind and a name from a fixed list (`postgresql` → Postgres, a database) or a cleaned name; whether a span failed is kept as yes or no. A file name is cleaned the same way.
- **Calls nobody traced are parts** (`reduce.ts`): a client call with no child, named by its attributes (a database, cache or named service; Zipkin's `remoteEndpoint`), and a message sent through a queue or topic named after its destination ("orders topic"). A traced service is a service, or a balancer by its name when it only calls services; one fed only by a queue becomes a worker in `toDoc`. A cache with no database beside it is drawn as the store it is.
- **Work per call, as the model makes calls.** A part's own time is its spans' time less their children's (overlaps counted once). The model sends every request down every arrow, once, so each part's `ms` is the middle of its own time per call times the trace's calls per model call, counted from the way in: payments, reached by a fifth of requests at 120 ms, works 24 ms on each. The notes say when requests go different ways, when a part calls another several times per request (an N + 1), and when calls run at the same time.
- **Traffic** is the requests over the seconds their starts cover, from 10 to 400 a second (traces are often sampled); fewer than ten requests, or under a second, gives 40 a second, said in a note. Two ways in get Users each; more share one Users and `toDoc`'s balancer.
- **Grouping to 12 parts** (§6.4, in order, each a note): sidecars and tracing plumbing fold into their busiest caller; services sharing their name's first word and kind become one part; one caller's leaves of one kind become one; then the least used parts go to "Other services", each with what only it calls (a team's database goes with the team). Twelve, not fourteen, so a stage keeps room for labels. Names, groups and arrows are in a fixed order (arrows by how far into a request they are made), so the same requests make the same system whatever order the file lists them in.
- **Calibration is on work, not response time.** The engine can't reproduce a trace's response times honestly: every request takes every arrow (no per-endpoint paths), a part's calls run one after another, and its wires are at least 12 ms a hop so dots can be watched. What it can reproduce is the work each request asks of the parts, so how busy each part is, which is what sizing and "What breaks" use. The note gives both: the work against the trace's, and how much longer requests take, and why. "Working means" comes from the trace (half again its slowest 1 in 20) when that is past 400 ms.
- **Stories instead of the waterfall, for now:** the slowest request (its time, and where most of it went) and the share that failed, with the deepest failing span's part, how far into the request, and the way there.
- **Size:** trace files up to 20 MB (other files 1,000 KB); 200 requests in Jaeger JSON (735 KB) open in about 30 ms. The import box's reading and sizing moved into `import/open.ts`, one lazy chunk per kind of file.
- **Found while checking:** on phones, a dense system (10 stations in 3 lanes and 5 columns) doesn't fit the stage at full text size. In the tall layout `fitFrame`'s passes never settle (k falls from 0.47 to 0.14 in its four passes, and would keep falling), and the frame is drawn at a smaller k than its labels were placed for, so it reports no hits while labels overlap by a few pixels; the landscape layout settles with five hits. Lessons and templates fit; any dense import or trace can meet it. The frame code is shared with every lesson, so it is left for its own change; the trace spec checks label overlap on desktops only. Also fixed: a topic with one subscriber said "1 subscribers".
- **Not built:** one-click regrouping, the stage replay of one request (`replay.tsx`), and "Replay the second" (both need the player to carry sampled spans, and `/my-system` from a link has 0.9 KB left).

### Phase 5 (optional): Level 3, live connectors — needs the owner

**Proposed rule change** (to `CLAUDE.md` "Out of scope"), to confirm before any code:

> No cloud, accounts or backend, **except** an optional local agent the user runs themselves (`npx syslab-agent`), which reads their own OpenTelemetry collector or tracing backend and serves only a reduced, scrubbed `SystemDoc` and sampled spans on `http://localhost:4318x` to the System Lab page in their browser. The site itself stays static; no credentials are ever entered into or stored by the site.

- **Option A (recommended): local agent.** Node CLI in this repo (`agent/`), zero deps beyond Node, reads OTLP/Jaeger/Tempo query APIs with the user's own credentials from env vars, applies the same reducer and scrubber as Phase 4, exposes `GET /system` and `GET /samples` with CORS for `https://sys-design-learning.vercel.app` and `http://127.0.0.1:3000` only. The page polls every 5 s and replays. Prefer staging; read-only by construction.
- **Option B: browser-direct** to a backend that already allows CORS (some Tempo/Jaeger setups). Zero code on our side beyond a URL field; works rarely.
- **Option C: a Vercel function proxy.** Needs secrets in transit through our infrastructure, rate limits, abuse handling and a privacy policy. Not recommended; only with an explicit owner yes and a security review.
- Levels 0–2 never depend on any of these.

### Parallel, thin: net-new concepts

In the order of §3.1, each a normal lesson (`npm run new-lesson`), on its own branch after Phase 2: O3 headroom and N + 1 (first, as it feeds "what breaks if"), C8 hot keys, R11 distributed rate limits, A10 scheduled bursts, O4 tracing a request (after Phase 4, as the bridge). Codes continue each line (frozen-code rule); catalog snapshot updated in review.

---

## 6. Data model for user systems

### 6.1 `SystemDoc`

```ts
interface SystemDoc {
  v: 1;
  name: string;                       // "My shop"
  template?: string;                  // where it started
  parts: PartDoc[];                   // ≤ 24 before grouping
  traffic: {
    rate: number;                     // requests a second at the entry, 1–600
    writes: number;                   // share 0–1
    keys: number;                     // distinct items read (cache realism)
    hot: number;                      // share to one celebrity key, 0–0.6
    shape: "steady" | "daily" | "spiky";
  };
  targets: { p95Ms: number; failed: number }; // default 400 ms, 1%
}

interface PartDoc {
  id: string;                         // stable, from the name
  kind: PartKind;
  name: string;                       // the station's label
  count?: number;                     // 1–4 drawn, more grouped (D5)
  to?: string[];                      // sends to (part ids), in call order
  set?: Partial<PartSettings>;        // only what differs from the kind's defaults
}

type PartKind =
  | "users" | "bots"
  | "dns" | "cdn" | "balancer" | "gateway" | "limiter" | "waiting-room"
  | "service" | "worker" | "external"
  | "cache" | "database" | "queue" | "log" | "topic"
  | "stream" | "lock" | "push";

interface PartSettings {
  workers: number; ms: number;        // service/database/worker/external
  timeoutMs: number; retries: number; // users, service calls
  capacity: number; ttlMs: number; writeMode: "aside" | "through" | "behind"; // cache
  replicas: number; lagMs: number; failover: boolean; shards: number; pool: number; // database
  health: boolean; algo: "round-robin" | "least" | "sticky" | "nearest"; layer: 4 | 7; // balancer
  rps: number;                        // limiter / waiting room
  ack: boolean; deadLetter: boolean; ordered: boolean; partitions: number; // queue/log
  breaker: boolean; bulkhead: boolean; shed: boolean; idempotent: boolean; blocking: boolean; // service
  region: string;                     // multi-region placement
}
```

### 6.2 Compiling to `SceneSpec`

- **Entry:** `users`/`bots` → clients (`rate`, `writes`, `keys`, `skew 1`, `hot`, `timeoutMs`, retries with backoff when `retries > 0`), shape → `wave`/`rush`/constant (`kit.ts`).
- **Parts:** each kind has a builder mapping settings to engine fields: service → `server` (`slots`, `serviceMs`, `blocking`, `breaker`, `bulkheads`, `shed`, `idempotent`, `callTimeoutMs` from the caller's timeout); database → `db` plus, when `replicas`, a primary + replicas with `lagMs`, and when `failover`, a writer endpoint with `promote`; `shards` → a shard router (`algo: "hash"`) and N `db` nodes; `pool` → `connect.max`; cache → `cache` (`capacity`, `ttlMs`, `writeMode`); queue → `queue` + `ack` (+ DLQ part when `deadLetter`); log with `partitions` → partitioner + partitions with `consumers: "first"`; topic → `topic`; balancer → `lb` (`health`, `algo`, `layer`); gateway → `lb` with `byTag`; limiter → `limiter`; waiting room → `limiter` `shared`; cdn → `cache` with the `edge` glyph, one per region when users have regions; dns → `lb` `algo: "nearest"`; external → `server` with `downMode: "hang"`; stream → server with `window`; lock → server with `lock`; push → server with `hold` and users `subscribe`.
- **Calls:** a service's `to` becomes `calls.read`/`calls.write` in order (a cache before a database for reads; writes skip the cache unless `writeMode` says otherwise).
- **Layout:** layered (D4). Column = longest path from an entry; row = barycentre of parents, then spread 14–86. Wide scenes (>6 columns) are allowed; the frame code scales them.
- **Defaults** come from the lessons' own numbers (servers 4 workers × 100 ms, databases 4 × 100 ms, caches 100 items 20 s TTL, `sloMs` 400, `timeoutMs` 1600, `timeScale` 0.1), so a user system behaves like the course.
- **Notes:** the compiler explains what it did in plain words ("App ×12 is drawn as one station with 48 workers.").

### 6.3 Templates (cover the major shapes)

| Template | Parts (left to right) | Shapes it covers |
|---|---|---|
| Web app | Users → Load balancer → App ×3 → Cache → Database | request/response, LB, cache, DB |
| Read-heavy with replicas | Users → LB → App ×2 → Primary + 2 replicas (failover) | primary/replica, lag, failover |
| Shop | Shoppers, Bots → Rate limiter → Gateway → Catalog, Checkout → Payments (external), Orders DB | gateway routing, bulkheads, breakers, external hang |
| Background jobs | Users → API → Queue (ack, DLQ) → Workers ×3 → Email (external) | queues, acks, DLQ |
| Event-driven orders | Shop → Orders (outbox) → Topic → Email, Stock, Analytics | pub/sub, outbox |
| Chat | Users (held connections) → L4 balancer → Push ×2 → Topic, Messages DB | push, L4, heartbeats |
| Video premiere | Viewers (3 regions) → DNS (nearest) → CDN edges → Origin | CDN, geo routing |
| Multi-region | Users EU/US → DNS → Region EU, Region US → DB EU ⇄ DB US | regions, replication, CAP |
| Flash sale | Buyers → Waiting room → Booking → Lock → Seats DB (CAS) | contention, locks |
| Payments | Shoppers (retries) → Payments (idempotent) → Saga → Card network, Stock, Shipping | idempotency, sagas |
| News feed | Readers, Posters → Feed (fan-out to Posts ×4 shards) → Timelines cache | fan-out, hot keys |
| Click counting | Clicks → Click API → Log (partitions) → Counter (windows) → Counts | streams, partitions |
| Crawler | New links → Frontier queue → Fetchers ×4 → The web (external) + Dead letters | queues, timeouts |
| Blank | Users → Service | anything |

### 6.4 Simplify and group (imports and traces)

Applied in order until ≤14 stations, each step reported in a note and reversible with one tap:
1. Merge replicas of one service (same name minus `-1`, `-a`, pod hashes) into a count.
2. Fold sidecars and infrastructure (`istio-proxy`, `envoy` when beside every service, `otel-collector`, `jaeger`) into their neighbours.
3. Merge services sharing a namespace/prefix (`payments-api`, `payments-worker` → Payments) when they have the same callers.
4. Merge leaves of the same kind with one caller (three Redis instances behind one service → Cache ×3).
5. Collapse low-traffic services (<2% of requests) into "Other services".
The user can switch grouping: by service, by prefix/namespace, by kind.

---

## 7. UI flows (text wireframes)

### 7.1 Home (Phase 1, first visit, desktop)

```
┌ ◉ System Lab                      Map  Journeys  My system  Glossary  Progress ┐
│ Watch systems work.                ┌ Live · Requests flow from Users… ─────┐  │
│ Then watch them break.             │  ○──◇──▭ ▭ ▭──⚡──⌸   (tap any name)   │  │
│ An animated field guide: live      │                                        │  │
│ simulations you can break.         └ ▶ ⏭ ↺ 1×   p95 372 ms · hits 78% ─────┘  │
│ ┌ Ride 1 · How the web answers you ┐ ● request ● late ● answered ◆ failed …   │
│ │ (N)─(N)─(F)─(N)─(N)  ~20 min     │                                           │
│ │ [Start: A request and a response · 4 min →]   [Map your own system]         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Phone: headline (two lines) → live scene → legend row → [Start the ride] → ride card → map board.

### 7.2 My System: first view

```
┌ ◉  My system                                                           Key  ┐
│  Start from a system like yours                                             │
│  [Web app ▭▭] [Shop ▭▭] [Background jobs ▭▭] [Chat ▭▭] [Video ▭▭] …          │
│  (each: a still of its stations, one line: "Users → LB → App ×3 → Cache → DB")│
│  Or: [Describe it in words]  [Import a file]  [Replay a trace]               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 My System: the workspace

```
┌ bar: ◉  My shop ·  [Explain like I'm new]  [Share]            Key   ⋯ ────────┐
├ theatre ─────────────────────────────────────┬ panel ─────────────────────────┤
│ strip: "Requests go Users → LB → App → DB"   │ [Design] [What breaks] [Compare]│
│                                              │ Design:                         │
│   ○──◇──▭▭▭──⚡──⌸     (tap a name: card     │  Users      120/s  ▾            │
│                         with its settings)   │  Load balancer       → App      │
│                                              │  App ×3   4 workers · 100 ms ▾  │
│                                              │  Cache    100 items ▾  → DB     │
│                                              │  Database 4 workers ▾           │
│                                              │  [+ Add a part]                 │
│                                              ├ pinned: Response 340 ms ≤ 400 ✓ │
│                                              │         Failed 0% ≤ 1% ✓        │
├ dock: ▶ ⏭ ↺ 1×  Follow one  ⚡ Crash ▾  Surge ×3                              ┤
└────────────────────────────────────────────────────────────────────────────────┘
```

- **What breaks** tab: ranked list ("If Database dies: 100% fail. Single point of failure." [Show me] crashes it on stage for 3 s).
- **Compare** tab: pick a change ("Add a cache", "One more App", "Replicas for the database", or any edit) → the table becomes Your design | With the change | Change, in lockstep, with the same traffic.
- **Explain like I'm new:** the strip walks generated beats (§Phase 2 `explain.ts`), each pointing at a station.

### 7.4 Attach (Phase 3) and replay (Phase 4)

```
┌ Import ───────────────────────────────────────────┐
│ Paste or drop: [ docker-compose.yml ▾ detected ]  │
│ ┌──────────────────────────────────────────────┐  │
│ │ services:                                    │  │
│ │   web: …                                     │  │
│ └──────────────────────────────────────────────┘  │
│ We read 14 services → 9 stations:                 │
│  web → Service    redis → Cache   [change ▾]      │
│  payments-api + payments-worker → Payments (merged)│
│ [Open it]                                         │
└───────────────────────────────────────────────────┘
```

Replay: same workspace; the strip says "Replaying the slowest request: 1.8 s"; the flight strip shows the span waterfall; the panel lists Typical · Slowest · Failed requests.

---

## 8. Testing strategy

- **Unit (node:test):** part words (Phase 0); `compile` for every template and importer fixture (spec valid, every node reachable, runs 5 s with `accounted` and no `leakedHolds`); determinism (same doc → same trace hash); blast radius stable and ranked; share round trip; readers with exact error messages; trace reduction and scrub.
- **Lessons:** the existing claim, fairness and beats tests cover new lessons from the concept track unchanged.
- **Browser (Playwright, four sizes):** stage-fit runs over every template's compiled scene too (labels inside, ≥12 px, no collisions, nothing covers a station, 40 px targets on phones); builder flows; import flows with fixtures; replay; home first-visit and returning states; no document scroll.
- **Weight:** `scripts/weight.mjs` on the production build after each phase; lesson and story pages ≤ 200 KB; `/my-system` ≤ 200 KB.
- **Frames:** the frame-budget project gains the busiest template (news feed at 400/s) once Phase 2 lands.
- **By eye:** screenshots at 1440×900, 1280×720, 390×844, 844×390, light and dark, reduced motion, recorded in each phase's decisions.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Complexity explosion (every engine feature as a setting) | A kind exposes ≤4 settings in plain words; the rest stay engine defaults. Templates show breadth; the editor stays small. |
| Graph hairballs from imports | Grouping to ≤14 stations with notes and one-tap regrouping (§6.4); layered layout; stage-fit tests on large fixtures. |
| PII in traces | Parsing in the browser only; attribute whitelist; pattern scrub; raw file released after reduction; share links carry only the reduced doc. |
| Page weight | Budget per route (D10); importers, readers and blast radius load on demand; `weight.mjs` in the gate. |
| Dishonest simulation of real systems | The UI says "a model of your system" and shows its assumptions (workers, ms) on every card; calibration from traces states its error. |
| `CLAUDE.md` scope (no backend) | L0–L2 need none; L3 waits for the owner's written yes on the rule text in Phase 5. |
| Performance of user scenes | Rates capped at 600/s simulated, stations at 14, `timeScale` lowered for busy scenes; frame-budget test on the busiest template. |
| Determinism across browsers | The engine is already deterministic; docs hash to seeds; compression has a non-streaming fallback. |

## 10. Definition of done ("satisfactory")

- **A beginner stays and learns:** lands on the home page, taps a part on the live scene, reads what it is, starts Ride 1 by its name, finishes N1 with a part card opened and a prediction made, and the Recap points them to a journey that uses the idea. (Checked by a scripted walk in `home.spec.ts` and by `npm run stats` on recorded sessions: Recap reached on N1 ≥ 60%, parts opened per lesson ≥ 1.)
- **An intermediate pastes a graph and understands it:** pastes `Users -> LB -> API x3 -> Redis -> Postgres`, sees it running in one tap, reads "If Postgres dies…", adds a replica, and sees the comparison.
- **An advanced user replays a failure visually:** drops an OTLP JSON export, gets ≤14 stations, opens the failed request, watches it walk their map with the real waterfall, and sees which hop broke.

## 11. Rollback

Each phase is a branch; reverting its merge restores the previous product. No data migrations: new storage keys are additive (`syslab.v1.systems`), and the learning record's format is unchanged (a new event kind `part`).
