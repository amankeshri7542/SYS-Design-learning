@AGENTS.md

# System Lab: working notes

An animated system-design course. It's built with Next.js 16 App Router, React 19, strict TypeScript and plain CSS, and has no runtime dependencies beyond Next and React.

## Commands

- `npm run dev`: start the dev server on 127.0.0.1:3000. The Playwright tests start their own on port 3100.
- `npm run typecheck && npm test && npm run build`: the required gates.
- `npm run test:browser`: Playwright on four projects (desktop, desktop-short, mobile, phone-landscape), then two frame-budget projects (frames-desktop, frames-mobile) that run after them, alone, with the CPU slowed 4×. Run `npx playwright install chromium` once first. Specs import `test` from `tests/browser/fixtures.ts`, whose `page.goto` waits for the root layout's hydration mark (`html[data-hydrated]`) and, on a lesson, for the stage to pick a layout. To re-run only the frame budgets, pass `--no-deps --workers=1`; they need a quiet machine.
- `npm run tune -- [slug] [ms] [--line=<id>] [--level=<level>] [--beats] [--json]`: print each figure's metrics (and with `--beats`, when each beat fires). Use it when changing lesson numbers; compare `--json` before and after an engine change.
- `npm run new-lesson -- <slug>`: turn a planned catalog entry into a lesson skeleton, registered everywhere it must be.

## Where things live

