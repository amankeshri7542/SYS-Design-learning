<!-- Research report, 2026-10-22. Produced by a design review agent for the v3 plan (docs/plan-v3.md). Audit done against commit 47c5573. SHOTS/ refers to screenshots in the planning session scratchpad, not in the repo. Nothing here is implemented yet; the plan decides what ships and when. -->

# System Lab — design audit and redesign direction

Repo: `/Users/mackie/Codes /Tester_Ai/system-lab` (no files modified). Dev server: http://localhost:3100.
Screenshots: `/private/tmp/claude-501/-Users-mackie-Codes--Tester-Ai-system-lab/fd692202-855c-4c34-88dc-c966933ecc45/scratchpad/shots-design/` (referred to below as `SHOTS/`).

**Method.** Read `CLAUDE.md`, `README.md`, `docs/plan.md`, `globals.css`, `player.tsx`, `stage.tsx`, `route-map.tsx`, `page.tsx`, `hero.tsx`, `legend.tsx`, plus `layout.ts`, `live.tsx`, `glyph.tsx`, `brand.tsx`, `lessons/types.ts`. Applied the `impeccable` critique/audit checklists (Operate+Read mode for lessons, Persuade for home), `taste-design-review` (capture → 8-second read → taste pass → Nielsen pass → a11y pass → ranked findings → one-change verdict) and `redesign-existing-projects` (typography/colour/layout/state audit). Captured home at 1440×900, 1280×720, 390×844; six lessons at 1440×900, 1280×720, 390×844, 844×390 with Problem/Fix/Recap, a knob and a fault; capstone at desktop and phone; dark mode via Playwright `emulateMedia` (home, caching, consistency-vs-availability, message-queues, capstone, 404); reduced motion via `emulateMedia({reducedMotion})`. Then ran automated sweeps over **all 18 lessons × both steps** at 390×844, 844×390, 1440×900 and 1280×720 measuring label clipping, label collisions, rendered label size, layout mode, stage fill, panel overflow and touch targets, and computed WCAG contrast for every token pair in `globals.css:3-75` (`scratchpad/contrast.py`). Per the critique skill's rules this was a single-context run (one agent, no detector hook); findings below are verified against screenshots, not inferred from code alone. (Impeccable note to relay once: a newer Impeccable v4.7.0 is available; `npx impeccable update` in a later session if wanted.)

---

## 1. What already works (keep)

1. **The one-screen shell is real and holds.** `grid-template-areas "bar bar / theatre panel / dock dock"` with `100svh` and `overflow: hidden` (`globals.css:891-905`). Verified `docScrollY = 0` on all 18 lessons × 2 steps × 4 viewports. Only `.panel` scrolls (`globals.css:1022-1035`). This is the hard part and it is done.
2. **The transit identity is a genuine idea, not a theme.** Coloured lines, roundels, station codes, the terminal pill (`route-map.tsx:34-91`), the station strip in the lesson bar (`globals.css:926-970`), the dock progress dots tinted by line (`globals.css:1053-1073`), the 404 copy "This station isn't on the map." (`SHOTS/404-1440x900-dark.png`). It survives dark mode (`SHOTS/home-1440x900-dark-full.png`) and it is the one thing a visitor will remember.
3. **A fixed, shape-plus-colour dot vocabulary** (`legend.tsx:2-10`, `stage.tsx:627-646`), surfaced three ways: the hero DotStrip, the Key popover, and the README. Never reused for another meaning.
4. **Deliberate type.** Overpass / Atkinson Hyperlegible Next / Overpass Mono (`layout.tsx:5-13`) is a real choice, not Inter. Numbers are mono with `tabular-nums` (`globals.css:1241-1245, 1288-1292`).
5. **Tokens first, dark mode included, and the canvas reads them.** `:root` + `prefers-color-scheme` block (`globals.css:3-75`); the canvas re-reads `--dot-*` via `getComputedStyle` every second (`stage.tsx:195-210`), so dots re-theme without code.
6. **The Without | With | Change table** (`live.tsx:235-305`) is the lesson's argument in numbers; smoothing (`live.tsx:173-187`), sparklines, deltas marked better/worse. Lockstep worlds and faults that hit both worlds (`player.tsx:213-217`) make it honest. Verified: "Cut the network" → "Repair the network" (`SHOTS/consistency-vs-availability-1440x900-fault.png`), knob 15 → 19 items re-tunes live.
7. **Reduced motion is correct.** With `prefers-reduced-motion: reduce`, Play is not pressed and the scene sits at a settled `data-sim-time=3000` and stays there (`SHOTS/load-balancing-1440x900-reduced-motion.png`).
8. **Accessibility foundation.** Skip link; landmarks `header / nav[Caching line] / section[Simulation] / aside[Lesson] / footer`; `role=tablist/tab/tabpanel`; table `<caption>`; `aria-live` note; `aria-pressed` on play and faults; logical tab order (skip → brand → roundel → C1…C4 → prev/next → Key → tabs → transport); a 3px focus ring (`globals.css:132-136`). Each `<img role>` on the stage carries the figure caption.
9. **Motion discipline.** Ease-out for entering, linear travel for dots, `node-pos` glide between steps (`globals.css:1526-1528`), one-time accent ring on new nodes (`globals.css:1543-1562`), no decorative loops; requests grow out of the client instead of popping (`stage.tsx:335-342`).
10. **Copy.** Plain and specific: "The database can answer about 36 reads a second and it's getting 48." One-line `why`, "Use it when / The catch / Seen in". No AI clichés.
11. **Engineering that the design can build on:** layout coordinates are abstract (`[along, across]`), the frame is sized for all steps so switching never rescales (`player.tsx:23-29`), `npm test` guards that the fix beats the problem.

---

## 2. Ranked defects and weaknesses

