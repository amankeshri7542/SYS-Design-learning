# Motion audit and motion system spec

Research report, 2026-10-22. Produced by a motion-design review agent for the v3 plan (`docs/plan-v3.md`). It reads the code as of commit `47c5573` and watched the running app at 1440×900 and 390×844 (DPR 3 emulated, CPU throttled 4×/6×, and under `prefers-reduced-motion: reduce`). Nothing here is implemented yet; the plan decides what ships and when.

Perspective weighting applied (design-motion-principles, educational product with a restrained house style): **Jakub primary** (production polish, one timing system), **Emil for controls** (tabs, knobs, transport: fast, never noticed), **Jhey selectively** for the teaching set-pieces only (drops with gravity, the tracer, the scene build-in). taste-motion's rules (transform/opacity only, one loop class per page, exits snappier than entrances, reduced-motion gate) and animation-performance's rules (composite-only properties, name the cause, never conclude from a fast machine) are applied throughout.

## 0. Summary

What works already: the request layer is the right idea and is well built. Dots travel linearly in sim time along the bezier links, grow out of the client and shrink back into it, show a clock-wipe while in service, line up in front of nodes, turn amber when late, fall off the stage with gravity when dropped. The problem→fix switch glides shared nodes (`node-pos` 0.6 s), scales new ones in with an accent ring and fades links in. Reduced motion is honoured end to end (verified: sim time frozen at 3000 ms, Play label "Play", every animation/transition computes to none/0 s). Performance headroom is large: ~120 dots a frame cost the app's rAF callback 0.9 ms p95 natively and 2.1 ms p95 at 6× CPU throttle, with zero frames over 20 ms in every scene measured.

What stops the motion from teaching on its own:

1. **The effect rings are the loudest thing on stage and carry the least meaning.** Every cache hit, miss, reject, done and timeout fires a 14 px growing ring; at 48 req/s the cache wears two or three concentric rings at once. A red ring at the client for a timeout reads the same as a red ring at a server for a crash. Rings should be reserved for state changes; outcomes belong on the dot.
2. **Nothing shows flow volume or direction except the dots themselves.** Links are uniform 11 px grey whether they carry 2 or 60 req/s, and a benched server's link looks identical to a live one.
3. **State changes cut instead of transitioning.** Breaker badge swaps OPEN/TESTING/CLOSED (and width 46/62/56 px) instantly; servers snap to 0.35 opacity when standby; cache/load meters step at 11 Hz with no tween; nodes that leave on a step switch vanish with no exit; the Back button pops in; `.cut-mark` pops in.
4. **One event, seven clocks.** A tab switch fires canvas fade 260 ms, `step-in` 340 ms, `tag-in` 400 ms, `node-in` 500 ms, `link fade-in` 500 ms, `node-pos` 600 ms and `fresh` 900 ms, with two different easings (`--ease-out` and built-in `ease-out`). It should be one token with two beats.
5. **Scale.** On 1440×900 a single-row scene uses ~30% of the stage height; dots are ~6 px radius, so the shape vocabulary (diamond/square/donut) is barely legible while the 60–90 px rings dominate. On a 390 phone the compact capstone draws dots at ~2.6 px radius and labels collide ("Rate limitLoad balancer").
6. **Lessons whose idea is invisible.** Consistent hashing: keys remapping is the whole lesson and nothing on stage shows a key moving; only the fill bars drift. Replication: copies are small muted dots with no "copy" semantics. Eviction: the engine evicts but emits no effect.

The spec keeps the house rules (ease-out in, linear travel, no decorative loops, transform/opacity only except one-time SVG strokes) and gets "things moving" by making the **requests** and **state transitions** carry the motion, never the nodes idling.

---

## 1. Motion inventory today

Verdicts: **keep** / **tune** / **replace** / **remove**. Line numbers are from the files as read on 2026-10-22.

### 1a. Canvas layer (`src/components/stage.tsx`, draw function L174–398, helpers L599–723)