- `src/lib/sim/engine/`: the deterministic simulator (`engine.ts` re-exports it). `sim.ts` holds the state, the fixed-tick loop and the public controls; each concern (`control`, `clients`, `transport`, `routing`, `cache`, `data`, `work`, `connections`, `realtime`) is a module that attaches its methods to `Sim`, declared once in `sim.ts`'s `interface Sim`. All randomness comes from seeded per-node streams.
  - Keep arrivals independent of downstream behaviour, so a problem scene and its fix see the same traffic.
  - `SceneSpec.links` takes a latency or a `LinkSpec` (`ms`, `jitterMs`, `loss`, `parallel`, `perCostMs`, `label`). A crossing's loss and jitter come from `fate()`, a hash of the link, the request's `logicalId`, its attempt and `hop`, never from the clock, so both worlds lose the same messages. A fix that adds a node before a lossy link changes `hop` there, and that link's fates with it.
  - Messages and delivery (M7): `idempotent` keeps a note per logical message (sender and `logicalId`) to answer repeats or count duplicates; a queue with `ack` hands out copies and keeps each job until acked (visibility timeout, redelivery, dead letters, `ordered`); `backpressure` holds, rejects or drops; a database's `outbox` relays an event per write; `consumers: "first"` gives a partition one consumer.
  - Connections and real time (M8): `connect` opens connections (handshake round trips as small grey rings, keep-alive, a `max` per target, `streams` one, multiplex or independent, a pool's `waitMs`, a resend timeout `rtoMs` that turns a link's loss into a delay); `maxConns` refuses handshakes past a limit. `ClientSpec.window` caps requests in flight (fixed or AIMD, timed from when each goes out) and `advertise` lets a receiver say how much room it has; `LinkSpec.buffer` drops past a narrow link's line. Requests waiting at their sender sit in `sendq`. A balancer at `layer: 4` pins each connection (or user) to a target, and one with `serviceMs` parses each request first (an L7 gateway). `subscribe` keeps a connection per user open at a server with `hold`, which pushes each `news` item down every one; a `feed` answers polls with its latest item; `subscribe.heartbeat` notices a silent connection. A balancer with `promote` sends to its primary and promotes the next healthy replica; `replication: "sync"` waits for every copy; `prewarm` brings a cache back holding its hottest keys.
  - `src/lib/sim/invariants.ts` (tests only): `accounted`, `leakedHolds`, `arrivalTrace`. `tests/invariants.test.ts` checks determinism, accounting, no leaked holds and arrival independence over every scene; `tests/hooks.test.ts` has one test per engine hook. A new container of requests must be listed in `Sim.holds(n)`.
  - What the stage draws is output only: effects (`fx`: a cache's fill and evict, a node running hot, a drop with its queue slot) and per-link traffic (`links`, read through `flowOf`). Reading or clearing it never changes a run; `tests/motion.test.ts` checks that.
- `src/lib/lessons/catalog.ts`: every lesson and story, built or planned, as metadata only (slug, frozen code, line, level, minutes, tags, `requires`, kind, status), plus `LINES`, the recommended `PATH` and the interview `FAST_LANE`. `index.ts` is the registry over it (`COURSE`, `LESSONS`, `STORIES`, `neighbours`, `nextFor`, `isReady`…): metadata, safe anywhere.
  - `scenes/<slug>.ts`: one lesson's scenes, as pure `build(values) => SceneSpec`, with their narration as data (`parts`, `beats`, `predict`, `break`, `checks`). Pages load them one at a time through `scenes/index.ts` (`SCENES`, `loadScene`).
  - `stories/<slug>.ts`: a story as a `StoryDef` (`story.ts`): controls, prices, scene builder, stages with the design each was made for, and the target. `stories/index.ts` loads them. One `StoryPlayer` runs them all.
  - `all.ts` loads every lesson and story at once, for tests, scripts and server pages. Never import it from a client component.
  - `tests/lessons.test.ts` asserts the fix beats the problem on its headline metric (`claimOf` in `walk.ts`; `headlineOf`: `FigureDef.headline.metric`, by default the fix's first metric), firing armed faults at their `at` as a learner's break would.
- `src/lib/lessons/beats.ts`: the beats runtime. `BeatRunner` fires a step's beats in order on a 10 ms grid of simulated time (`stepGrid`), so they fire at the same moments at any speed. Triggers read only the simulation.
  - `src/lib/lessons/walk.ts` walks a lesson as a learner would; the tests use it to prove every beat fires and every prediction holds. `npm run tune -- <slug> --beats` prints the timeline.
- `src/components/beats.tsx`: `useBeats` (the player's runners and Next), the strip, callouts, and the Predict, Check and What-to-watch cards. `follow.tsx`: follow one request. `term.tsx` and `src/lib/glossary.ts`: glossary terms.
- `src/components/lesson-page.tsx`: a lesson page loads its scenes (or story) with `use`, behind the shell as a fallback, and fetches the next stop's code when idle. `player.tsx` and `story-player.tsx` are the two players.
- `src/app/page.tsx`: the home page. `route-map.tsx` draws the catalog as a transit map (lines as rows, levels as zone bands, journeys on the last row, a station's card on hover or focus via `station-preview.tsx`) and, on narrow screens, as a board with a level filter and search. `journeys.tsx`, `read-scene.tsx` (the seven marks) and `home-start.tsx` (the start button and line index) fill the rest.
- `src/components/shell.tsx`: the one-screen layout shared by lessons and stories.
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

- **Lesson shape.** A hook (a question, ≤16 words), a one-line `why`, then a problem figure, then a fix figure (or a pair of trade-off figures), and a Recap with one or two checks and a rule of ≤8 words.
  - Each figure has a `short` tab name of two words at most.
  - Faults pair across figures by action `id`, not position: a fault offered in two steps has the same id and label, and hits both worlds.
  - At most 2 knobs, 4 metrics, and a caption of 25 words or fewer that describes the setup, not the outcome.
  - Plain words; no jargon before the scene shows it.
- **Beats** (`docs/plan-v3.md` §8; `tests/lessons.test.ts` enforces them).
  - Build lines (`parts`): one per part, ≤9 words, label then what it does with a number. The first step's parts are introduced before any traffic runs (unless the scene has a warm-up).
  - 3–6 beats per figure, ≤16 words, verb first, each pointing at one thing (`focus`). Every beat must fire in a learner's run.
  - Numbers in beats are placeholders (`{p95:fix}`, `{util:db:problem}`, `{queue:app}`) filled in as the beat fires; never hard-code a number the scene measures.
  - Terms: `[[key|plain words]]`, defined in `src/lib/glossary.ts`. A term is first used where it is marked, in the beat that names it (`term`); nothing uses it before.
  - One prediction per lesson, before the break, with 2–3 options; the engine must agree with its answer (`holds`).
  - Faults the learner causes are armed (`ScriptEvent.armed`, `kit.ts`'s `armed`/`fault`): they never loop, and `sim.fire` plays them in every world at once. Only the hero and the stories keep looping scripts.
- **The catalog.** Slugs are the identity (URLs, the visited list) and never change; a moved slug keeps the old one in `aliases`, which `next.config.ts` redirects. Codes were assigned once, in level order per line, and are frozen in `tests/catalog.snapshot.json`; a line shows gaps until its planned lessons go live.
  - A live entry's `requires` lists live entries only (the map dims a station until they are visited); add an edge once both ends are live. Every `requires` comes earlier on `PATH`. A story's `requires` are the lessons it rides, in ride order: its stops on the map and its journey card.
  - A new lesson starts with `npm run new-lesson -- <slug>`; the tests fail until it is written, and check that `SCENES`, `STORY_MODULES` and `all.ts` cover exactly the live entries.
- **Fairness.** A problem and its fix (or both sides of a trade-off) share `sloMs`, `timeoutMs`, `timeScale` and `windowMs`, and must produce identical first-attempt arrival traces (`new Sim(spec, { trace: true })`). The fairness test in `tests/lessons.test.ts` checks both. Explore figures change the traffic on purpose and are exempt.
  - A scene whose links lose messages gives every client a timeout and every blocking server a `callTimeoutMs` (or honoured deadlines); the tests check it.
- **Change column.** Only a `problem,fix` lesson gets better/worse verdicts. Explore and trade-off steps show a plain signed difference, and metrics with `better: "neutral"` (servers in use) never get a verdict. Response-time rows show their target.
- **Visual language.** Never reuse a dot colour for a new meaning. The mapping is fixed: cobalt for a request, amber for late, green for answered, violet for stale, slate for turned away, red for failed. Shape carries the state as well as colour.
  - Marks that extend those meanings keep them: a rail glows cobalt with its traffic (red when most of it fails); a waiting line sits on an amber pressure wedge; a replica with a copy in flight shows a violet rule (a read there may be stale); a copy travels as a small hollow muted square.
  - A big answer on a thin link stretches into a bar along its rail (head at the link's latency, tail one transfer time behind). A message lost on its link leaves a red cross where it vanished, not a diamond: nothing answered it.
  - News pushed down an open connection is a small cobalt dot coming to the user; a handshake or heartbeat is a small grey ring, like a health check; a window update is a small hollow green ring (an ack with nothing to acknowledge). A sender told there is no room wears WAIT; after a promotion, the database taking writes wears PRIMARY and an old primary back up wears REPLICA. Requests waiting at their sender (for a connection or window room) stand in rows above it.
  - Things that are not requests take ink, never a dot colour: an evicted cache entry falls as a flat ink chip, and the Travel, Waiting and Working rows of the table carry an ink rule as long as their share of the whole.
  - Rings mark a station changing state (crash, recover, boot, hot, a breaker opening or closing, a replica promoted); a cache's hit or miss gets only a faint one, at most one per cache every 250 ms.
- **Fault buttons.** Each action reads its on/off state from the simulation (`isOn`), so scripted faults and buttons stay in sync.
- **Reduced motion.** Must keep working: no autoplay, a settled still frame, and CSS animations disabled.
- **Motion.** Use ease-out for things entering, linear travel for requests, and no decorative loops. Animate only transform and opacity, except one-time SVG strokes.
  - Durations come from the tokens: `--dur-fast` 120, `--dur-exit` 160, `--dur-base` 240, `--dur-switch` 480 (`src/lib/motion.ts` mirrors them). A step switch is two beats: exits and the glide at 0, entries and new links at `--beat` (120 ms). `tests/browser/motion.spec.ts` checks it.
  - The scene intro is the one longer moment: parts 60 ms apart, 360 ms each, links drawing in 420 ms.
- **Screen fit.** Lesson pages must fit the viewport at 1440×900, 1280×720, a 390×844 phone and an 844×390 landscape phone (the four Playwright projects).
  - `npm run test:browser` asserts that the document doesn't scroll, that the panel's reading part doesn't scroll on any problem or fix step at 1440×900 and 1280×720, and that phones show the headline number without scrolling.
  - `tests/browser/stage-fit.spec.ts` asserts that every stage label is inside the stage, at full size and clear of other labels and rails, that nothing covers a station, and that phone controls are at least 40px square.
  - A longer caption or an extra knob has to fit 1280×720. Shorten the copy rather than letting the panel scroll.
  - Callouts sit on wide stages only, beside what they point at and clear of every station and label; phones carry the beat in the strip. On touch layouts, glossary terms are words in the text and 40px chips in the panel.
- **Out of scope.** No cloud, accounts or backend. Progress is a localStorage list of visited lessons and nothing more; predictions, checks and following a request are component state only.
