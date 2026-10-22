# System Lab

**Watch systems work. Then watch them break.** System Lab is an animated field guide to system design. Each lesson is a live simulation: requests flow as dots, caches hit and miss, queues fill, servers crash and recover, and the metrics change as you turn the knobs.

Live at **[sys-design-learning.vercel.app](https://sys-design-learning.vercel.app)**. Made with care by [Aman](https://amankeshri.com).

![Home: a live scene of users, a load balancer, three servers, a cache and a database](docs/screenshots/home.png)

## The route

There are 18 lessons on five "lines", ending in a capstone:

| Line | Stations |
|---|---|
| **F · Foundations** | Latency & throughput · Scaling up vs out · Load balancing · Health checks |
| **C · Caching** | Caching · CDN · Expiry & stale data · Cache stampede |
| **D · Data** | Read replicas · Sharding · Consistent hashing · Consistency vs availability |
| **A · Async** | Message queues · Publish/subscribe · Retries & backoff |
| **R · Resilience** | Rate limiting · Circuit breakers · Autoscaling |
| **★ Capstone** | Keep a URL shortener alive through four traffic stages |

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

In the capstone you grow the architecture yourself. You add servers, a cache, replicas and a rate limiter, and each stage unlocks once you hold the latency and error target.

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
npm run tune           # print each figure's metrics over a simulated run
```

`npm test` asserts that, for every lesson, the fix beats the problem on its headline metric. A tuning change that would make an animation teach something false fails the build.

## How it works

```text
src/
  app/                    Next.js App Router: home, /learn/[slug] (static), 404
  components/
    shell.tsx             the one-screen layout (bar · stage | panel · dock) and the beat strip
    player.tsx            the lesson player
    capstone.tsx          the stage-by-stage capstone, in the same shell
    stage.tsx             SVG nodes underneath, a canvas of moving requests on top;
                          picks a wide, compact (phone) or tall layout to fit its box
    stage-draw.ts         the canvas: requests batched by look, trails, queue pressure, effects
    live.tsx              useLiveSims (lockstep worlds + animation loop), Compare, MetricSummary, Transport
    glyph.tsx, legend.tsx node shapes, icons, the dot key
    hero.tsx, brand.tsx   home page scene, header and footer
    route-map.tsx         the transit map (SVG on desktop, a strip list on phones)
  lib/
    sim/engine.ts         deterministic, tick-based flow simulator
    sim/metrics.ts        sliding-window p95, error, hit, utilisation, and more
    sim/layout.ts         layout coordinates → wide, compact or tall viewBox
    lessons/*.ts          lessons as pure build(values) → SceneSpec functions
tests/                    node:test engine + lesson tests; Playwright browser tests
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