| # | What | Where | Timing / easing | Trigger | Verdict |
|---|---|---|---|---|---|
| C1 | Step-switch fade: all dots alpha 0→1 | L185, L228, L343 | 260 ms, linear | `sim` identity changes (tab switch) | **tune**: use `--dur-switch`-family token (240 ms) |
| C2 | Queue/slot/park position smoothing | L233–240 `ease = 1-exp(-dt/70)` | exponential lerp, τ = 70 ms | every frame, non-travelling dots | **tune**: τ 70→110 ms so a queue advancing is perceptible; reduced motion snaps (correct) |
| C3 | Travel along link | L314–327 | linear in sim time along cubic bezier; 4 px perpendicular lane, opposite side on return | `phase === "travel"` | **keep** (the core rule done right) |
| C4 | Grow out of / shrink into client | L335–342 | first/last 18 % of travel, 0.45→1 and 1→0.4 size, linear | travel from/to a client | **keep** |
| C5 | Clock-wipe while in service | L346–354 | pie full→empty over service time; 30 % ghost disc behind | `phase === "work"` | **keep** |
| C6 | Held-slot hollow rings | L283–286, L300–306 | static; amber when late | server waiting on downstream | **keep** |
| C7 | Overflow "+N" text | L362–371 | static text | queue beyond `MAX_QUEUE_DRAWN` | **keep** (watch `fillText` cost, §4) |
| C8 | Effect ingest + throttle | L373–393 | ≤1 fx per node:kind per 70 ms real; list capped 90→60 | `sim.fx` | **tune**: throttle per node (not node:kind) at 250 ms, priority state-change > outcome |
| C9 | Small rings: hit, miss, reject, done, timeout | L684–723, `FX_LIFE` default 480 ms | radius +14 px, cubic ease-out `1-(1-u)^3`, alpha 0.55→0, 2 px | each outcome event | **replace**: move outcome onto the dot (§2.5); keep at most one faint ring per node per 250 ms as a secondary cue |
| C10 | Big rings: crash, recover, open, close, boot | same, 900–1100 ms | radius +34 px, 3 px, alpha 0.8→0 | state change | **keep**; add a second visual channel so kinds differ in shape, not just colour (§2.3, §2.7) |
| C11 | Drop: red diamond falls with gravity and spins | L699–712 | 900 ms physics (vy −70…−110, g 700, 6 rad/s), alpha 1→0 | queue full / refused | **keep** (teaches "dropped" at a glance; the one Jhey moment) |
| C12 | Reduced motion in canvas | L228, L237, L335, L346, L699, L714 | fade=1, no lerp, no grow/shrink, no wipe, no gravity, rings do not grow | `reduced` | **keep** (verified) |

Not animated today in the canvas: trails, link flow, tracer, eviction, replication semantics.

### 1b. SVG stage layer (`stage.tsx` L412–597 + `globals.css`)

| # | What | Where | Timing / easing | Trigger | Verdict |
|---|---|---|---|---|---|
| S1 | Node glide between steps | `.node-pos` css L1527; inline `style.transform` stage.tsx L482 | transform 600 ms `--ease-out` | layout position differs between steps | **tune**: 480 ms shared token; the one long beat of the switch |
| S2 | Node entrance | `.node` + `@keyframes node-in` css L1533–1541 | 500 ms `--ease-out`, opacity 0→1, scale 0.9→1, `transform-box: fill-box` | every `.node` mount, incl. initial scene and any `StageSvg` remount (`key={m}` on mode change) | **tune**: stagger along the flow for the first mount (§2.10); never replay on mode change |
| S3 | Fresh accent ring | `.fresh-ring` css L1549–1562; `fresh()` stage.tsx L428–438, L484 | 900 ms, opacity 0.9→0, scale 0.92→1.18 | node mounted >500 ms after the SVG mounted | **tune**: 480 ms; under reduced motion the element still mounts and shows as a static ring until the next re-render; skip when `reduced` |
| S4 | Link fade-in | `.link-g` css L1481–1488 | 500 ms built-in `ease-out`, opacity | link mount (new node, or a server that boots, since links with `!A.on` return null) | **tune**: 240 ms, `--ease-out` token; add a one-time stroke draw for the intro (§2.10) |
| S5 | Node body colour | `.node .body` css L1568 | stroke/fill 250 ms | class change hot/down/benched/booting | **keep** |
| S6 | Node opacity states | `.node.draining {opacity:.6}` L1680, `.node.off {opacity:.35}` L1684 | none (snap) | autoscaler drains / standby | **tune**: add `transition: opacity 300ms` on `.node` (motion gap) |
| S7 | Dash patterns for down/benched/booting/off | css L1670–1690 | none (snap) | class change | **keep** (dasharray is not animatable without a loop; S5 covers it) |
| S8 | Badge DOWN / OPEN / TESTING / CLOSED / CUT OFF | stage.tsx L495–502, L590–595; css L1700–1716 | none; text and width (44/46/56/62) swap instantly | state change | **replace** with a three-state pill and sliding marker (§2.7) |
| S9 | Meters: cache fill, server load | stage.tsx L518–542 (`width` attribute) | none; steps at the 11 Hz tick | every tick | **tune**: `transform: scaleX()` with `transform-origin: left; transform-box: fill-box; transition: transform 120ms linear` (as `.hold-bar` already does) |
| S10 | Partition cut mark + link style | stage.tsx L449–461; css L1503–1520 | none (pop) | `sim.partitioned` | **tune**: in 200 ms, out 140 ms |
| S11 | Node sub-label text swaps | stage.tsx L490–494 | none | every tick | **keep** (text; do not animate) |
| S12 | Exiting nodes on step switch | none exists; `spec.nodes.map` L472 | — | node absent from new step | **replace** (motion gap): mount the union, mark absentees `.leaving` (§2.11) |

### 1c. Player chrome (`player.tsx`, `live.tsx`, `globals.css`)

