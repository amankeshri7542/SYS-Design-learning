@AGENTS.md

# System Lab: working notes

An animated system-design course. It's built with Next.js 16 App Router, React 19, strict TypeScript and plain CSS, and has no runtime dependencies beyond Next and React.

## Commands

- `npm run dev`: start the dev server on 127.0.0.1:3000. The Playwright tests start their own on port 3100.
- `npm run typecheck && npm test && npm run build`: the required gates.
- `npm run test:browser`: Playwright on four projects (desktop, desktop-short, mobile, phone-landscape). Run `npx playwright install chromium` once first.
- `npm run tune [slug] [ms]`: print each figure's metrics. Use it when changing lesson numbers.

## Where things live

- `src/lib/sim/engine.ts`: the deterministic simulator. All randomness comes from seeded per-node streams.
  - Keep arrivals independent of downstream behaviour, so a problem scene and its fix see the same traffic.
- `src/lib/lessons/*.ts`: lessons, as pure `build(values) => SceneSpec`.
  - `tests/lessons.test.ts` asserts the fix beats the problem on its headline metric (`headlineOf`: `FigureDef.headline`, by default the fix's first metric).
- `src/components/shell.tsx`: the one-screen layout shared by lessons and the capstone.
  - `Shell` lays out bar · theatre | panel · dock. The theatre is one sheet: the `BeatStrip` row, then the stage. The panel is a reading part (`.panel-scroll`) over the pinned comparison table (`.panel-pin`). Phones add a summary row of the headline number, and their panel scrolls as one.
  - Nothing floats over the stage. The Key is a popover from the bar (`legend.tsx`); scripted event notes go on the beat strip.
  - The document never scrolls; only the panel does, and only if it must.
- `src/components/player.tsx`: the lesson player. Every step's world runs in lockstep (`useLiveSims`) for the Without/With/Change table.
- `src/components/stage.tsx`: the renderer. SVG nodes go in the React layer; dots, effects and queue formations go on the canvas.
  - Layout coordinates are `[along, across]`, each from 0 to 100.
  - The stage measures its box and picks a layout: `wide` (desktop), `compact` (tighter, for landscape phones) or `tall` (transposed, for portrait phones). Portrait boxes only use `compact` for scenes of at most two lanes and three columns; landscape boxes never use `tall`.
  - A lesson's frame is sized for all of its steps (`frameSpecs`), so switching steps never rescales the scene.
- `src/lib/sim/layout.ts`: the frame. Stage text stays at its CSS size (13px labels, 12px subs, 11px badges, `TEXT`), so the frame is fitted to the box in passes: it reserves room for every label in pixels, gives each label the first clear side, and spreads the stations apart if a label still collides.
- `src/app/globals.css`: all styles. Tokens sit at the top: the day edition, then the night edition. Dot colours are for dots only; text uses the `--t-*` tones, small text on a line colour uses its `--l-*-ink` variant, and filled tones carry their text with `--on-*`. `tests/tokens.test.ts` checks every pair for contrast.

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
- **Screen fit.** Lesson pages must fit the viewport at 1440×900, 1280×720, a 390×844 phone and an 844×390 landscape phone (the four Playwright projects).
  - `npm run test:browser` asserts that the document doesn't scroll, that the panel's reading part doesn't scroll on any problem or fix step at 1440×900 and 1280×720, and that phones show the headline number without scrolling.
  - `tests/browser/stage-fit.spec.ts` asserts that every stage label is inside the stage, at full size and clear of other labels, that nothing covers a station, and that phone controls are at least 40px square.
  - A longer caption or an extra knob has to fit 1280×720. Shorten the copy rather than letting the panel scroll.
- **Out of scope.** No cloud, accounts or backend. Progress is a localStorage list of visited lessons and nothing more.
