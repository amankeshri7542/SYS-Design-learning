# System Lab verification

Verified locally on 2026-09-30. No commits, pushes, deployments, infrastructure changes, or AWS credentials were used for this improvement.

## Implemented requirements

- All 56 original lesson IDs remain searchable and filterable. Each has authored controls, baseline/contrast scenarios, inspectable state, prediction checks, pseudocode, prerequisites, misconceptions, references, and reviewed difficulty/duration. See the [per-lesson checklist](lesson-checklist.md).
- Ten visualization families render deterministic domain-event snapshots. Metrics, event explanations, component state, item inspection, replay, and comparison use the same run. Queue accounting, finite ring membership, half-open recovery, request routing, and parameter-dependent canary outcomes have explicit checks.
- Guided and Experiment modes support run/pause/resume/reset, event stepping, speed, seeking, fault/recovery injection, and validated versioned share URLs. Controls explain when changing a value restarts the model.
- The six-stage connected journey covers product reads, order placement, and asynchronous notifications, including accepted versus completed work, compensation, duplicate suppression, and recovery. Conceptual/AWS labels describe examples without provisioning resources.
- Explored and understood progress are separate. Legacy completion migrates conservatively; guest and account records stay separate. Storage errors, malformed storage, account switching, expiry, logout, and cloud load/retry are covered without claiming failed writes succeeded.
- Desktop and mobile layouts include native dialogs, keyboard operation, visible focus, reduced-motion styles, readable lesson prose, and the original Aman attribution and portfolio link.

## Verification results

| Check | Result | Evidence |
|---|---|---|
| TypeScript | Passed | `npm run typecheck` |
| Unit, semantic, and API tests | **76 passed; 0 failed** | `npm test`; `tests/engine.test.ts`, `tests/simulation.test.ts`, `tests/cloud.test.ts` |
| Full Chromium browser suite | **71 passed; 0 failed** in 34.3 seconds | `npm run test:browser`; local HTML report at `test-results/browser-report/index.html` |
| Additional mobile control/sheet assertions | **3 passed; 0 failed** | `npm run test:browser -- --grep 'mobile readability' --reporter=list` |
| Production build | Passed | `npm run build` with installed Next.js 16.3.7 |
| Lesson references | **49 unique URLs returned HTTP 200** | [reference-check.json](reference-check.json); AWS timeouts article redirects to its new Builder Center URL |
| Lint | Not configured | No lint script or lint configuration exists in the repository |

The 56-lesson browser sweep loads each lesson, steps an event, changes scenario, seeks to completion, compares with baseline, switches to AWS labels, and exercises modeled failure scenarios. It asserts no page/console errors, no required `/api/simulate` request, and no horizontal overflow. Separate tests check intermediate cache fills, DLQ movement, half-open probes, ring membership changes, stale replicas, and saga compensation.

Interaction coverage includes frozen state while paused, resume/speed, failure/recovery, URL restoration, keyboard dialog focus and Escape, prediction progress, migration, search/empty results, storage disabled, malformed URLs, corrupted guest storage across account switching, and mocked cloud load failure followed by retry. The connected journey is checked across all six stages and three operations.

Responsive checks use 320, 390, and 768 CSS-pixel widths. Six representative families are checked at each width for overflow and lesson text at least 16px. On phone layouts, additional assertions open controls, inspect a component in a bottom sheet, close it, and verify focus returns to the triggering component. Reduced motion is enabled during these checks.

## Screenshots and reports

Screenshots are in [`docs/screenshots/`](screenshots/):

- `desktop-{cache-aside,dead-letter,circuit-breaker,consistent-hashing,replication,network-isolation}.png`
- `mobile-{cache-aside,dead-letter,circuit-breaker,consistent-hashing,replication,network-isolation}.png`
- `state-{cache-aside,dead-letter,circuit-breaker,consistent-hashing,replication,sagas}.png`
- `connected-journey.png`

Representative desktop, phone, intermediate-state, and connected-journey screenshots were visually inspected. Inspection caught and corrected a hashing snapshot that updated owners before its busiest-node metric. Regression assertions now compare that metric with actual ownership in every frame. Screenshot capture also resets scroll/focus to avoid full-page capture artifacts.

The HTML browser report is generated locally and ignored by Git. Test artifacts use `test-results/artifacts`, separate from the HTML report so cleanup cannot delete it. Screenshots under `docs/screenshots` are retained as reviewable evidence. The Next.js development indicator may appear in captures; it is absent from production builds.

## Run and reproduce

```bash
npm ci
npm --prefix infra ci
npm run dev -- --port 3100
# Open http://127.0.0.1:3100

npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npx playwright show-report test-results/browser-report

# Regenerate the authored lesson inventory:
node --import tsx scripts/lesson-checklist.ts
```

No environment variables, database, Render service, or AWS credentials are needed for guest learning and simulation. `infra` dependencies are needed for the existing cloud-boundary tests; running the learning UI itself does not require them.

## Limits and unverified integration

- These finite educational models are not AWS service emulators, throughput forecasts, or infrastructure benchmarks. See [model-contract.md](model-contract.md) for per-family assumptions, simulated units, fault observation, and workload limits.
- Cloud browser tests use local fake identity namespaces and mocked HTTP responses. Real Cognito login, invite delivery, token refresh, API Gateway authorization, DynamoDB persistence, and deployed cloud synchronization were **not tested against AWS**. The existing cloud schema syncs explored IDs only; understood status remains local to each account.
- Browser automation ran in Chromium. Firefox, Safari/WebKit, physical devices, screen-reader behavior, and a formal WCAG audit remain unverified. Keyboard checks and responsive screenshots do not substitute for those audits.
- `/api/runs` retains the existing cloud contract. `/api/simulate` accepts old inputs through an adapter but now returns v2 event `frames`; external callers expecting old formula `points` must migrate.
- Nothing was published. The existing GitHub repository and live site were not updated; these changes are available in the local working tree only.