| # | What | Where | Timing / easing | Trigger | Verdict |
|---|---|---|---|---|---|
| P1 | Step panel entrance | `.step` key={step} player.tsx L194; css L1177–1186 `step-in` | 340 ms `--ease-out`, opacity, translateY 8 px, **blur 3 px** | every tab switch, incl. ← → keys | **tune**: 220 ms, translateY 6 px, blur ≤2 px or none (text-bearing entrance; third concurrent entrance on one event) |
| P2 | Stage tag entrance | `.stage-tag` key={fig.short} player.tsx L166; css L1466–1475 `tag-in` | 400 ms, opacity, translateY 6 px | tab switch | **tune**: share the 240 ms token |
| P3 | Scripted note toast | `.note` css L1731–1753, L2042 | enter opacity 250 ms + transform 350 ms `--ease-out`; exit identical | `freshNote()` live.tsx L124–128 (3.2 s window) | **tune**: exit 160 ms (exits subtler than entries) |
| P4 | Tabs | `.tab` css L1134 (bg/color/box-shadow 200 ms, transform 120 ms), `:active scale(.97)` L280, `.tab-n` L1162 | 120–200 ms | click/key | **keep** |
| P5 | Buttons | `.btn` L270, `.btn-primary` L344, `:active scale(.97)` L277–281 | 120–150 ms | hover/press | **keep** |
| P6 | Segmented radios | `.seg span` L415 | bg/color/box-shadow 180 ms | change | **keep** (box-shadow is paint-only but tiny) |
| P7 | Dock progress dots | `.dock-progress i` L1063–1073 | bg + transform 250 ms, `.on scale(1.3)` | step change | **keep** |
| P8 | Back button | player.tsx L246–251 `{step > 0 && …}` | none (pops) | step>0 | **tune**: 160 ms fade/translateX entrance |
| P9 | Compare table | `.compare td.num` L1338 (opacity 250 ms, color 300 ms), `thead th` L1307 | 200–300 ms | active column / tone | **keep** |
| P10 | Number smoothing | `useSmoothed` live.tsx L174–187 | lerp 0.35 per 90 ms tick (≈270 ms to 90 %) | every tick | **keep**; add a change cue (§2.13). It mutates a ref during render; move to an effect if StrictMode ever doubles it |
| P11 | Sparklines | `Spark` live.tsx L307–316 | none | history push every 50 sim-ms | **keep** |
| P12 | Transport Play/Pause/Step/Restart | live.tsx L132–171 | icon swap instant; `step()` runs 700 ms real | click/Space/K | **keep** (high-frequency control) |
| P13 | Key popover | `.key-pop` L651 `pop-in` 220 ms, origin top right | opacity + translateY(−4) + scale(.97) | `<details>` open | **keep** |
| P14 | Capstone toggle | `.toggle-ui` L1855, `::after` L1868 | bg 200 ms, transform 250 ms | change | **keep** |
| P15 | Capstone hold bar | `.hold-bar` L1944–1949 | transform scaleX 200 ms linear | tick | **keep** (model for S9) |
| P16 | Route map station hover (home) | `.station-dot` L729–739 | `transition: r 0.2s` (animates SVG geometry) | hover/focus | **tune**: `transform: scale(1.27)` with `transform-box: fill-box; transform-origin: center` |
| P17 | Bar stops | `.bar-stops a` L960 | bg/color 180 ms | hover | **keep** |
| P18 | Reduced-motion gate | css L2124–2134; `useReducedMotion` hooks.ts L29; no autoplay live.tsx L52–55 (warm 2600 ms still) | kills all animation/transition; sim opens settled | media query | **keep** (verified) |

AI-slop gate (anti-checklist): no pulsing/breathing loops, no hover-scale sprawl, no blur-everywhere (one blur, P1), no stagger spam, no springs on utility actions. The only loop class on a page is the simulation, which is the content. Flagged in slop terms only: **timing drift** (seven durations for one event) and **motion gaps** (S6, S8, S12, P8, S10).

---

## 2. What is missing for motion that teaches

Each item: learns → look → timing/easing → implementation here → reduced-motion fallback. Effort in §5.

### 2.1 Request trails (direction and speed at a glance)
- **Learns:** which way traffic flows on each link and how fast; long trail = fast link. Return traffic reads as a second stream on the far side of the link.
- **Look:** behind every travelling dot, one stroke from its position 90 sim-ms ago to now, same colour at 28 % alpha, 2.2 px, round caps. Late dots keep an amber tail, so a slow link glows amber.
- **Timing:** fixed sim-time window, so at 2× speed tails lengthen (correct).
- **Implementation:** canvas, travel branch (stage.tsx L314–327): evaluate `bezier(e.c, t − Δ)` with `Δ = window/(r.t1−r.t0)`, `moveTo/lineTo/stroke` before the dot. No buffers; one extra stroke per travelling dot; batch by colour (§4).
- **Reduced motion:** no tails.

