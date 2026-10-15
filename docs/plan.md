# System Lab plan

## Audit of the old app, from a first-time learner's view

- **Walls of text.** Each lesson opens with about 2,900 characters of prose, forms, an event log and a pseudocode box before anything moves.
- **No real motion.** The "animation" is a highlighted arrow between three static boxes, with an event counter ("event 10 / 54"). You never see a request travel, wait, fail or get answered.
- **Jargon first.** "Source v1", "Follow this event", "Conceptual / AWS", seeds, pinned A/B forks and replay cursors all appear before the idea lands.
- **Too much surface.** There are 56 lessons in a sidebar tree, plus a separate journey, a library, progress, AWS sign-in and an account sync. A newcomer can't tell where to start or what matters.
- **Heavy code.** About 18k lines, Cognito/DynamoDB/SAM infrastructure and a 3,700-line stylesheet, most of it there to support the above.

## What "great" looks like

The references are samwho.dev (Load Balancing, Queueing), Ciechanowski, Secret Lives of Data and Red Blob Games. What they share:

- One idea per figure.
- The failure is shown before the fix, using the same random seed.
- Figures autoplay when scrolled into view.
- Requests are dots: they move at constant speed, warm in colour as they wait, and fall off the stage when dropped.
- Each figure has at most 2 knobs and 3 metrics, with 1–2 sentences of text between figures.
- State is encoded by shape as well as colour.
- Offscreen figures stop drawing.

## Scope