Severity: P0 blocks or breaks content · P1 seriously undermines quality · P2 polish · P3 preference.

### P0

**D1. Stage labels are clipped on phones (content cut off).**
Evidence (automated sweep of all 18 lessons, both steps, confirmed by eye):
- 390×844: `consistency-vs-availability` problem step: "EU database · follower" runs 4px past the stage's right edge, the final "r" is cut (`SHOTS/consistency-vs-availability-390x844.png`); `message-queues` fix step: "Worker 1…4" cut off at the right (`SHOTS/sweep-message-queues-1-390x844.png`); `scaling-up-vs-out` fix: all four "1/2 busy" subs cut at the bottom (`SHOTS/sweep-scaling-up-vs-out-1-390x844.png`); `read-replicas` fix "1/3 busy"; `autoscaling` fix "standby" ×3; `consistent-hashing` both steps: "key → 3 nodes" / "ring of 64 points each" drawn outside the composed frame.
- 844×390: `consistency-vs-availability` both steps: "0/4 busy" / "1/4 busy" cut at the bottom (`SHOTS/consistency-vs-availability-844x390.png`).
Cause: the tall frame's width `W = min(480, max(360, 150 + Δacross·k))` and height `H = max(300, y + 64)` (`layout.ts:66-76`) are computed from node centres only; label width (`stage.tsx:63` estimates `len × 8.6` but only to pick a side) and the two label lines below the last row (`+17`, `+31` in `stage.tsx:487-494`) are never added to the frame; labels placed "right" (`stage.tsx:55`) can leave the frame entirely.
Fix: measure labels at layout time (`canvas.measureText` with the real font, or a 7.2 px/char estimate × scale) and grow the frame's `W`/`H` by the label extents plus a 16px gutter; shorten subs below 420px (`"key → 3 nodes"` → `"3 nodes"`, `"ring of 64 points each"` → `"ring"`); allow a two-line label; and add a Playwright assertion that every `.stage-svg text` bbox lies inside `.stage` for every lesson × step × viewport (the sweep script is the seed).

**D2. Contrast failures on the main CTA and on state badges (WCAG 1.4.3).**
Evidence (computed from `globals.css` tokens):
- Dark mode primary button: white on `--dot-req #6c8aff` = **3.13:1** (`globals.css:56, 332-345`). That is "Start at F1" and every "Next" button in dark (`SHOTS/caching-1440x900-dark.png`).
- Badge text `#fff` on `--dot-slow` amber ("TESTING") = **2.17:1** light / 1.81 dark (`globals.css:1707, 1710-1714`); on `--dot-ok` green (cleared tab number, 11px) = 3.27 / 1.96; on `--dot-err` ("Repair the network", 14px bold) = 4.23 / 3.02.
- `--dot-stale #8b5cf6` used as text for the TRADE-OFF tag at 11.5px uppercase mono = **4.23:1** (`globals.css:1217`).
- `--dot-req` on `--paper` (eyebrow, knob value inside `.controls`) = 4.34:1 (`globals.css:457-463, 1241-1245`).
- Line colours as text/background for small type: `.bar-code` C1 chip = paper on `--l-caching #e0560c` **3.49:1** at 13px; `.station-code` C1–C4 in that orange on paper 3.49:1 at 12px; foundations teal 3.83:1 (`globals.css:28-33, 755-758, 983-991`).
Fix: split canvas tokens from text tokens. Keep `--dot-*` for dots only; add `--on-accent` (ink on amber/green/cobalt-light, white on red/deep-cobalt), text-safe `--t-stale`, and `--l-*-ink` variants for every line (e.g. caching `#b94406`, foundations `#087070`); dark-mode primary becomes ink text on cobalt (`#0e1116` on `#6c8aff` = 6.0:1) or white on `#2f55f0` (5.7:1).

### P1

**D3. The stage is mostly empty on wide screens.**
Evidence: at 1440×900 the stage is 982×756, but node bounding boxes fill only **8–12% of its height** in single-row scenes (caching, cache-stampede, retries, circuit-breakers, latency: `nodeFillH 0.08–0.12`) and at most 48% in any lesson (sweep). `SHOTS/caching-1440x900.png`, `SHOTS/message-queues-1440x900.png` (two nodes in a dotted void). The same at 1280×720 (`nodeFillH 0.10–0.55`).
Cause: `frameFor` gives a single-row scene `H = 250` (`layout.ts:60-62`), `zoom` is capped at 1.2 and only applies for ≤3 lanes (`stage.tsx:149-154`), and the theatre always takes the whole row.
Fix: (a) raise the zoom ceiling to ~1.6 for ≤2-lane scenes with glyphs that scale (dots at `5.2 × scale`, `stage.tsx:232`, already follow), (b) give the theatre a purpose for the slack: the beat strip and the follow-a-request flight strip (§5) take 36 + 28px, (c) for scenes that still leave >40% free, drop the compare table under the stage on wide screens so the panel's dead space (next item) and the stage's dead space cancel each other.

**D4. Panel density is wrong in both directions.**
Evidence: at 1440×900 every lesson leaves **155–333px empty** below the compare table (`panelFree`, e.g. caching 266, load-balancing 333; `SHOTS/caching-1440x900.png`). At 1280×720 the Fix step **scrolls on 11 of 18 lessons** (16–175px; read-replicas 175, message-queues 112, consistency 70; `SHOTS/consistency-vs-availability-1280x720.png` shows the table cut at "EU stale reads"). Capstone scrolls 199px at 1280×720 and 408px on the phone.
Cause: `.panel { gap: 14px; padding: 16px 20px 22px }` with the `why`, tabs, step and table all in one scroller (`player.tsx:172-235`); nothing is pinned.
Fix: panel becomes a two-row grid: a scroller (tabs sticky, title, caption, controls) and a **pinned compare table** at the bottom; drop the `why` paragraph from the panel (move to Recap or a `title` tooltip on the bar title); controls padding 10→8, gap 14→10 below 760px tall.

