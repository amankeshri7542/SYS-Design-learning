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
  - `tests/lessons.test.ts` asserts the fix beats the problem on its headline metric (`FigureDef.headline`, by default the fix's first metric).
- `src/components/player.tsx`: the one-screen lesson player.
  - `Shell` lays out bar · stage | panel · dock. The document never scrolls; only the panel does.
  - Every step's world runs in lockstep (`useLiveSims`) for the Without/With/Change table.
- `src/components/stage.tsx`: the renderer. SVG nodes go in the React layer; dots, effects and queue formations go on the canvas.
  - Layout coordinates are `[along, across]`, each from 0 to 100.
  - The stage measures its box and picks a layout: `wide` (desktop), `compact` (tighter, for phones) or `tall` (transposed).
  - A lesson's frame is sized for all of its steps, so switching steps never rescales the scene.
- `src/app/globals.css`: all styles. Design tokens (colours, line colours, dot colours) sit at the top, with a dark-mode block.

## Conventions

- **Lesson shape.** One-line `why`, then a problem figure, then a fix figure (or a pair of trade-off figures).
  - Each figure has a `short` tab name of two words at most.
  - Faults pair across figures by action `id`, not position: a fault offered in two steps has the same id and label, and hits both worlds.
  - At most 2 knobs, 4 metrics, and a caption under 60 words.
  - Plain words; no jargon before the scene shows it.
- **Fairness.** A problem and its fix (or both sides of a trade-off) share `sloMs`, `timeoutMs`, `timeScale` and `windowMs`, and must produce identical first-attempt arrival traces (`new Sim(spec, { trace: true })`). The fairness test in `tests/lessons.test.ts` checks both. Explore figures change the traffic on purpose and are exempt.
- **Change column.** Only a `problem,fix` lesson gets better/worse verdicts. Explore and trade-off steps show a plain signed difference, and metrics with `better: "neutral"` (servers in use) never get a verdict. Response-time rows show their target.
- **Visual language.** Never reuse a dot colour for a new meaning. The mapping is fixed: cobalt for a request, amber for late, green for answered, violet for stale, slate for turned away, red for failed. Shape carries the state as well as colour.
- **Fault buttons.** Each action reads its on/off state from the simulation (`isOn`), so scripted faults and buttons stay in sync.
- **Reduced motion.** Must keep working: no autoplay, a settled still frame, and CSS animations disabled.
- **Motion.** Use ease-out for things entering, linear travel for requests, and no decorative loops. Animate only transform and opacity, except one-time SVG strokes.
- **Screen fit.** Lesson pages must fit the viewport at 1280×720 and on a 390×844 phone. `npm run test:browser` asserts that the document doesn't scroll.
- **Out of scope.** No cloud, accounts or backend. Progress is a localStorage list of visited lessons and nothing more.