### 2.2 Link flow proportional to traffic
- **Learns:** where the load is; a benched server's link goes quiet; after the breaker opens the link to Payments empties.
- **Look:** a second path over each `.link` (`.link-flow`), same geometry, 11 px, request cobalt at `opacity = clamp(rate/sceneMax, 0, .22)`; tints toward `--dot-err` when the recent error share > 30 %. Width never changes.
- **Timing:** EWMA over ~400 sim-ms; opacity set at the 11 Hz tick with `transition: opacity 300ms linear`.
- **Implementation:** SVG in `StageSvg` links map (stage.tsx L441–470). Data exists: `NodeRt.out: Map<string, number>` and `arrivals: Win` (engine.ts L104–105, L116); add `flowOf(sim, a, b)` in `metrics.ts`. Opacity is composite-only.
- **Reduced motion:** static opacity from the settled frame.

### 2.3 Node micro-states (busy, hot, crash, boot, drain, benched)
No breathing (house rule). State is shown by one-time transitions plus the meter and sockets, which already move with the work.

| State | Today | Spec |
|---|---|---|
| busy | sockets wipe; meter steps | meter tweens (`scaleX`, 120 ms linear); nothing else |
| hot (queue > 2×slots) | amber 3 px stroke (250 ms) | plus **one** 480 ms amber ring on *entering* the state, not every tick |
| crash | big red ring 1100 ms; dashed red body; DOWN badge pops | keep ring; body one-time `translateY(2px)` drop+settle 240 ms; badge enters 160 ms scale .9→1; link-flow → 0 |
| recover | big green ring | keep; body colour 250 ms; benched dash stays until first probe passes (exists) |
| boot | dashed cobalt body; blue ring | plus body enters from `scale(.94)` + opacity over 480 ms; link draws in (§2.10) |
| drain | opacity .6 snap | `transition: opacity 300ms`; sockets empty as work finishes (exists) |
| benched / standby | amber dash / opacity .35 snap | `transition: opacity 300ms`; link-flow 0 |

- **Implementation:** CSS on `.node`; one keyframe `node-drop`; canvas ring on *state entry* (detect `cls` change per node in the draw loop); stage.tsx L483 class string already distinguishes states.
- **Reduced motion:** colour/dash changes only.

### 2.4 Queue pressure
- **Learns:** a queue is pressure building against a node; dropping is overflow.
- **Look:** (a) spacing 12 px for ≤6 waiting, 10 px ≤12, 8.5 px beyond, so a long line reads compressed; (b) a warm wedge behind the queue area (canvas, `--dot-slow` at 6–10 % alpha ∝ `queueLen/queueMax`); (c) dots slide forward with τ 110 ms (C2) so the shuffle is visible; (d) drop diamonds (C11) originate from the queue tail, not the node centre.
- **Implementation:** canvas; `queueSpot()` (L599–616) spacing by `n.queue.length`; wedge in the per-node loop (L267–298) before dots; `NodeSpec.queueMax` is known. Drop origin: `Fx` carries only `node` (types.ts L130–134); add optional `slot?: number` when emitting `drop` in the engine's refuse path.
- **Reduced motion:** wedge static; no sliding; diamonds vanish without falling (as today).

### 2.5 Cache hit / miss / eviction
- **Learns:** hit = short trip; miss = long trip that *fills* the cache; the cache is finite so filling pushes something out.
- **Look:** **Hit:** dot pauses for its wipe and leaves green; 120 ms `scale 1→1.35→1` pop at the cache (keyed on `r.hit` and `dir` flipping). No ring. **Miss:** dot passes through; on the way back, when the entry is written, a **small cobalt square** slides from the dot into the cache bar (240 ms ease-out) and the bar tweens up (S9). **Evict:** a **slate square** drops out of the cache's bottom edge with gravity (reuse C11, 700 ms, no spin). Hit/miss rings removed; the per-node ring budget may keep a faint secondary ring.
- **Implementation:** canvas for pop/copy/evict; SVG for the bar. Engine: add `"evict" | "fill"` to `FxKind` (types.ts L117–128), emit in `evict()` (engine.ts L1025) and in the cache write path (~L1010–1020). `styleOf()` (L627–646) already knows `r.hit`/`r.dir`.
- **Reduced motion:** no pop/slide; bar instant; evict square shown static 400 ms.

### 2.6 Replication copies
- **Learns:** writes land on the primary; copies travel later (lag); a read that beats the copy is stale (violet donut).
- **Look:** `op === "repl"` dots become small hollow squares on the dashed sync link with a short trail; the write dot pops 120 ms at the primary when it spawns a copy; the replica shows a thin violet underline while any copy is in flight to it, fading 200 ms when the last one lands. No lag loop.
- **Implementation:** canvas (`styleOf` L629 → `square`, `small: true`, stroke style); underline in `meter()` (L518–542) from in-flight repl count by `to`.
- **Reduced motion:** shapes and underline only.