**D5. Stage text is far below legible size on phones.**
Evidence: rendered label box heights from the sweep: in the three lessons where the *compact* layout is picked in portrait (message-queues, sharding, publish-subscribe) labels are **≈8px** and subs **≈6.5px** (`SHOTS/message-queues-390x844.png`); in the densest *tall* scenes (stale-data, read-replicas, consistent-hashing, autoscaling) ≈10px / 8px (`SHOTS/consistent-hashing-390x844.png`); landscape compact ≈9px / 7.5px (`SHOTS/caching-844x390.png`). Desktop subs are 11px mono (`globals.css:1619-1622`).
Cause: `.stage-compact .node-label { font-size: 16px }` (`globals.css:1633-1649`) is in viewBox units; it is then multiplied by `frame.scale` (0.84 compact, 0.7–1 tall; `stage.tsx:482`) and by the viewBox fit `k` (0.6–0.78 on phones). The CLAUDE.md promise ("slightly smaller glyphs") does not survive the two multiplications.
Fix: render labels in an HTML overlay positioned from the layout (absolute `div`s inside `.stage`, positions = `frame.pos × k`), so text is in CSS px with a floor of 12px labels / 11px subs; or keep SVG text and set `font-size: calc(13px / var(--k))` from the ResizeObserver. Subs on phones only when newsworthy (the compact rule at `stage.tsx:479`, extended to tall).

**D6. The layout picker chooses the wrong shape for the box.**
Evidence: at **844×390 (landscape phone)** `pickMode` picks **tall** for retries-and-backoff, latency-and-throughput and consistency-vs-availability — a vertical stack in a wide box (`SHOTS/retries-and-backoff-844x390.png`), and in consistency the floating stage tag overlaps the "US users" node (`tagHit: true`, `SHOTS/consistency-vs-availability-844x390.png`). At **390×844 (portrait)** it picks **compact** (horizontal) for message-queues, sharding and publish-subscribe, squeezing a 620-unit-wide scene into 374px (hence D5).
Cause: `pickMode` maximises `fit × LABEL_PX` (`stage.tsx:92-99`) and never considers aspect match; the stage tag is positioned absolutely and outside the layout (`globals.css:1455-1467`).
Fix: score = fit × label px × aspect-match penalty (portrait boxes never get compact unless the scene is ≤2 lanes and ≤3 columns; landscape never gets tall); reserve a top gutter in the frame for the tag or, better, remove the tag (D13) and put the beat strip in its own grid row.

**D7. Step tabs wrap and the panel can't fit three labels.**
Evidence: "Fixed servers" wraps to two lines at 1440 (`SHOTS/load-balancing-1440x900-knob.png`), "With cache" and "Retry now" wrap at 844×390 (`SHOTS/caching-844x390.png`, `SHOTS/retries-and-backoff-844x390.png`). Three equal `flex: 1 1 0` tabs at 13.5px with a 20px number badge in a 340–430px panel (`globals.css:1111-1174`).
Fix: tabs size to content with `white-space: nowrap` and an overflow-aware fallback: on narrow panels show the number only for unselected tabs ("1 · 2 With cache · ✓"); or a single-row stepper (number pills) with the selected step's name in the step title, which already exists.

**D8. Touch targets under 40px throughout.**
Evidence (measured): bar station links 36×26, prev/next arrows 36×36, brand mark 26×26 on phone, Key 49×32, speed radios 54×30 and 38×30, route-map roundel link 30×30 (`globals.css:948-961, 367-374, 199-206, 616-628, 394-416`).
Fix: 44px hit areas on touch (padding, not visual size), speed control 40px tall, the station strip as one 44px scrollable rail.

**D9. The link — the thing every request rides on — is the least visible element.**
Evidence: `--track #e5e9f0` on stage `#fbfcfd` = **1.19:1**; dark `#212b3a` on `#0e141e` = 1.29:1 (`globals.css:1490-1495`); in dark mode the rails all but vanish (`SHOTS/caching-1440x900-dark.png`). Node fills vs stage are 1.03/1.09:1, so the 2px stroke carries the node alone. The dot grid (1.2:1) is fine as decoration, but the rail is meaning (WCAG 1.4.11 wants 3:1 for meaningful graphics; 2:1 is a reasonable floor for a background path).
Fix: rails at ≥2:1 (light `#adb4bf`, dark `#3a4250`) drawn as a double rail with a lighter core (§3), nodes with a paper fill 1 step lighter than the stage.

**D10. Type scale: too many sizes under 12px, and no dominant text on the lesson page.**
Evidence: badge 10px (`globals.css:1712`), node-sub 11px, tab number 11px, step-tag 11.5px uppercase mono with 0.06em tracking, link-label 11.5px, station-code 12px, hero dot strip 13px. On a lesson the largest text is the 20px step title; the 19px bar title, 15px why, 15px caption and 13.5px tabs sit within a 6px band — the panel reads as a settings form (`SHOTS/caching-1440x900.png`). Overpass at 13.5px (tabs, node labels) loses its signage character.
Fix: the scale in §3; floor 12px for any text and 13px for mono; display face only ≥16px; one dominant element per viewport (the stage) and one dominant text (the step title at 22–24px).

**D11. Generic surface language (the "kill question").**
Evidence: dot-grid canvas background (`globals.css:1414-1422`) is the Figma/tldraw/Excalidraw default; six unrelated radii (`--radius 20px`, stage 16, controls 14, tabs 12, buttons 10, pills 999) with no scale; the hero is the stock "copy left, product-shot right" split with a blue mono uppercase eyebrow (`globals.css:457-463`, `page.tsx:15`) and a lede that paraphrases the h1; bordered-and-shadowed cards (`.hero-fig`, `.key-pop`); pill tags everywhere (`.step-tag`, `.stage-tag`, `.chip`, `.note`). The route map and the live scene rescue the page; the chrome around them does not look designed by the same hand.
Fix: §3 (surface system, radius scale, no dot grid, one accent per viewport).

