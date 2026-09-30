# System Lab quality verification

Verified on 30 September 2026 against the existing `main` branch, starting at `1409583`. The owner explicitly requested a commit and GitHub push after implementation, overriding that restriction in the attached brief. No deployment or AWS provisioning was performed.

## Confirmed fixes

- Per-lesson drafts retain controls, faults, explicit actions, playback position, mode, predictions, and pinned A through navigation, refresh, and Back/Forward. Old shared URLs remain supported. Corrupt storage is preserved; playback restores paused.
- A is pinned exactly and B forks all its inputs. The comparison lists every changed control, seed, fault schedule, and redrive schedule; multiple changes never claim isolated causality. Comparison computation is deferred until opened.
- Saga forward and compensation accounting is consistent; blocked disaster recovery measures actual unavailability and freezes only on readiness. Semantic component health defaults unfamiliar labels to degraded. Playback completion is separate from the domain outcome.
- CloudFront misses traverse viewer → edge → origin and back; hits avoid the origin. Dependency repair leaves DLQ work quarantined until explicit redrive. Application-mediated cache writes/invalidation and source-queue DLQ transfer appear in the actual event paths.
- Recovered breaker wording no longer claims a successful probe when a short failure never opened the circuit.

## Learning and visual design

Guided mode puts one decision beside playback and the connected operation; prediction and feedback share a panel, with a skip option. Experiment mode exposes the full controls and exact A/B evidence. Seeds, raw state, and assumptions are progressively disclosed. Native switches, named policies, count steppers, and quantity inputs match their meaning.

Family views retain actual cache entries/expiry, message identity/lifecycle, breaker transitions, replica versions/read values, hash ownership/remapping, and saga service lanes. Readable inspectors cite the last changed event. Desktop navigation collapses, and phone diagrams focus the operation with an option to show the full architecture. Queue lanes keep a stable height and retain the current message in their bounded preview. Every item remains available through the inspector.

The connected journey permits independent cache, source, worker, provider, recovery, and redrive choices. It reuses the cache/queue mechanisms and shared breaker policy. Workload settings collapse behind a native disclosure; operation playback stays visible.

Research, reproduced starting defects, and design decisions: [quality-plan.md](quality-plan.md). Technical details: [engine-audit.md](engine-audit.md), [journey-audit.md](journey-audit.md), and [model-contract.md](model-contract.md).

## Verification results

| Check | Result |
| --- | --- |
| Repository/remote | Existing `main`; confirmed `amankeshri7542/SYS-Design-learning`; fetched remote before push |
| Formatting | Changed source/test files passed Prettier check |
| TypeScript | `npm run typecheck` passed |
| Semantic/API/progress/session tests | `npm test`: **94 passed**, no skipped or failed tests |
| Browser suite | `npm run test:browser`: **85 passed** in 46.8s, including all 56 lessons and five approved visual baselines |
| Production build | `npm run build` passed, Next.js 16.3.7 standalone output |
| Production smoke | Built app served on port 3101; initial lesson and question visible with JavaScript disabled; hydrated interaction and draft writes verified |
| Screens and layout | Inspected 1366×768, 1440×900, 390×844, and 320×844; no page overflow; desktop and mobile intermediate states inspected |
| Keyboard/accessibility behavior | Navigation, controls, inspector Enter/Escape/focus return, reduced motion, and mobile sheets covered by browser tests |
| Security-sensitive diff | No dependencies, auth endpoints, cloud contracts, or infrastructure changed; no credential-pattern matches in the patch |
| Whitespace/conflicts | `git diff --check` clean; no conflict markers in source/tests/infra/scripts |
| Lint | Skipped: repository defines no lint tooling/script |

The final laptop Run button is at y=424px (previously y=1034px); the entire connected diagram is inside the 1366×768 viewport. Phone Run is at y=460px/485px at 390px/320px width. The phone's full diagram and detailed evidence require scrolling; prediction controls are available through **Predict & tune**. Journey playback is likewise initially reachable, while its focused architecture extends below the phone viewport.

Screenshot inspection found and corrected missing phone arrowheads, clipped DLQ labels, overlapping hash labels, a no-op desktop focus toggle, and a source-queue transfer missing from the DLQ path. Visual baselines were established only after inspecting corrected candidates, then checked without updating snapshots.

## Evidence locations

- Final production viewports and layout/performance data: [quality/](quality/), including `guided-1366.png`, `guided-1440.png`, `guided-390.png`, `guided-320.png`, and `layout-check.json`.
- Inspected journey screenshots: `quality/journey-{1440,390,320}.png`.
- Approved candidate images: `quality/visual-candidates/`; runnable regression baselines: `../tests/browser/visual.spec.ts-snapshots/`.
- Catalog/intermediate browser captures: [screenshots/](screenshots/), including cache fill, stale replica read, half-open breaker, DLQ quarantine, hashing membership, and saga compensation.
- Original audit evidence: [quality-before/](quality-before/).
- Generated browser HTML report: `test-results/browser-report/index.html` (ignored by Git; regenerate with the command above).

## Responsiveness and limits

The bounded engine was profiled over 168 baseline/upper-bound/backlog combinations. The slowest measured median was 2.18ms, with a 2.86ms maximum sample. Production Chromium input-to-two-animation-frame samples, including React and local draft persistence, had medians of 30.3–30.6ms for cache, DLQ, and hashing controls. These include deliberate frame waits and are not field INP measurements. See [performance.md](performance.md). No worker or runtime dependency was justified.

This was engineering and automated browser verification, not human usability testing, physical-phone performance testing, a screen-reader or browser-zoom audit, cross-browser certification, or live AWS validation. Visual baselines target local Chromium on macOS and may need separately reviewed baselines on another platform. Cloud flows were tested with existing mocks. Simulations remain finite teaching models: saga compensation retries, asynchronous rate-limited SQS redrive, and full CloudFront cache layers are documented simplifications. Optional account progress retains its existing AWS integration; guest learning needs no backend or credentials.

## Run locally

```bash
npm ci
npm --prefix infra ci
npm run dev -- --port 3100
# http://127.0.0.1:3100

npm run typecheck
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm start
```

All 56 lesson IDs, guest/account progress behavior, shared configuration compatibility, and the Aman portfolio footer are preserved.