### 2.7 Breaker: closed → open → half-open → closed
- **Learns:** the breaker is a state machine on the caller; open = fail fast; half-open = one trial; close = traffic resumes.
- **Look:** replace the text badge with a fixed-width **three-segment pill** (`closed · testing · open`, 18 px) with a filled marker sliding between segments (`translateX`, 220 ms `--ease-out`) and pill colour fading (250 ms). **Open:** a `cut-mark`-style break scales in (200 ms) on the server→dependency link and link-flow goes to zero; the first rejected grey squares pop 120 ms at the server. **Testing:** the trial request is drawn as the tracer (§2.9) for its whole trip. **Close:** break fades 140 ms.
- **Implementation:** SVG pill replacing stage.tsx L495–502 for breaker nodes (`describe()` L591–594 yields state); expose the trial request id as `NodeRt.breaker.trialId` (engine.ts L888, one line).
- **Reduced motion:** marker jumps; colours instant; break appears without scale.

### 2.8 Spotlight / focus
- **Learns:** what the caption is talking about ("a hit answers right away" lights the cache, not the scene).
- **Look:** `.node` not in focus → 45 % opacity, links not touching a focus node → 50 %, dots not at/heading to a focus node → 40 % alpha. Held while the caption is on screen; cleared on stage hover. Nothing moves; only emphasis.
- **Timing:** 300 ms linear in, 200 ms out.
- **Implementation:** `focus?: string[]` on `FigureDef` (lessons/types.ts L36–45); `Stage` sets `data-focus`; CSS `.stage[data-focus] .node:not(.focus) { opacity: .45; transition: opacity 300ms }`; canvas reads a focus set from `live.current`. Optional one line per figure in `src/lib/lessons/*.ts`.
- **Reduced motion:** same (opacity only).

### 2.9 Follow one request (tracer)
- **Learns:** the life of a single request: out through the stack, into a queue, served, back.
- **Look:** a "Follow one" toggle in the dock. Every ~3 s the next request born at a client becomes the tracer: 1.6× size, 2 px halo, all other dots dimmed to 35 %, its path so far drawn as a dashed stroke that fades 600 ms after it finishes, a mono label "212 ms · waiting at Database". Speed is **not** changed (determinism); the toggle suggests 0.5× once.
- **Timing:** halo in 160 ms ease-out; path drawn as it travels; fade-out 600 ms linear.
- **Implementation:** canvas only. `st.current` gets `{ tracerId, pathPts, nextPickAt }`; pick the first `r` with `r.dir===1 && atClient(r.from) && prog<0.05` after `nextPickAt`; append the bezier sample each frame. `Req` already has `first`, `at`, `from`, `to`, `phase` (engine.ts L22–57). A `tracer` flag in `useLiveSims` and a dock button in `player.tsx`.
- **Reduced motion:** tracer still highlights; the path is drawn in full for the settled frame when stepping (the best reduced-motion teaching device on the stage).

### 2.10 Scene intro: build in along the flow
- **Learns:** the architecture reads left→right (top→bottom on phones) in request order.
- **Look:** on first mount, nodes enter by `at[0]` in 60 ms steps (opacity 0→1, `scale .94→1`, 360 ms `--ease-out`); each link draws upstream→downstream with a **one-time SVG stroke** (`stroke-dasharray: L; stroke-dashoffset: L→0`, 420 ms, starting 120 ms after its upstream node). Requests appear after the last node lands (≤ 900 ms). The one staggered moment per page.
- **Implementation:** per node `style={{'--i': rank}}` (rank of its `at[0]` among distinct along-values, computable in `layoutFor`), `animation-delay: calc(var(--i) * 60ms)` on `.node` only while `.stage[data-intro]` is set for the first 1 s; links: `getTotalLength()` once per path ref, inline dasharray/offset, class `.draw`. Canvas holds at `fade` 0 until `holdUntil`. Keep the intro flag in `Stage` state so a mode change (`StageSvg key={m}`) does not replay it.
- **Reduced motion:** no intro (current behaviour).

### 2.11 Problem → fix topology morph (complete it)
- **Learns:** the fix is the same system plus one part; parts no longer needed leave.
- **Look:** keep the glide (S1) and accent ring (S3). Add **exits**: absent nodes shrink to `scale(.96)` and fade 180 ms, then unmount; their links fade 180 ms. New links fade in 120 ms after the glide starts. Canvas fade becomes 240 ms starting 60 ms after the switch so the first frame is not a blank stage.
- **Timing:** `--dur-switch: 480ms` glide; entries 240; exits 180; ring 480. Two beats: exits + glide start; entries at +120 ms.
- **Implementation:** `StageSvg` renders the union `combinedFrame` already builds (player.tsx L23–29) and marks ids not in `spec.nodes` `.leaving` (`pointer-events:none`, `aria-hidden`), unmounting after 200 ms via a small `useLeaving(ids)` hook. Canvas: `s.switchAt` delay.
- **Reduced motion:** instant (as today).

### 2.12 Lesson-to-lesson continuity
- **Learns:** the next station builds on this one (F3 → F4 keeps balancer and servers).
- **Look:** on "Next stop" the stage fades 160 ms; the next lesson's intro (§2.10) **skips** nodes whose glyph+label match the previous lesson, so only new parts build in.
- **Implementation:** Option A (no flags): store `{glyph,label}` of the last stage in `sessionStorage` on unmount; `.theatre[data-leaving]` class on link click with a 160 ms delay before `router.push`. Option B: React 19.2 `<ViewTransition>` + Next 16 `experimental.viewTransition` for a true shared-element move; spike only after A ships.
- **Reduced motion:** no fade; same skip logic.