**D12. Home page information architecture.**
Evidence: the hero is forced to `min-height: calc(100svh - 62px)` (`globals.css:453`), so the route map starts at y=966 at 1440×900 and y=772 at 1280×720 — always below the fold (`SHOTS/home-1440x900.png` vs `-full.png`). The desktop map has no line descriptions (blurbs exist only in the phone list, `route-map.tsx:102`), no progress summary, no "continue" affordance; visited = a filled dot. On the phone the map is a **1,700px list of 18 near-identical rows** (`SHOTS/home-390x844-full.png`), and the hero scene is a tall-layout scene with ~9px labels and a "Server 2 crashed" toast over the Users node. The 18-count in the lede is hard-coded copy that will be wrong at 50.
Fix: §4.

### P2

**D13. The same label appears three times.** Stage tag "No cache" (top-left pill), the selected tab "No cache", and the step tag "THE PROBLEM" + h2 — `player.tsx:166-168, 175-199`. Remove the stage tag; the beat strip takes its place.

**D14. The comparison mutes the thing you compare.** The inactive column renders at `opacity: .5` (`globals.css:1334-1343`), and "Change" uses heavy ▼▲ glyphs (`live.tsx:294-305`). Keep both columns at full strength; mark the active column with a 2px line-coloured rule under its header; render change as a small signed number with a thin bar.

**D15. Two different "×" next to each other in the dock.** "0.5× 1× 2×  10× slow motion" (`live.tsx:155-168`, `player.tsx:239`). Label the group "Speed" and move the slow-motion note to a tooltip on the stage clock ("scene runs 10× slower than the numbers").

**D16. Middot labels render with the space collapsed:** "US database ·leader", "EU database ·follower" (`SHOTS/consistency-vs-availability-1440x900.png`). Make the role a node badge ("LEADER"/"FOLLOWER", like "DOWN") rather than part of the label.

**D17. The `.note` toast sits on top of the scene** (top-centre on desktop, top-left on phones over the first node and beside the Key; `globals.css:1716-1753, 2037-2046`). It becomes the beat strip's event line.

**D18. Hard-coded colours.** `.cut-mark path { stroke: #fff }`, `.badge text { fill: #fff }`, `.btn-fault.on { color: #fff }`, `.tab-n { color: #fff }` (`globals.css:1516, 1711, 329, 1168, 1173`) — all need `--on-accent` tokens, especially in dark.

**D19. Key popover.** It is a `<details>` floating over the stage; on phones it covers the whole scene with no close affordance other than re-tapping "Key" (`SHOTS/capstone-390x844.png`). Move it to the bar as a popover with a close button and Escape handling.

**D20. Capstone build panel.** Two-column stepper/toggle grid with labels wrapping ("App servers", "Read replicas") at 384px (`SHOTS/capstone-1280x720.png`); the target line is a mono sentence with ≤ glyphs; "p95 — ✗" chips before any data exists. Single-column controls, target as a two-cell row (p95 ≤ 300 ms · ≤ 2% failing) with live values beside the target.

### P3

**D21.** Tab hover only changes text colour (`globals.css:1137-1139`); station-dot grows via CSS `r` transition which Safari does not animate. **D22.** The hero bar's metric row has no sparkline and is right-crammed (`globals.css:540-554`). **D23.** `scroll-behavior: smooth` on `html` applies to the one-screen player where nothing scrolls (`globals.css:83`).

### Verdict (taste-design-review)

The design argument — "watch the problem, switch on the fix, read the numbers" — is clear and honest. The single change that improves the product most is **rebuilding the stage's fitting**: labels rendered in CSS pixels with a 12px floor, frames that include label extents, an aspect-aware layout pick, and the slack on wide screens given to a narration layer. Everything else in this report hangs off a stage that is always legible and never clipped.

---

## 3. Design direction

### Three candidates

**A. Signal Room** (dark-tech control room). Near-black surfaces, phosphor dots that glow, hairlines, mono everywhere, scanline texture. *For:* instantly "alive". *Against:* it is the Linear/Vercel/Grafana look and reads as a dashboard, not a guide; glow is decorative motion the project forbids; dark-first makes light mode an afterthought; the transit identity drowns in UI chrome. Not recommended.

**B. Field Guide** (paper and ink). Warm off-white paper, ink line-art nodes, a serif for titles and recaps, mono captions, numbered figures ("Fig. C1.2"), the transit map as the fold-out at the front of the book. The page is still; only the dots move. *For:* it is literally what the product says it is ("an animated field guide"); restraint reads as premium; ink-on-paper is the clearest possible ground for six saturated dot colours; nothing else on the web looks like it. *Against:* risks feeling dry; the serif must be chosen carefully; dark mode needs a "night edition", not inverted paper.

**C. Transit Authority** (signage system). Big colour fields per line, roundels everywhere, a Johnston-style grotesk, station-sign bars, departure-board numbers, the stage drawn as a track diagram. *For:* the strongest brand, the most fun. *Against:* five line colours plus six dot colours is eleven hues on one screen; the signage becomes the content; it tips into theme-park quickly and ages badly.

### Recommendation: **B with C's bones — "Field Guide, set in signage."**

The structural metaphor stays transit (lines, zones, stations, codes, roundels, rails) but line colour becomes an *identifier*, never a surface: a roundel, a code chip, a 2px rule, a progress rail. Surfaces are paper and ink. Dots are the only saturated things on the stage, so "alive" is the motion and nothing competes with it. Clear comes from ink on paper and a label floor; premium comes from restraint, a real type scale and one radius scale.

