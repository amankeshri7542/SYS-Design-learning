@AGENTS.md

# System Lab: working notes

An animated system-design course. It's built with Next.js 16 App Router, React 19, strict TypeScript and plain CSS, and has no runtime dependencies beyond Next and React.

## Commands

- `npm run dev`: start the dev server on 127.0.0.1:3000. The Playwright tests start their own on port 3100.
- `npm run typecheck && npm test && npm run build`: the required gates.
- `npm run test:browser`: Playwright, desktop and mobile projects. Run `npx playwright install chromium` once first.
- `npm run tune [slug] [ms]`: print each figure's metrics. Use it when changing lesson numbers.

## Where things live

- `src/lib/sim/engine.ts`: the deterministic simulator. All randomness comes from seeded per-node streams.
  - Keep arrivals independent of downstream behaviour, so a problem scene and its fix see the same traffic.
- `src/lib/lessons/*.ts`: lessons, as pure `build(values) => SceneSpec`.
  - Each fix figure has a `compare` build. `tests/lessons.test.ts` asserts the fix beats it on the first metric.
- `src/components/stage.tsx`: the renderer. SVG nodes go in the React layer; dots, effects and queue formations go on the canvas.
  - Layout coordinates are `[along, across]`, each from 0 to 100. Phones get the same graph transposed, one row per distinct "along" value.
- `src/app/globals.css`: all styles. Design tokens (colours, line colours, dot colours) sit at the top, with a dark-mode block.

## Conventions

- **Lesson shape.** One-line `why`, then a problem figure, then a fix figure (or a pair of trade-off figures).
  - At most 2 knobs, 4 metrics, and a caption under 60 words.
  - Plain words; no jargon before the scene shows it.
- **Visual language.** Never reuse a dot colour for a new meaning. The mapping is fixed: cobalt for a request, amber for late, green for answered, violet for stale, slate for turned away, red for failed. Shape carries the state as well as colour.
- **Fault buttons.** Each action reads its on/off state from the simulation (`isOn`), so scripted faults and buttons stay in sync.
- **Reduced motion.** Must keep working: no autoplay, a settled still frame, and CSS animations disabled.
- **Out of scope.** No cloud, accounts or backend. Progress is a localStorage list of visited lessons and nothing more.
