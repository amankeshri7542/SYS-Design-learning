# System Lab

**Watch systems work. Then watch them break.** System Lab is an animated field guide to system design. Each lesson is a live simulation: requests flow as dots, caches hit and miss, queues fill, servers crash and recover, and the metrics change as you turn the knobs.

Live at **[sys-design-learning.vercel.app](https://sys-design-learning.vercel.app)**. Made with care by [Aman](https://amankeshri.com).

![Home: a live scene of users, a load balancer, three servers, a cache and a database](docs/screenshots/home.png)

## The route

The course is a transit map. Lines are topics, and three fare zones are the levels: beginner, intermediate and advanced. There are 18 lessons live on five lines, plus one journey, a real system you build stage by stage:

| Line | Stations |
|---|---|
| **F · Foundations** | F1 Latency & throughput · F2 Scaling up vs out · F3 Load balancing · F4 Health checks |
| **C · Caching** | C1 Caching · C2 CDN · C3 Expiry & stale data · C4 Cache stampede |
| **D · Data** | D2 Read replicas · D3 Sharding · D4 Consistent hashing · D7 Consistency vs availability |
| **A · Async** | A1 Message queues · A2 Publish/subscribe · A3 Retries & backoff |
| **R · Resilience** | R1 Rate limiting · R2 Circuit breakers · R3 Autoscaling |
| **★ Journeys** | S0 Keep a URL shortener alive through four traffic stages |

The catalog plans 57 lessons on seven lines (Networking and Operating join) and nine journeys. Each has its final code already, so a line shows gaps (D1, D5, D6…) until its missing lessons are built; see [docs/plan-v3.md](docs/plan-v3.md). One recommended path interleaves the lines, and every lesson's **Next stop** follows it.

The home page draws the map with the zones as bands. Hover or focus a station to see its card with the lesson running; a dimmed station is best seen after another. On a phone the map becomes a board you can filter by level and search by any name a concept goes by ("thundering herd", "429", "Kafka").

![The route map: lines as rows, levels as zone bands, and a station's card with its lesson running](docs/screenshots/route-map.png)

Every lesson fits on one screen, so you never scroll to find the simulation and then scroll back to read about it:

- **Stage.** The live scene fills most of the screen. A strip along its edge says whether you're watching the problem or the fix, and names events as they happen: a crash, a stall, a broken link.
- **Side panel.** It holds the steps as tabs:
  - **The problem**: the scene without the idea.
  - **The fix**: the same scene and the same random seed, with the idea added.
  - **Recap**: why it matters, when to use it, the catch, and where you'll see it.
- **Comparison table.** Pinned under the steps, a live **Without | With | Change** table measures both worlds side by side. They run in lockstep, and a fault button hits both.
- **Dock.** Playback controls, the speed and what it means ("1 s on screen = 100 ms"), and the single **Next** button. The dot **Key** opens from the top bar.
- **Phones.** The stage stays fixed on top with the lesson's headline number under it. The panel is the only part that scrolls, and the dock sits at the bottom.

![The caching lesson on one screen: scene, steps, knob and Without/With/Change table](docs/screenshots/lesson-caching.png)

<img src="docs/screenshots/mobile-rate-limiting.png" alt="The rate-limiting lesson on a phone" width="300">

In a journey you grow the architecture yourself. In the URL shortener you add servers, a cache, replicas and a rate limiter, and each stage unlocks once you hold the latency and error target. Every journey runs on the same story player; a new one is data.

![Capstone: architecture controls, cost, and a target that has to hold](docs/screenshots/capstone.png)

## How to read a scene

- **Dots are requests.**
  - Cobalt: in flight.
  - Amber: running late.
  - Green: answered.
  - Violet donut: stale data.
  - Slate square: turned away (rate-limited or a fallback).
  - Red diamond: failed.
  - Hollow red: the user gave up.
- **Shapes are parts of the system.**
  - Slot sockets inside a server are its workers. A hollow socket is a worker stuck waiting.
  - Waiting requests line up in front of a node.
  - A cache's bar shows how full it is.
- Scenes run about 10× slower than the milliseconds in the metrics, so you can follow a single request.

## Run it

You need Node.js 22 or newer.

```bash
npm ci
npm run dev            # http://127.0.0.1:3000
```

## Check it

```bash
npm run typecheck
npm test               # engine invariants + every lesson's claim, in numbers
npm run build
npx playwright install chromium
npm run test:browser   # desktop + mobile: pages render, scenes animate, controls work
npm run tune           # print each figure's metrics over a simulated run (--beats, --json, --line=, --level=)
```

To start a planned lesson: `npm run new-lesson -- <slug>` writes its skeleton and registers it; the tests fail until it is written.

`npm test` asserts that, for every lesson, the fix beats the problem on its headline metric. A tuning change that would make an animation teach something false fails the build.

## How it works

```text
src/
  app/                    Next.js App Router: home, /learn/[slug] (static), /glossary, 404
  components/
    shell.tsx             the one-screen layout (bar · stage | panel · dock) and the beat strip
    lesson-page.tsx       loads one lesson's scenes (or one story) per page, and the next stop's when idle
    player.tsx            the lesson player
    story-player.tsx      the stage-by-stage player every journey runs on, in the same shell
    stage.tsx             SVG nodes underneath, a canvas of moving requests on top;
                          picks a wide, compact (phone) or tall layout to fit its box
    stage-draw.ts         the canvas: requests batched by look, trails, queue pressure, effects
    live.tsx              useLiveSims (lockstep worlds + animation loop), Compare, MetricSummary, Transport
    beats.tsx, follow.tsx the narration: beats, callouts, cards; following one request
    route-map.tsx         the transit map (zones as bands, station cards) and the phone board
    journeys.tsx, read-scene.tsx, home-start.tsx, hero.tsx   the rest of the home page
  lib/
    sim/engine.ts         deterministic, tick-based flow simulator
    sim/metrics.ts        sliding-window p95, error, hit, utilisation, and more
    sim/layout.ts         layout coordinates → wide, compact or tall viewBox
    lessons/catalog.ts    every lesson and journey, built or planned: codes, levels, the path
    lessons/scenes/       one file per lesson: pure build(values) → SceneSpec, and its beats
    lessons/stories/      one file per journey: a StoryDef
tests/                    node:test engine, lesson and catalog tests; Playwright browser tests
```

- **The engine.** The engine (`src/lib/sim`) is deterministic: a seeded PRNG drives a fixed 2 ms tick, with no I/O.
  - Requests travel out through the scene's nodes and retrace their path back.
  - Node kinds:
    - clients
    - load balancers (round robin, random, least busy, hash, consistent-hash ring, health checks, autoscaling)
    - servers (workers, waiting line, sequential calls, call timeouts, circuit breakers)
    - caches (LRU, TTL, request coalescing, delete-on-write)
    - databases (replicas with lag, multi-region CP/AP under a partition)
    - queues, topics and rate limiters
  - Clients time out and retry, with backoff, jitter and an optional retry budget.
  - A timed-out request keeps running as a ghost. That wasted work is what makes retry storms possible.
- **Live knobs.** Changing a knob rebuilds the scene spec, and `sim.reconfigure(spec)` patches the running simulation in place.
- **Rendering.**
  - Only on-screen scenes animate. React re-renders the SVG about 11 times a second; the canvas draws every frame.
  - When you switch steps, components the two worlds share stay put and new ones scale in with an accent ring.
  - Numbers are smoothed so they glide instead of flickering.
- **Reduced motion.** Nothing autoplays. Figures open on a settled still frame, and Play and Step are always available.

See [docs/plan.md](docs/plan.md) for the audit, the design decisions and the scope.

## Deploy

Vercel builds every push to `main`. No environment variables or external services are needed.