#### Colour tokens

Light ("day"):
```
--paper:    #f4f3ef    page
--surface:  #fdfcfa    panels, bar, dock
--stage:    #faf9f6    the sheet
--ink:      #15171c    text, node strokes
--ink-2:    #3b3f48    secondary text
--muted:    #666b74    captions (4.9:1 on surface)
--rule:     #e3e1db    hairlines
--rail:     #adb4bf    links (≈2:1 on stage)
--rail-core:#e9ecf0    the lighter centre line of a rail
--card:     #ffffff    node fill (1 step above stage)
--socket:   #e8e6e1
--accent:   #3d63ff    cobalt, buttons/links (4.7:1 with white)
--on-accent:#ffffff
```
Dots (mapping fixed, values kept): `--dot-req #3d63ff`, `--dot-slow #f29e0c`, `--dot-ok #12a35c`, `--dot-stale #8b5cf6`, `--dot-turned #8a94a6`, `--dot-err #e5383b`.
Text-safe tones (never use a dot colour as text): `--t-ok #0b7a44`, `--t-warn #9a5b00`, `--t-bad #c01f2b`, `--t-stale #6d3fd6`, `--t-req #2a4fe0`.
Badge/chip text on tone fills: ink on amber and green, white on red and deep cobalt.
Lines: keep hues as fills, add ink variants for text and small chips: `--l-foundations #0b8a8a / -ink #087070`, `--l-caching #e0560c / -ink #b94406`, `--l-data #c2255c / -ink #a81f4f`, `--l-async #2f3e9e / -ink #2a3790`, `--l-resilience #8f6516 / -ink #7a5410`, `--l-edge` (new) `#1f7a4e / -ink #176340`, `--l-capstone` = ink.

Dark ("night edition", a deep tinted ink, not black):
```
--paper:    #0e1116
--surface:  #151921
--stage:    #11151c
--ink:      #ecebe6    chalk
--ink-2:    #c3c5cc
--muted:    #8e939d
--rule:     #262b35
--rail:     #3a4250
--rail-core:#1d2330
--card:     #171c25
--socket:   #263040
--accent:   #6c8aff    with --on-accent: #0e1116 (6.0:1), or #2f55f0 with white (5.7:1)
```
Dark dots as today (`#6c8aff #ffb13b #2fd28a #a98bff #8f9bb1 #ff5c60`), text-safe `--t-*` as today (all ≥7:1), line colours as today with the ink variant equal to the fill (all ≥5.6:1 on dark paper).

#### Type system

