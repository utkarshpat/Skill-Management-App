# Coverage expansion checkpoint — 8 November 2026

Status: **90% target remains unmet.** This is a tested increment, not release acceptance. Production application code, coverage exclusions and thresholds were not changed. The production baseline is `efeb8a5f9c05` on `utkarsh-patel2-ssgia-perf-instrumentation-deferred-reads`.

## Fresh verification

- Web unit/component coverage run: **480 passed**, zero failed, skipped, cancelled or TODO. Completed `2026-11-08T07:21:24.560Z`.
- Browser regression run: **68 passed**, desktop and mobile, approximately 6.3 minutes. All current run coverage files were merged; stale browser files are excluded by the existing merger.
- Web application and test typechecks, architecture boundaries and eight tooling checks pass.
- Existing passing API coverage evidence remains valid against its unchanged production inventory: 461 tests. API tests were not rerun for this web-test-only increment.

| Area                  | Represented production files | Lines/statements | Branches   | Functions  | All metrics >=90% |
| --------------------- | ---------------------------- | ---------------- | ---------- | ---------- | ----------------- |
| API, unchanged source | 126/126                      | 92.75%           | 90.33%     | 94.52%     | Pass              |
| Web, unit only        | 173/173                      | 55.05%           | 80.13%     | 66.77%     | Fail              |
| Web, unit + browser   | 173/173                      | **80.23%**       | **85.12%** | **66.88%** | **Fail**          |

The gate computes percentages from counters, while Istanbul's JSON summary truncates some percentages: web functions are 1789/2675 (66.88% rounded; summary 66.87%). Web combined lines are 35247/43932 and branches 7931/9317. Native V8 function/branch denominators can grow as previously unexecuted files and callbacks execute. File inventory remains complete; these are not selected-file percentages.

Production web source hash: `8415f93cbe519fafc20921458d77abdbc9911f2bb52005c96c5efe760b9c8671`. `npm run coverage:check` correctly exits **1** because web fails the target. SQL and CSS are outside these TypeScript metrics.

## Added behavioral coverage

Eight new suites add **31 tests**, using actual imported React components rather than copied implementations or source-text assertions:

| Suite                                       | Verified behavior                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `access-admin-controls.test.tsx`            | Permission scopes and historical grants, explicit role draft/save and reversion, search/status filters and exact selected person/role callbacks.                   |
| `team-capability-controls.test.tsx`         | Team filters, member drilldown, review navigation, foreign-person detail rejection, denied/retry states and fresh export authorization reads.                      |
| `workflow-assistance-controls.test.tsx`     | Revision-bound AI review drafts, explicit use, cancellation, denied actions, people matching/exports and learning-journey retry/continue states.                   |
| `ui-kit-accessibility.test.tsx`             | Accessible progress bounds including invalid numbers, empty/constant/invalid chart inputs, loading labels, empty states and disabled switches.                     |
| `certification-review-actions.test.tsx`     | All three decisions require notes, exact revision forwarding, busy/duplicate-submit prevention, failed-save draft preservation and unavailable reviewer controls.  |
| `certification-portfolio-controls.test.tsx` | Read-only issuer details, review navigation, search/category/status/validity filters, clear/reset and revoked access removing an open credential.                  |
| `learning-planner-controls.test.tsx`        | Goal/time/date validation, generation/refinement without automatic save, explicit roadmap use, quota/malformed reply recovery and same-draft confirmation retries. |
| `request-action-controls.test.tsx`          | Comment/start/resolve/cancel notes, exact action/revision, AI draft approval before save, stable retry event ID and paginated recipient handoff.                   |

Fixtures use realistic employee names and delivery tasks. They are local synthetic records intercepted by test fetch mocks, not changes to company employees. These browser/component checks verify UI contracts, not installed-SQL authorization enforcement or a live Entra session. No company database writes, migration or deployment occurred.

## Remaining prioritized gaps

| File under `apps/web/src`                         | Uncovered lines | Line coverage | Uncovered functions |
| ------------------------------------------------- | --------------- | ------------- | ------------------- |
| `capabilities/CapabilityComposer.tsx`             | 562             | 71.07%        | 14                  |
| `Recommendations.tsx`                             | 405             | 56.12%        | 16                  |
| `business/BusinessWorkflows.tsx`                  | 390             | 80.61%        | 33                  |
| `MySkills.tsx`                                    | 389             | 46.04%        | 21                  |
| `AssistantWidget.tsx`                             | 372             | 56.89%        | 27                  |
| `Learning.tsx`                                    | 360             | 66.94%        | 54                  |
| `PeopleAccessWorkspace.tsx`                       | 323             | 76.07%        | 15                  |
| `AccessAdmin.tsx`                                 | 299             | 75.55%        | 45                  |
| `OrganizationSetup.tsx`                           | 283             | 70.49%        | 53                  |
| `certifications/CertificationRecommendations.tsx` | 272             | 60.23%        | 7                   |
| `ReviewWorkspace.tsx`                             | 237             | 40.60%        | 8                   |

At the current denominator, reaching 90% requires at least 4292 more covered web lines, 455 branches and 619 functions; new executed callbacks may change these denominators. Next tests must exercise remaining save/conflict/recovery, recommendation lifecycle, organization assignment and assistant interaction paths. Do not substitute narrower exclusions or reduced thresholds.

## Reproduce and inspect

Run `node scripts/test-coverage.mjs --app=web`, `npm run test:e2e`, `npm run coverage:browser`, then `npm run coverage:check`. The last command currently fails as expected. Reports are ignored build artifacts in this checkout:

- `artifacts/coverage/combined-web/index.html`: per-file merged browser/unit report.
- `artifacts/coverage/combined-web/summary.json`: source hash and merged counters.
- `artifacts/coverage/current/web/run.json` and `tests.log`: unit run evidence.
- `artifacts/e2e/results.json`: complete browser run evidence.

This report supersedes the historical 5 November measurements for the current web source. It does not claim that all edge cases or the 90% target are complete.
