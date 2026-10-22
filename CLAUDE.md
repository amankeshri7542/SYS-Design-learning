@AGENTS.md

# System Lab: working notes

An animated system-design course. It's built with Next.js 16 App Router, React 19, strict TypeScript and plain CSS, and has no runtime dependencies beyond Next and React.

## Commands

- `npm run dev`: start the dev server on 127.0.0.1:3000. The Playwright tests start their own on port 3100.
- `npm run typecheck && npm test && npm run build`: the required gates.
- `npm run test:browser`: Playwright on four projects (desktop, desktop-short, mobile, phone-landscape), then two frame-budget projects (frames-desktop, frames-mobile) that run after them, alone, with the CPU slowed 4×. Run `npx playwright install chromium` once first.
- `npm run tune [slug] [ms]`: print each figure's metrics. Use it when changing lesson numbers.

## Where things live

- `src/lib/sim/engine.ts`: the deterministic simulator. All randomness comes from seeded per-node streams.
  - Keep arrivals independent of downstream behaviour, so a problem scene and its fix see the same traffic.
  - What the stage draws is output only: effects (`fx`: a cache's fill and evict, a node running hot, a drop with its queue slot) and per-link traffic (`links`, read through `flowOf`). Reading or clearing it never changes a run; `tests/motion.test.ts` checks that.
- `src/lib/lessons/*.ts`: lessons, as pure `build(values) => SceneSpec`.
  - `tests/lessons.test.ts` asserts the fix beats the problem on its headline metric (`headlineOf`: `FigureDef.headline`, by default the fix's first metric).
- `src/components/shell.tsx`: the one-screen layout shared by lessons and the capstone.
  - `Shell` lays out bar · theatre | panel · dock. The theatre is one sheet: the `BeatStrip` row, then the stage. The panel is a reading part (`.panel-scroll`) over the pinned comparison table (`.panel-pin`). Phones add a summary row of the headline number, and their panel scrolls as one.
  - Nothing floats over the stage. The Key is a popover from the bar (`legend.tsx`); scripted event notes go on the beat strip.
  - The document never scrolls; only the panel does, and only if it must.
- `src/components/player.tsx`: the lesson player. Every step's world runs in lockstep (`useLiveSims`) for the Without/With/Change table.
- `src/components/stage.tsx`: the renderer. SVG nodes go in the React layer (memoised `NodeView` and `LinkView`); dots, trails, effects and queue formations go on the canvas (`stage-draw.ts`, batched by look).
  - Layout coordinates are `[along, across]`, each from 0 to 100.
  - The stage measures its box and picks a layout: `wide` (desktop), `compact` (tighter, for landscape phones) or `tall` (transposed, for portrait phones). Portrait boxes only use `compact` for scenes of at most two lanes and three columns; landscape boxes never use `tall`.
  - A lesson's frame is sized for all of its steps (`frameSpecs`), so switching steps never rescales the scene.
  - The scene builds in along the flow once per lesson; parts the previous lesson showed are already there. A step switch keeps shared parts, glides moved ones, and fades out the ones it removes.
- `src/lib/sim/layout.ts`: the frame. Stage text stays at its CSS size (13px labels, 12px subs, 11px badges, `TEXT`), so the frame is fitted to the box in passes: it reserves room for every label in pixels, gives each label the first clear side, and spreads the stations apart if a label still collides. Once sized, labels step off rails where the frame has room; one that can't sits on a plate the rail passes under.
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
  - Marks that extend those meanings keep them: a rail glows cobalt with its traffic (red when most of it fails); a waiting line sits on an amber pressure wedge; a replica with a copy in flight shows a violet rule (a read there may be stale); a copy travels as a small hollow muted square.
  - Things that are not requests take ink, never a dot colour: an evicted cache entry falls as a flat ink chip.
  - Rings mark a station changing state (crash, recover, boot, hot, a breaker opening or closing); a cache's hit or miss gets only a faint one, at most one per cache every 250 ms.
- **Fault buttons.** Each action reads its on/off state from the simulation (`isOn`), so scripted faults and buttons stay in sync.
- **Reduced motion.** Must keep working: no autoplay, a settled still frame, and CSS animations disabled.
- **Motion.** Use ease-out for things entering, linear travel for requests, and no decorative loops. Animate only transform and opacity, except one-time SVG strokes.
  - Durations come from the tokens: `--dur-fast` 120, `--dur-exit` 160, `--dur-base` 240, `--dur-switch` 480 (`src/lib/motion.ts` mirrors them). A step switch is two beats: exits and the glide at 0, entries and new links at `--beat` (120 ms). `tests/browser/motion.spec.ts` checks it.
  - The scene intro is the one longer moment: parts 60 ms apart, 360 ms each, links drawing in 420 ms.
- **Screen fit.** Lesson pages must fit the viewport at 1440×900, 1280×720, a 390×844 phone and an 844×390 landscape phone (the four Playwright projects).
  - `npm run test:browser` asserts that the document doesn't scroll, that the panel's reading part doesn't scroll on any problem or fix step at 1440×900 and 1280×720, and that phones show the headline number without scrolling.
  - `tests/browser/stage-fit.spec.ts` asserts that every stage label is inside the stage, at full size and clear of other labels and rails, that nothing covers a station, and that phone controls are at least 40px square.
  - A longer caption or an extra knob has to fit 1280×720. Shorten the copy rather than letting the panel scroll.
- **Out of scope.** No cloud, accounts or backend. Progress is a localStorage list of visited lessons and nothing more.