- **Signage (display):** Overpass 700/800 — the bar title, station names, codes, roundel letters, hero h1, section heads. Never below 16px.
- **Guide (titles & recap):** Newsreader (variable, optical sizes) 500/600 — lesson title in the panel/recap, step titles, "Use it when / The catch / Seen in" heads, journey titles. The serif is the "field guide" voice; if a fourth face is unwanted, use Overpass 600 with +0.01em tracking and keep three faces.
- **Body & UI:** Atkinson Hyperlegible Next 400/500/700 — all panel prose, tabs, buttons, labels on the stage.
- **Numbers & codes:** Overpass Mono 500/600 with `tabular-nums` — every metric, knob value, req/s, code, stage clock, beat index. Never for sentences (the capstone's mono target line becomes body text with mono numbers).
- Scale (px / line-height): 12/1.3 caption · 13/1.4 meta · 14/1.4 UI · 15.5/1.55 panel body · 17/1.6 home body · 20/1.25 h3 · 24/1.2 step title · 32/1.1 section · 44/1.05 lesson hero · 60/0.98 home h1. Weights: 400/500 body, 600 UI, 700 display, 800 only the h1. Floor: 12px text, 13px mono, 11px only inside stage badges (uppercase mono).

#### Spacing, radius, elevation

- Space: 4-base — 4, 8, 12, 16, 24, 32, 48, 64, 96. Panel padding 20/24; stage inset 16; dock 12.
- Radius: 4 (codes, chips), 8 (buttons, inputs, tabs), 12 (panels, cards, popovers), 20 (the stage sheet), 999 only for things that are round (roundels, station dots, play button).
- Elevation: 0 flat (default); 1 hairline `1px solid var(--rule)`; 2 raised (popovers only) `0 1px 0 rgba(21,23,28,.04), 0 12px 32px -20px rgba(21,23,28,.28)`; 3 sheet (the stage): hairline + paper tint + a 1px inner highlight. No shadows on buttons, tabs, tables or the hero figure.

#### Stage aesthetic

- **Background:** a paper sheet. No dot grid. Optional faint ruled grid (48px, ink at 4%) for lessons that want graph paper; default off.
- **Nodes:** ink line-art, 1.5px stroke, paper fill, radius 10; icon in a 20px cell top-left; sockets as embossed dots; the meter as a 3px rule along the bottom edge. Role/state as a small uppercase mono badge on the node's shoulder (DOWN, LEADER, OPEN) — ink text on amber/green, white on red. A short "platform" rule under each node ties the station metaphor into the scene.
- **Links as rails:** two 1.5px lines 6px apart in `--rail` with a `--rail-core` centre (reads as a track; ≥2:1 against the sheet); sync links dotted; a cut link breaks the rail with a red "×" roundel. Dots travel on the centre line, hugging the rail; a 2px lane offset for return traffic.
- **Depth:** three layers only — rails (back), nodes (mid, flat), dots and effects (front, canvas). The follow-mode spotlight dims the sheet to 60% around the followed request.
- **Labels:** HTML overlay, Atkinson 13px / mono 12px, ink with a paper halo, placed below or beside by the layout, never scaled.

#### How the transit identity evolves

- **Lines** stay as topics; their colour appears in: the roundel, the code chip, the 2px rule under the active tab, the progress rail in the bar, the dock dots. Never as a fill behind text smaller than 16px.
- **Zones** (new): Beginner / Intermediate / Advanced as three bands on the map, exactly as fare zones.
- **Stations** stay as lessons; the station dot is the progress mark (hollow → filled → ticked).
- **Journeys** (new): real-world systems as itineraries riding several lines; drawn as a dashed overlay on the map and as cards listing their stops' roundels.
- **Rails** (new): the map's line drawing enters the scene as the link style, so the home map and the lesson stage share one drawing language.
- **Roundel mark** stays as the brand; the dot on it becomes animated once on load (a request arriving at the station) — the only brand motion.

---

## 4. Home page and route map v2

### Information architecture (45–60 lessons)

- **Lines = topics** (rows): Foundations, Caching, Data, Async, Resilience, plus the new ones the catalogue needs (e.g. Edge & networking, Storage & search, Observability). Keep letter codes; a line can hold 6–12 stations.
- **Zones = levels** (column bands): Zone 1 Beginner, Zone 2 Intermediate, Zone 3 Advanced. A station's column is decided by level, not by index, so every line shows where it gets hard.
- **Journeys = Real-world systems**: multi-stage stories (URL shortener, chat, ticket sale, news feed…), each a list of stops across lines ending at its own ★. They live in their own section and as a toggleable overlay on the map.
- **Progress**: localStorage visits (as today) summarised per line and as "Continue at X".
- Lesson metadata to add: `level: 1|2|3`, `minutes`, `journeys[]`.

### Desktop layout (≥1100px)

1. **Masthead hero, ~58vh, not 100svh.** Headline, one line with real counts from `LESSONS`, two CTAs ("Start at F1" / "Continue at C2" when visited; "Pick a station"), the live scene on a paper sheet with its beat strip and a compact transport. The dot key moves below the fold into "How to read a scene".
2. **Your route strip (64px, only when visits exist):** continue card + per-line progress rails.
3. **The map (poster):** a fixed-logical-width SVG (viewBox ~1800 × rows·104) inside a frame that pans horizontally with scroll-snap when wider than the column; line heads sticky at the left; three zone bands as subtle vertical tints with headers; stations as dots with two-line names, 150px apart; lines bend into the terminal(s) as today. **Hover/focus on a station opens a live preview card** (lesson title, level, minutes, the Problem scene warmed and playing at 220×140; one preview mounted at a time; still frame under reduced motion). Journey overlay toggle draws a dashed path through that journey's stops.
4. **Journeys:** horizontal cards, each with title, 4–6 roundel stops, stage count, and a mini scene of the finished architecture; the card in view autoplays, others show a still.
5. **How to read a scene:** the dot key as a one-rail live demo (dots actually move through the seven states).
6. Footer.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◉ System Lab        Map   Journeys   Key                         [Continue ▸]│ 56
├──────────────────────────────────────────────────────────────────────────────┤
│  AN ANIMATED FIELD GUIDE            ┌────────────────────────────────────┐   │
│  Watch systems work.                │ beat: Server 2 crashed · 2/4       │   │
│  Then watch them break.             │   ○──◇──▭▭▭──▭──⌸   (paper sheet)  │   │ ~58vh
│  52 lessons · 7 lines · 4 journeys  │                                    │   │
│  [Start at F1]  [Pick a station]    └ ▶ ⏭ ↺ 1×  p95 372 ms · hits 78% ───┘   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▍Your route · next C2 Content delivery  F ●●●●○○○ C ●○○○○○ D ○○○○○○ …  [▸]  │ 64
├──────────────────────────────────────────────────────────────────────────────┤
│  THE MAP          ZONE 1 · Beginner   │  ZONE 2 · Intermediate  │ ZONE 3 · Advanced
│  (F) Foundations ─●───●───●───●───────┼──●───●───●─────────────┼──●───●────┐
│                   F1  F2  F3  F4      │  F5  F6  F7             │  F8  F9   │
│  (C) Caching     ─●───●───●───●───────┼──●───●─────────────────┼──●────────┤
│  (D) Data        ─●───●───●───────────┼──●───●───●─────────────┼──●───●────┤
│  (A) Async       ─●───●───●───────────┼──●───●─────────────────┼──●────────┤
│  (R) Resilience  ─●───●───●───────────┼──●───●───●─────────────┼──●────────┤
│  (E) Edge & net  ─●───●───────────────┼──●───●─────────────────┼──●────────┤
│  ‹ pan ›   [ ] show journeys                                      ╰─(★ Capstones)
│            ┌ hover card: C3 Expiry & stale data · Zone 2 · 6 min ┐
│            │ [live preview 220×140]                  Open ▸      │
│            └─────────────────────────────────────────────────────┘
├──────────────────────────────────────────────────────────────────────────────┤
│  JOURNEYS · real-world systems                                                │
│  ┌ URL shortener ───┐ ┌ Chat app ────┐ ┌ Ticket sale ──┐ ┌ News feed ───┐     │
│  │ (F)(C)(D)(R) ★   │ │ (A)(A)(D) ★  │ │ (R)(C)(A)(D) ★│ │ (C)(D)(A) ★  │     │
│  │ [live final arch]│ │ 5 stages     │ │ 4 stages      │ │ 6 stages     │     │
│  └──────────────────┘ └──────────────┘ └───────────────┘ └──────────────┘     │
├──────────────────────────────────────────────────────────────────────────────┤
│  HOW TO READ A SCENE   ●─●─●─◎─■─◆─○  live one-rail demo of the seven states  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Phone layout (≤760px)

Board mode replaces the poster. Hero scene becomes a 200px compact "ticker" (horizontal, so labels stay ≥12px), the headline sits above it. Lines are collapsible groups with progress counts; a zone filter and a search field sit above; journeys scroll horizontally as cards.

```
┌──────────────────────┐
│ ◉ System Lab      ≡  │
│ Watch systems work.  │
│ Then watch them break│
│ [Start at F1]        │
│ ┌──────────────────┐ │
│ │ ○─◇─▭─▭─⌸  ticker│ │ 200px compact scene
│ └ ▶ 1×  p95 372 ms ─┘ │
│ ▍Continue · C2 ▸     │
│ [All][Beginner][Int][Adv]  🔍 │
│ (F) Foundations  4/9 ▾│
│   ● F1 Latency & thr…│
│   ● F2 Scaling up vs…│
│   ○ F3 Load balancing│
│ (C) Caching      1/7 ▸│
│ (D) Data         0/8 ▸│
│ …                    │
│ JOURNEYS ▸▸ ─────────│ h-scroll cards
│ KEY ● ● ● ◎ ■ ◆ ○    │
└──────────────────────┘
```

Live previews on the phone: none on hover (no hover); the continue card shows the next lesson's Problem scene as a still; journey cards autoplay only the one in view.

---

## 5. Lesson player v2 (bar · stage | panel · dock)

**Bar (56px).** Brand mark (name hidden <1100px) · line roundel + station rail (keep, 44px tall hit area) · lesson title 20px signage · right: **Key** (popover from the bar, no longer floating over the stage), **Map**, ‹ ›.

**Theatre = a 3-row grid inside the same grid area:** `beat strip (36px) / stage (1fr) / flight strip (28px, only in follow mode)`. Both strips are fixed-height, so the document still never scrolls; the stage gives up 36–64px, which is affordable given the 50–90% unused height measured on wide screens.

- **Beat strip (narration layer).** One line, inside the sheet's top edge: `Beat 2 of 4 · A queue builds in front of the database` with a thin progress rail in the line colour. Beats are scripted moments on each figure (`beats: [{ at: time | event('first-miss' | 'queue>10' | 'crash'), text, focus?: nodeIds[] }]`); they advance with sim time, and `focus` dims everything but the named nodes on the canvas and pulses their accent ring. The current `.note` (scripted event toast) and `.stage-tag` fold into this strip. ‹ › in the dock scrubs beats (the sim seeks to the beat's time by restarting and warming — deterministic, so cheap). Reduced motion: beats become a static numbered list in the panel.
- **Follow one request.** A dock toggle (`f`). The engine tags the next request leaving the client; the canvas draws it 1.6× with a halo and a fading trail, the rest at 70%. The beat strip shows its ticket: `#412 · waiting at Database · 180 ms so far`. The **flight strip** under the stage is a 28px timeline: segments per hop (client → server → cache → db → back) coloured by state (cobalt travelling, amber waiting, green answered, red failed), with dwell times in mono. On completion it holds 2s ("answered in 340 ms", or "gave up after 500 ms") and picks the next request; Pause keeps it. On phones the flight strip replaces the beat strip while following.
- **Stage.** Paper sheet, rails, HTML labels with a 12px floor (D5), no stage tag, no floating Key.

