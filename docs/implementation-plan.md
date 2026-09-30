# System Lab implementation plan

Scope: improve all 56 existing identifiers locally. No commit, push, deployment, infrastructure, or credentials.

1. Replace the teaching engine with deterministic domain events and immutable snapshots. Establish cache-aside, queues/DLQs, circuit breakers, and a finite consistent-hash ring first, then cover every lesson.
2. Define explicit controls, baseline/contrast/recovery scenarios, learning content, prerequisites, misconceptions, references, and reviewed metadata for every lesson.
3. Build a readable workspace with family-specific state views, inspection, guided/experiment modes, playback, fault injection, seeded comparison, validated URLs, and the connected-system journey.
4. Migrate progress conservatively; keep guest and account records separate, preserve the optional cloud contract, and expose failures/retries/logout accurately.
5. Verify semantic invariants and every lesson in a browser; record evidence and remaining limits.

## Product decisions

- Simulations are small finite workloads, not capacity forecasts. One event clock controls all state; playback speed changes wall time only. Configuration changes restart. Fault injection forks the remaining timeline at the current event.
- Each family has its own representation: cache inventory, fleet capacity, message lanes, version ledger, circuit states, finite hashing ring, policies, network zones, records, or transaction/workflow timeline.
- Conceptual labels are the default. AWS labels describe an example implementation and never provision resources.
- Visual direction: a bright engineering notebook with ink navy #172c42, paper #f5f8fc, white #ffffff, instrument blue #245edb, success teal #087e70, and warning amber #a45b12. System sans body at 17px; compact monospace for time/versions. The signature is an inspectable state bench next to the event narrative, not decorative moving packets.
- Legacy “completed” records become explored, never automatically understood. Understanding requires an optional lesson-specific check after interaction. Guest data is never silently merged into an account.
- Existing cloud storage supports explored lessons only. Understanding remains local per account until the cloud schema is explicitly upgraded.

## Requirements checklist

- [x] All 56 lessons: controls, contrasting scenarios, state view, content, semantic tests (see lesson-checklist.md).
- [x] Determinism, accounting, recovery, seeded comparisons, versioned URL validation.
- [x] Run/pause/resume/reset/step/speed/seek and in-run failure/recovery.
- [x] Connected journey with reads, orders, notifications and Conceptual/AWS views.
- [x] Guided learning, meaningful checks, search/filter/recommendations.
- [x] Safe progress migration, unavailable storage, session expiry, logout, cloud retry.
- [x] Accessible desktop/mobile UI and reduced motion.
- [x] Typecheck, existing tests, semantic tests, production build, every-lesson browser sweep.

Skills: find-skills; installed Vercel React guidance (754.8K leaderboard installs; source 31,717 stars when checked), frontend-design, react-ui-review/accessibility, playwright-cli. No extra skill installation needed. The inline visualization skill is not applicable to repository components.

Verification scope and remaining limits: see [verification.md](verification.md).