### 2.13 Metric number transitions
- **Learns:** which number moved and which way when a fault or knob changes the world.
- **Look:** keep smoothing (P10). Add a change cue: when a cell's formatted value changes by more than one unit the cell colour flashes to full tone for 120 ms and relaxes over 300 ms (transition exists); the Δ arrow does a `translateY(2px)→0` (160 ms) when its sign flips. Keep `font-variant-numeric: tabular-nums` explicit on `.num`.
- **Implementation:** classes toggled from `Compare` (live.tsx L235–291) with a ref of previous formatted values; `.delta.flip` keyframe (transform/opacity).
- **Reduced motion:** colour only.

### 2.14 Legibility of the dot vocabulary (prerequisite)
The shape encoding is the backbone of "understand by watching" and is under-sized. Raise `R` (stage.tsx L232) from `5.2 × max(.85, scale)` to `6.4 × max(.9, scale)`, allow `zoom` (L149–154) up to 1.45 for ≤2-lane scenes, floor 4.2 px in compact/tall. Rings shrink (14 → 9 px growth) once outcomes move onto the dot. The stage will feel busier with no extra motion, which is what the owner asked for.

---

## 3. Motion tokens

```css
:root {
  --dur-fast:   120ms;  /* hover, press, focus ring, number flash */
  --dur-base:   240ms;  /* enter: tags, links, badges, Back button, panel step */
  --dur-exit:   160ms;  /* leave: notes, exiting nodes, cut marks, tracer path */
  --dur-switch: 480ms;  /* one beat: node glide, fresh ring, boot entrance, breaker ring */
  --dur-hero:   900ms;  /* ceiling: scene intro incl. stagger, drop physics */
  --ease-out:   cubic-bezier(0.22, 1, 0.36, 1);  /* entering, settling (exists) */
  --ease-exit:  cubic-bezier(0.4, 0, 1, 1);      /* leaving */
  --ease-linear: linear;                         /* travel, meters, flow opacity, smoothing */
}
```

```ts
// src/lib/motion.ts
export const DUR = { fast: 120, base: 240, exit: 160, switch: 480, hero: 900 } as const;
export const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);        // matches today's canvas rings
export const easeOutQuint = (u: number) => 1 - Math.pow(1 - u, 5);   // ≈ cubic-bezier(.22,1,.36,1)
export const easeIn = (u: number) => u * u * u;                        // exits
export const smooth = (prev: number, target: number, dt: number, tau: number) =>
  prev + (target - prev) * (1 - Math.exp(-dt / tau));                  // frame-rate independent lerp
export const TAU = { queue: 110, flow: 160, pressure: 110 } as const; // ms
export const INTRO = { step: 60, node: 360, stroke: 420 } as const;    // ms
```

| Situation | Duration | Easing | Properties |
|---|---|---|---|
| Hover / press / focus / number flash | `--dur-fast` | `--ease-out` | transform, opacity, colour |
| Something enters (tag, badge, link, Back, panel text) | `--dur-base` | `--ease-out` | opacity + ≤8 px translate or scale ≥ .94 |
| Something leaves (note, node, cut mark) | `--dur-exit` | `--ease-exit` | opacity + ≤4 px translate or scale .96 |
| A world changes shape (step switch, boot, breaker trip) | `--dur-switch` | `--ease-out` | transform (glide), fresh ring, state ring |
| Scene intro | ≤ `--dur-hero` total | `--ease-out`, one-time SVG stroke | opacity, transform, dashoffset |
| Request travel, meters, flow glow, smoothing | continuous | linear / `smooth()` | canvas; `scaleX`; opacity |
| Drop physics | ≤ `--dur-hero` | gravity (as today) | canvas |

Rules kept: ease-out in, linear travel, no decorative loops (the simulation is the only loop), transform/opacity only except the one-time SVG stroke draw. No `transition: all` (none today). New canvas work reads `reduced` and takes the still-frame branch.

---

## 4. Performance plan

### Budget
Mid-range phone (Pixel 6a / iPhone 11 class; many Androids at 90–120 Hz → plan for **8–11 ms**). Per frame: `sim.step` ≤ 2 ms, canvas ≤ 3 ms (incl. trails/flow), React SVG commit (11 Hz) ≤ 6 ms *when it runs*. Never more than one `setState` per 90 ms from the loop (true today, live.tsx L79–82).

### Measured (this Mac, Chromium via Playwright; needs a device recording to confirm)