**Panel (clamp 360–440px), two rows: scroller + pinned table.**
- Scroller: step tabs (sticky; content-sized, number-only when narrow), step tag + **title 24px serif**, caption, controls (knob with value bubble; choice as segmented; fault buttons), and on Recap the three takeaways plus "Next stop". The `why` line leaves the panel (it belongs to the map's preview card and the lesson's `<title>`).
- Pinned **compare table**: both columns full opacity; a 2px line-coloured rule marks the active column; change as a signed number + thin bar; sparkline stays. Rows ≤4.

**Dock (60px).** ▶ ⏭ ↺ · Speed as one cycling button "1×" (tooltip "scene runs 10× slower than the numbers") · **Follow a request ◯** · ‹ beat › · progress (beats within step, steps within lesson) · Back · **Next**.

```
┌ bar 56 ──────────────────────────────────────────────────────────────────┐
│ ◉  (C) C1 C2 C3 C4   C1 · Caching                      Key   Map   ‹  ›  │
├ theatre ────────────────────────────────────┬ panel 400 ─────────────────┤
│ ┌ beat 36 ─────────────────────────────┐    │ [1 No cache][2 With cache][✓] │ sticky
│ │ Beat 2/4 · A queue builds in front…  │    │ THE PROBLEM                   │
│ ├──────────────────────────────────────┤    │ Every read goes to the        │
│ │                                      │    │ database            (24 serif)│ scroller
│ │      ○═══▭▭▭═══════════⌸             │    │ caption…                      │
│ │   paper sheet · rails · ink nodes    │    │ ┌ Cache size ───● 15 items ┐  │
│ │                                      │    │ [⚡ Crash server 2]           │
│ ├ flight 28 (follow mode) ─────────────┤    ├───────────────────────────────┤
│ │ #412 ○→▭ 20 ms →⌸ waiting 180 ms …   │    │ Response   360 ms │ 346 ms │▁▂│ pinned
│ └──────────────────────────────────────┘    │ DB busy      92 % │  87 % │▃▁│ table
├ dock 60 ────────────────────────────────────┴───────────────────────────────┤
│ ▶ ⏭ ↺  1×   Follow a request ◯   ‹ beat ›   ●●○○ · ●○○     [Next: With cache →] │
└──────────────────────────────────────────────────────────────────────────────┘
```

Keyboard: Space/k play, ←/→ steps (keep), `[`/`]` beats, `f` follow, `1 2 3` steps, Esc closes popovers.

---

## 6. Mobile

