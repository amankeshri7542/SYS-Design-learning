# Focused quality pass

Starting point: clean working tree at `1409583`. The user's current message authorizes a verified commit and push on the existing branch; no deployment or provisioning is included.

## Audit before editing

Actual browser inspection at 1366×768 reproduced a Run button at y=1034 and prediction feedback at y=2229. The initial canvas starts at y=630, leaving almost no usable diagram in the laptop viewport. Editing cache TTL to 20 and stepping to 1s, then visiting the library and returning, restored TTL 8 and 0s. Evidence: `quality-before/audit.json` and before screenshots.

Code confirms: comparison silently creates a default strategy/fault schedule; inspectors dump object properties; architecture relationships sit inside a closed details panel; health styling recognizes only a few strings; baseline computation runs even when comparison is closed. Semantic findings are independently reproduced and documented in `engine-audit.md`. Journey findings and decisions are in `journey-audit.md`.

These are confirmed behavior defects or measurable discoverability problems. A disconnected visual hierarchy and excessive card framing are design judgments, not results of human usability testing. No finding is assumed disproven merely because an old test passes.

## References and design decisions

- [Red Blob Games: A*](https://www.redblobgames.com/pathfinding/a-star/introduction.html): introduce one representation, place the action beside it, step through observable state, and connect code to that evidence. Apply this to question → action → active path → changed state.
- [Bartosz Ciechanowski: Gears](https://ciechanow.ski/gears/): manipulable time reveals relationships; controls belong next to the consequence and motion is pausable. Keep the deterministic scrubber, use short state highlights, and respect reduced motion.
- [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus enters the inspector, stays inside while modal, and returns on dismissal. Use native dialogs with readable summaries and optional raw data.
- Current Next.js guidance was fetched through Context7 and read from the installed package. Lesson content must appear in initial server-rendered HTML; interactive state hydrates afterward, with no whole-page loading replacement.
- `find-skills` checked the skills.sh leaderboard and Vercel's official `agent-skills` source (31,741 stars). Use installed React, frontend-design, accessibility-review, and Playwright guidance; no new skill or runtime dependency is needed.

Visual direction: a calm engineering workbench. Keep paper #f5f8fc, ink #172c42, white #ffffff, blue #245edb, teal #087e70, and warning amber #a45b12. Space Grotesk headings, DM Sans 17px prose, monospace event time. The signature is a connected operation diagram with a nearby evidence strip. Boundaries represent systems; prose does not need individual cards. Guided mode shows one question and a primary action; Experiment mode exposes controls and A/B evidence. Seed/version/fault schedule details live in Advanced.

## Implementation and acceptance checklist

- [x] Persist per-lesson drafts, mode, controls, cursor, fault/actions, and pinned A across navigation/refresh; support Back/Forward and old share URLs.
- [x] Pin exact A, fork B, compute comparison on demand, and list every changed input without single-cause claims.
- [x] Independently test saga accounting, actual DR unavailability, CDN paths, semantic health, explicit DLQ redrive, and honest end outcomes.
- [x] Put action and connected architecture in the initial laptop viewport; pair predictions with feedback and allow skipping.
- [x] Keep family-specific state, readable inspectors, event-linked explanations, hashing ownership arcs, and saga service lanes.
- [x] Reuse mechanisms in a configurable journey with independent cache/source/worker/recovery choices.
- [x] Use semantic controls, consistent tokens, keyboard/dialog focus, phone operation focus, reduced motion, and no page overflow.
- [x] Measure representative/worst bounded recomputation; add no worker/library without evidence.
- [x] Run checks and default/intermediate-state browser coverage at laptop/phone sizes, inspect screenshots, then establish visual regression baselines.
- [x] Review final diff, commit and push to the verified existing GitHub remote; report actual results and limits.