| Scene | Speed | SVG elements | Canvas fills/frame | rAF callback p50 / p95 / max (ms) | Frames > 20 ms |
|---|---|---|---|---|---|
| Home hero | 1× | 114 | ~3 | – | 0 |
| Capstone, 4 servers + cache + limiter | 1× | 145 | ~9 | – | 0 (also at 4× and 6× CPU throttle) |
| Retries (storm) | 2× | 25–32 | 53–61 | 0.20 / 0.50 / 2.4 native; 0.60 / 2.2 / 3.1 at 6× | 0 |
| Cache stampede | 2× | 70 | 38–55 | 0.20 / 0.60 / 1.1; 0.20 / 1.9 / 2.4 at 6× | 0 |
| Rate limiting (~120 dots) | 2× | 43 | 104–131 | 0.30 / 0.90 / 1.5; 0.30 / 2.1 / 2.8 at 6× | 0 |
| Rate limiting, 390×844 @ DPR 3 (capped 2) | 0.5× | 43 | 104–113 | 0.20 / 0.60 / 1.3; 0.40 / 1.8 / 2.7 at 6× | 0 |

No long tasks (>50 ms) in any run. Canvas backing on the DPR-3 phone: 744×710 for a 372×355 CSS canvas, so the `Math.min(2, dpr)` cap (stage.tsx L212) works. The rAF number is `sim.step + draw`; the React commit from `setTick` runs in a separate task and was not individually timed (no long task ⇒ under 50 ms; true cost needs the Profiler or a device trace).

### Canvas draw cost with 100+ dots
Today: 2 path ops per dot (`arc`+`fill`), `globalAlpha`/`fillStyle` per dot, `roundRect` per square, `save/translate/rotate/restore` per falling diamond, `fillText` per overflow label every frame. ~250 state changes a frame at 120 dots ≈ 1 ms here, ≈ 3–5 ms on a mid phone; trails (+1 stroke/dot) and the wedge push toward the 3 ms budget. Keep under it by: (1) **batch by style** — bucket `(colour, alpha, shape)`, one `beginPath`, N `arc`s with `moveTo`, one `fill` (seven fills instead of ~120; same for trails); (2) no per-dot `save/restore` (compute diamond vertices); (3) `fillText` only when the `+N` string changed (cache or SVG `<text>` at 11 Hz); (4) precompute a 64-point sample table per link instead of two cubic evaluations per dot (L320–321); (5) cull off-canvas positions; (6) `MAX_QUEUE_DRAWN` stays; trails only for travelling dots; (7) keep `clearRect` + redraw, no layered canvases.

### SVG re-render cadence
The whole `StageSvg` tree reconciles every 90 ms even when nothing visible changed (145 elements in the capstone; two trees before `box` is measured, L400/L404). In payoff order: (1) **tick only on change** — compute a cheap signature in the rAF loop (per node: `cls`, `sub`, badge, meter bucket at 2 %, cache size; `sim.partitioned`) and `setTick` only when it differs; (2) `React.memo` a `NodeView` keyed by that tuple, `LinkView` by `{cut, flowBucket}`; (3) quantise meters (2 % buckets; the 120 ms `scaleX` transition hides steps); (4) render one SVG before measuring (pick by `useMode()` guess).

### DPR cap, offscreen, batching, layout thrash
- **DPR:** keep 2. Adaptive step: if rolling p95 of the app's rAF callback > 8 ms for 2 s, drop to 1.5 (re-run L215–218), restore after 10 s of headroom; measure before enabling by default.
- **Offscreen:** `useVisible` (IO, 120 px margin) and `document.hidden` already stop stepping. Also **cancel the rAF** when not visible/hidden and re-request on `visibilitychange`/intersection (battery; no 60 Hz wakeups on the home page while the hero is scrolled away).
- **Batching:** knob `onChange` fires per input event (60–120 Hz while dragging) → `setValues` → `buildSteps` → `combinedFrame` → `layoutFor`×3 → `reconfigure`. Throttle to one update per frame in `KnobControl` (player.tsx L299–327), keep the slider value local.
- **Layout thrash:** the draw function reads `canvas.clientWidth/clientHeight` every frame (L213–214), forcing layout when the 11 Hz commit dirtied style. Use the `box` from `ResizeObserver` via `live.current`. `getComputedStyle(wrap)` once a second for the palette is fine.
- **No CSS-variable animation** anywhere; keep it so for the intro (`--i` only sets `animation-delay`).
- **`will-change`:** none needed; add `will-change: transform` to `.node-pos` only if a 1 px shift is seen at glide start on a device.

### What to measure, and how
1. **In-app (dev, `?perf=1`):** `performance.mark/measure` around `sim.step` and `draw`; `<Profiler onRender>` around `StageSvg` (works in prod builds). Overlay with p50/p95 over 2 s, dots on screen, SVG element count.
2. **Playwright browser test** (`tests/browser`): on `/learn/rate-limiting` at 2× and `/learn/capstone` built out, wrap `requestAnimationFrame` and assert over 10 s: rAF gap p95 ≤ 17 ms, zero gaps > 34 ms, app callback p95 ≤ 4 ms under `Emulation.setCPUThrottlingRate 4`; run in the mobile project too (DPR 3).
3. **Trace:** `page.context().newCDPSession(page)` → `Tracing.start({ categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame' })` for 10 s; count `DroppedFrame`/long `RunTask`; keep the JSON as a CI artefact. (`context.tracing` does not capture frames.)
4. **Real device:** Chrome remote debugging on a mid-range Android, Safari Web Inspector on an iPhone 11/SE: 10 s Performance capture of rate-limiting at 2× with the tracer on; look at the 11 Hz commit and the paint cost of the `paint-order: stroke` label halos (4 px stroke on every label, paint-tier on every commit).
5. **Regression guard:** Playwright check that under `reducedMotion: 'reduce'` `data-sim-time` is unchanged after 1 s and `.btn-play[aria-label="Play"]` exists (both verified manually here).

