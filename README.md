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

Every lesson has the same shape:

- A one-line **why** it exists.
- **The problem**: the scene without the idea.
- **The fix**: the same scene and the same random seed, with the idea added. Its numbers sit next to the problem's.
- Three short takeaways: when to use it, the catch, and where you'll see it.

![The fix scene of the caching lesson, with live metrics compared to the no-cache run](docs/screenshots/lesson-caching.png)

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
    stage.tsx             SVG nodes underneath, a canvas of moving requests on top
    glyph.tsx             node shapes and icons
    live.tsx              useLiveSim: animation loop, playback, metrics tiles
    figure.tsx            one lesson scene: stage, controls, faults, knobs, metrics
    capstone.tsx          the stage-by-stage capstone
    route-map.tsx         the transit map (SVG on desktop, a strip list on phones)
  lib/
    sim/engine.ts         deterministic, tick-based flow simulator
    sim/metrics.ts        sliding-window p95, error, hit, utilisation, and more
    sim/layout.ts         layout coordinates → wide or tall (phone) viewBox
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
- **Rendering.** Only on-screen figures animate. React re-renders the SVG about 11 times a second; the canvas draws every frame.
- **Reduced motion.** Nothing autoplays. Figures open on a settled still frame, and Play and Step are always available.

See [docs/plan.md](docs/plan.md) for the audit, the design decisions and the scope.

## Deploy

Vercel builds every push to `main`. No environment variables or external services are needed.