**390×844 (portrait)**
- Grid rows: `bar 48 / stage 42svh / summary 44 / panel 1fr / dock 56`. The stage loses the Key and the tag; the beat strip is 32px inside the sheet's bottom edge.
- Layout pick: always *tall* in portrait unless the scene has ≤2 lanes and ≤3 columns (then compact at ≥0.9 fit); frames include measured label extents plus a 16px gutter (D1); labels HTML, 12px floor, subs only when newsworthy; long roles become node badges (D16).
- **Summary row (new, pinned):** the headline metric for the active step with its change — `Response 360 → 346 ms ▼ 4%` — so the number stays visible while reading; tap expands the full table in the panel.
- Panel: sticky tabs (keep), 24px serif title → 20px, caption, controls; Recap shows the takeaways and a "Next stop" card.
- Dock: ▶ ⏭ 1× · Follow ◯ · **Next**; Back lives in the bar's ‹; `env(safe-area-inset-bottom)` (keep).
- Touch: 44px for brand, arrows, Key, tabs, speed; slider thumb 28px with a value bubble; fault buttons 44px.
- Home: 200px compact ticker scene, board list with collapsible lines and a zone filter (§4).

**844×390 (landscape phone)**
- `bar 40 / stage | panel 56% | 44% / dock 48`. Never pick *tall* (D6); compact with the label floor; the beat strip only (no flight strip; follow shows the ticket in the beat strip).
- Tabs as number pills with the selected label only (D7); the summary row replaces the pinned table; the `why` and slow-motion note hidden.
- Panel scroll is unavoidable here (250–430px measured today); keep tabs sticky and put the fault button above the caption so the interactive thing is reachable without scrolling.

**Both**
- `.stage-tag`, floating `.key`, and the centred `.note` are removed from the stage, which also fixes the tag-over-node overlap (D6) and the toast-over-Users-node on the home hero.
- Add the sweep as a Playwright test: no `.stage-svg text`/label outside `.stage`; no interactive target under 40×40 on phone projects.

---

## 7. Component inventory

| Component | Purpose | Where used |
|---|---|---|
| `Tokens` (CSS custom properties) | Day/night colour roles incl. `--on-accent`, `--t-*` text tones, `--l-*-ink`; type scale; space, radius, elevation | `globals.css`, everything |
| `Sheet` | The stage surface: paper, hairline, optional ruled grid; hosts SVG, canvas and label overlay | `stage.tsx`, hero, previews |
| `Rail` | Link renderer: double rail with core, sync (dotted), cut (× roundel) | `stage.tsx` |
| `StationNode` | Node card: ink line-art body, sockets, meter rule, platform rule, shoulder badge (DOWN/LEADER/OPEN) | `stage.tsx`, `glyph.tsx` |
| `NodeLabel` | HTML overlay label + sub with 12px floor, side placement from layout, paper halo | `stage.tsx` |
| `BeatStrip` | Narration line: beat index, text, progress rail, focus/spotlight hook, scripted-event line | theatre, hero |
| `FlightStrip` | Followed-request timeline: hops, dwell segments, result | theatre (follow mode) |
| `FollowToggle` | Dock toggle + keyboard `f`; drives engine tagging and canvas halo | dock |
| `Transport` | Play / step / restart / speed-cycle, 44px targets | dock, hero, previews |
| `StepTabs` | Content-sized tabs with number pills; collapses to numbers; sticky | panel |
| `CompareTable` | Pinned Without/With/Change; active-column rule; bar deltas; sparklines | panel |
| `MetricSummary` | One-row headline metric + change for phones; expands to the table | phone panel |
| `Knob` | Range with value bubble (mono); choice as segmented control | panel, capstone |
| `FaultButton` | Bolt + label; pressed state read from the sim; 44px | panel, capstone |
| `Roundel`, `CodeChip`, `LineRail`, `ProgressDots` | Transit identity primitives (line colour as identifier only) | bar, map, dock, cards |
| `KeyPopover` | Dot vocabulary with live mini-dots; opens from the bar; Esc/close | bar, home |
| `RouteMap` (poster) | SVG map with zones, pannable frame, sticky line heads, journey overlay | home desktop |
| `RouteBoard` | List mode: collapsible lines, zone filter, search | home phone, map fallback <1100px |
| `StationPreview` | Hover/focus card with a warmed live mini-scene (one at a time; still under reduced motion) | map |
| `JourneyCard` | Real-world system: title, roundel stops, stage count, final-architecture scene | home |
| `ContinueCard` + `LineProgress` | Last visited, next station, per-line rails from localStorage | home, bar (optional) |
| `Masthead` | The ~58vh hero: copy, CTAs, live scene with beat strip | home |
| `LessonShell` | The bar · theatre(beat/stage/flight) | panel(scroller/pinned) · dock grid, with phone and landscape variants | lessons, capstone |
| `CapstoneBuild` | Single-column steppers/toggles, cost, target row with live values | capstone |
| `NightTheme` | The `prefers-color-scheme: dark` override block (night edition) | `globals.css` |

Tests to add alongside: label containment and touch-target sweeps in Playwright (desktop, mobile, landscape projects), and a token contrast test (seeded by `scratchpad/contrast.py`) so D2 cannot regress.

---

### Evidence index (SHOTS/)
`home-{1440x900,1280x720,390x844}[-full][-dark].png` · `{caching,load-balancing,consistent-hashing,retries-and-backoff,consistency-vs-availability,message-queues}-{1440x900,1280x720,390x844,844x390}.png` · `*-{fix,knob,fault,recap}.png` for caching, load-balancing, consistency-vs-availability, retries-and-backoff at 1440 and 390 · `capstone-{1440x900,1280x720,390x844}.png`, `capstone-1440x900-dark.png` · `*-dark.png` for caching, consistency-vs-availability, message-queues at 1440 and 390 · `sweep-*-{390x844,844x390}.png` for every clipping hit · `load-balancing-1440x900-{reduced-motion,focus}.png` · `404-1440x900-dark.png`.