Delete:
- the AWS/Cognito/DynamoDB code, `infra/`, the API routes and auth callback
- Docker and the standalone server script
- all old docs, screenshots and tests
- the 56-lesson catalog and the old event engine (it produces narrated snapshots, not motion, so it can't be reused)

Keep: Next.js App Router, React, strict TypeScript, plain CSS, Playwright, and `node --test`.

That leaves **18 lessons plus a capstone**, arranged as a route map with five lines and a final interchange:

| Line | Stations |
|---|---|
| **F · Foundations** | F1 Latency & throughput · F2 Scaling up vs out · F3 Load balancing · F4 Health checks |
| **C · Caching** | C1 Caching · C2 CDN · C3 Expiry & stale data · C4 Cache stampede |
| **D · Data** | D1 Read replicas · D2 Sharding · D3 Consistent hashing · D4 Consistency vs availability |
| **A · Async** | A1 Message queues · A2 Publish/subscribe · A3 Retries & backoff |
| **R · Resilience** | R1 Rate limiting · R2 Circuit breakers · R3 Autoscaling |
| **★ Capstone** | Keep a URL shortener up through four traffic stages: launch, featured, viral, attack + crash |

## Lesson shape (every lesson)

1. **Station code, title, and one line on why it exists.**
2. **Figure 1, "Problem"**: the scene without the idea. It autoplays and has 0–1 knobs. A caption says what to watch.
3. **Figure 2, "Fix"**: the same scene and seed with the idea added. It has 1–2 knobs and live metrics, and each metric shows its value *without* the idea alongside, from a hidden baseline simulation.
4. **Takeaways, three lines**: *Use it when*, *The catch*, *Seen in*.
5. **Next station.**

Fault buttons ("Crash server 2", "Cut the network") and looping scripted events ("Traffic spike") give passive viewers the failure without needing to click.

## Engine

`src/lib/sim` is a new deterministic, tick-based flow simulator. There is no I/O and no randomness outside a seeded mulberry32.

- **Nodes:**
  - `client`
  - `lb` (round-robin / random / least-busy / hash / ring, optional health probes and autoscaler)
  - `server` (slots, service time, queue limit, sequential downstream calls, call timeout, circuit breaker)
  - `cache` (LRU, TTL, coalescing, delete-on-write)
  - `db` (primary/replica with replication lag, partition-aware CP/AP modes)
  - `queue` and `topic` (fork detached jobs, acknowledge immediately)
  - `limiter` (token bucket per client)
- **Requests:**
  - Requests travel out and retrace their path back.
  - Servers hold a slot while they wait on a downstream call, so blocked threads are visible.
  - Clients time out and retry: none, immediately, or with exponential backoff and jitter.
  - Timed-out work keeps running as a ghost, which is how retry storms happen.
- **Data truth:** a global write sequence decides whether a read is *stale*.
- **Live knobs:** lessons are pure `build(values) → SceneSpec` functions. Changing a knob calls `sim.reconfigure(spec)`, which patches the running simulation in place rather than restarting it.
- **Tests:**
  - engine invariants and determinism
  - for **every lesson**, the fix measurably beats the problem on that lesson's headline metric, so the animation can't teach something false

## Visual language

- **Rendering:**
  - SVG station cards for nodes (React, refreshed at about 12 Hz) under a canvas particle layer that runs every frame, capped at 2× device pixel ratio.
  - A fixed viewBox, with a wide layout on desktop and the same graph transposed to a tall layout on phones.
- **Glyphs:**
  - client = person stack
  - load balancer = diamond
  - server = card with slot sockets
  - cache = card with lightning bolt and fill bar
  - database = cylinder
  - queue = tube that jobs line up inside
  - topic = broadcast mark
  - limiter = gate
- **Dot colours and shapes:**

  | Colour | Meaning | Shape |
  |---|---|---|
  | Cobalt | In flight | Circle |
  | Amber | Waiting past the latency target | Circle |
  | Green | Answered | Circle |
  | Violet | Stale | Donut |
  | Slate | Turned away (rate-limited or fallback) | Square |
  | Red | Failed | Diamond; drops fall off with gravity |
  | Red | Timed out | Hollow ghost |

  Waiting dots line up in front of the node, and dots in service show a clock-wipe ring.
- **Motion:**
  - Requests travel linearly at constant speed.
  - Queues ease with `cubic-bezier(.22,1,.36,1)`.
  - Status colours fade over 200ms.
  - The clock runs about 8× slower than the metrics' milliseconds, and the scene says so.
- **Controls:**
  - Play/pause, step, 0.5/1/2× speed and restart, all native buttons and radios with visible focus.
  - Space toggles playback when the figure is focused.
  - With `prefers-reduced-motion` nothing autoplays: the figure renders a warmed-up still frame and plays only on request.
- **Identity:** the course is a transit network. Chapters are coloured lines, lessons are stations with codes (F1…R3), and the capstone is the terminal interchange.
- **Type:** Overpass (signage display), Atkinson Hyperlegible Next (body), Overpass Mono (metrics).
- **Pages:**
  - Home: a live hero scene, "How to read a scene", and the route map.
  - Lessons: `/learn/[slug]`, statically generated.
  - Visited stations are stored in localStorage.

## Done means

- `npm run typecheck && npm test && npm run build` and `npm run test:browser` are green.
- Screenshots at 1440 and 390 px have been checked by eye.
- The work is pushed to `main`, and Vercel serves the new version at sys-design-learning.vercel.app.

---

## v2: one-screen lesson player

**Feedback.** The user had to scroll to see the simulation, then scroll again to read the text, and the phone was worse. Stacking two figures plus takeaways vertically was the cause.

**References.**
- PhET: a fixed logical stage scaled to fit, with controls inside it.
- Algorithm Visualizer: a full-height app with panes, where the page never scrolls.
- Secret Lives of Data and Nicky Case's *Trust*: one stage, short text, and objects that carry over and tween between steps.
- Duolingo and Brilliant: one forward action, plus visible progress.
- The Pudding: keep every step reachable.
- web.dev: use `svh` units, not `100vh`.
- NN/g: no long reading in bottom sheets.

**Decisions.**

- **One app shell per lesson, and the document never scrolls.**

  ```
  desktop / tablet landscape                      phone (portrait)
  ┌────────────────────────────────────────────┐  ┌──────────────────┐
  │ ◉ F ·F1 F2 F3 F4·  F3 Load balancing  ‹ ›  │  │ ◉  F3 Load bal… ›│ bar
  ├──────────────────────────────┬─────────────┤  ├──────────────────┤
  │                              │ why         │  │ stage (compact   │
  │   stage (fills, contain)     │ [1][2][✓]   │  │ layout, 46svh)   │
  │                              │ caption     │  ├──────────────────┤
  │                              │ knobs·fault │  │ [1][2][✓] tabs   │ panel
  │                              │ Without|With│  │ caption, knobs,  │ (only
  │                              │   |Δ table  │  │ compare table    │ scroller)
  ├──────────────────────────────┴─────────────┤  ├──────────────────┤
  │ ▶ ⏭ ↺ 0.5 1 2 · slow-mo · Key   ‹ Back Next›│  │ ▶ ⏭ ↺ 1×  Next › │ dock
  └────────────────────────────────────────────┘  └──────────────────┘
  ```

- **Steps.** Each step is a tab: Problem, Fix, Takeaways. Switch with the tabs, the ← and → keys, or the single primary Next button in the dock.
  - Both worlds run in lockstep on the same seed, and a fault button hits both.
  - Switching shows the other world on the same stage. Nodes they share keep their place, new components scale in with a one-time accent ring, and links fade in.
- **Numbers.** A "Without | With | Δ" table, coloured by good or bad, with the inactive column muted.
- **Scene layouts.**
  - **wide:** the desktop layout.
  - **compact:** phones and short boxes. Tighter spacing, slightly smaller glyphs, and secondary labels only when they carry news.
  - **tall:** narrow, tall boxes.

  The stage measures its box and picks whichever layout reads best.
- **Motion.**
  - Ease-out for entering, and linear travel for requests.
  - Panel content enters with opacity, an 8px shift and a light blur.
  - Numbers are smoothed so they don't flicker.
  - No decorative loops.
  - Everything is off under reduced motion.
- **Home.** A two-column hero: copy and CTA beside the live scene, with the dot key as a strip. The route map follows.