---

## 5. Implementation notes per file

Ordered by teaching payoff per effort. S ≈ half a day, M ≈ 1–2 days, L ≈ 3+ days.

### Phase 1: one clock, no cuts (S/M, first)
- **`src/app/globals.css`** (S): token block (§3); retime P1 (220 ms, blur ≤2 px), P2/S4 to `--dur-base` + `--ease-out`, S1 and S3 to `--dur-switch`, P3 exit `--dur-exit`; `.node { transition: opacity var(--dur-base) linear }` (S6); `.badge` enter keyframe (160 ms, scale .9→1); `.cut-mark` enter/exit; `.btn-back` enter; `.station-dot` hover via transform (P16); `.meter .fill { transform-origin:left; transform-box:fill-box; transition: transform 120ms linear }`.
- **`src/components/stage.tsx`** (S): meters via `scaleX` (L526, L537); skip `.fresh-ring` when `reduced` (L484); C1 to 240 ms with a 60 ms hold; C2 τ 110 ms; read `box` instead of `clientWidth` (L213); bump `R` and zoom ceiling (§2.14).
- **`src/lib/motion.ts`** (S, new): tokens, easings, `smooth()`, `TAU`, `INTRO`.

### Phase 2: outcomes on the dot, rings for states (M)
- **`src/lib/sim/types.ts`** (S): `FxKind` += `"evict" | "fill" | "hot"`; optional `Fx.slot?: number`.
- **`src/lib/sim/engine.ts`** (S): emit `evict` in `evict()` (L1025), `fill` where the cache entry is written (~L1012–1020), `hot` on entering the hot condition, queue index on `drop`; `breaker.trialId` (L888). Additive; determinism unaffected (fx is output only). Add engine tests for the new kinds.
- **`src/components/stage.tsx`** (M): per-node ring budget (C8); remove outcome rings (C9); hit pop; copy-square slide into the cache bar; evict square with gravity; queue spacing + pressure wedge (§2.4); repl → small hollow square (§2.6); batched/bucketed draws (§4).
- **`src/components/glyph.tsx`** (S): optional `state` prop so the body can host the breaker pill and the replica "behind" underline; export `pillSpots()` alongside `slotSpots()`.

### Phase 3: flow, trails, tracer (M)
- **`src/components/stage.tsx`** (M): trails (§2.1); `.link-flow` overlay in `StageSvg` (§2.2); tracer state + drawing (§2.9); focus dimming of dots (§2.8).
- **`src/lib/sim/metrics.ts`** (S): `flowOf(sim, a, b)` EWMA of per-link rate and error share from `NodeRt.out`/`arrivals`.
- **`src/components/live.tsx`** (S): `tracer` toggle in `useLiveSims`; "Follow one" button in `Transport` (icon-only when compact).
- **`src/components/player.tsx`** (S): pass `focus` to `Stage` as `data-focus`; dock button.
- **`src/lib/lessons/types.ts` + `src/lib/lessons/*.ts`** (S each, optional): `focus?: string[]` per figure.

### Phase 4: choreography of change (M)
- **`src/components/stage.tsx`** (M): intro build-in with `--i` delays + one-time link stroke (§2.10), no replay on mode change; union render with `.leaving` exits (§2.11); breaker three-state pill replacing the badge (§2.7); crash body-drop class.
- **`src/app/globals.css`** (S): `node-intro`, `link-draw`, `node-leave`, `node-drop`, `.pill` marker transition.
- **`src/components/live.tsx`** (S): metric change cues in `Compare`/`Delta` (§2.13).

### Phase 5: continuity and guards (M/L)
- **`player.tsx` / `stage.tsx`** (M): lesson-to-lesson cross-fade + intro skip for shared nodes (§2.12 option A); View Transitions spike (L, optional).
- **`live.tsx`** (S): cancel rAF when hidden; tick-on-change signature; knob throttle in `KnobControl`.
- **`stage.tsx`** (S): `React.memo` `NodeView`/`LinkView`; single SVG before measure; adaptive DPR behind a flag.
- **`tests/browser`** (S): frame-budget test and reduced-motion test (§4).

### Keep exactly as is
Linear travel in sim time (C3); grow/shrink at the client (C4); clock-wipe (C5); held rings (C6); gravity drop (C11); the reduced-motion gate (P18) and warmed still frame; tab/button/transport timings (P4, P5, P12); number smoothing (P10); the single `--ease-out` curve as the entrance easing.
