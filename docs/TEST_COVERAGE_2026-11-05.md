# Coverage and release verification — 5 November 2026

Latest user decision: coverage expansion to 90% is deferred until after the audited main integration. See [the final integration audit](FINAL_MERGE_AUDIT_2026-11-05.md). CI still runs and reports the 90% check, with `continue-on-error` for this explicitly deferred target. The measurements below predate the final UI/workflow merge and must not be presented as fresh coverage of that merge. Final release manifests record functional test/build results separately.

## Earlier local coverage follow-up

The latest passing runs contain **867 unit/tooling checks: 8 tooling, 446 API and 413 web**, plus **64/64 Chromium desktop/mobile E2E scenarios**. API/web runs have zero failures, skips, cancellations or TODOs. Evidence: ignored `artifacts/final-api-coverage.log`, `artifacts/final-coverage.log`, `artifacts/final-e2e.log` and per-app `run.json`/`tests.log`. Typechecks, production builds and generated-document check pass. The earlier 864-check checkpoint remains in `artifacts/current-all-tests.log`. Local 089 scope SQL acceptance is recorded separately in [Portfolio scopes](PORTFOLIO_SCOPES_2026-11-05.md).

The pasted 778-test report records another source hash/HEAD and **104/172 represented web files**. Its mapped-file 92.22% cannot establish whole-web coverage or satisfy the requested 90% gate. The fresh complete-inventory result is:

| Area                       | Source files | Lines/statements | Branches | Functions | 90% gate |
| -------------------------- | ------------ | ---------------- | -------- | --------- | -------- |
| API                        | 125/125      | 92.69%           | 90.31%   | 94.56%    | Pass     |
| Web, merged unit + browser | 172/172      | 70.90%           | 83.14%   | 59.19%    | **Fail** |

Web counters are 30,049/42,379 executable lines, 5,523/6,643 discovered branches and 1,136/1,919 discovered functions. Native-V8 discovered branch/function counts can change as more callbacks execute; they are not an independent enumeration of every unexecuted branch. SQL/CSS are outside these TypeScript percentages. No production TypeScript files are excluded except declarations. Current-source hashes, passing runs, full source representation and all four 90% metrics are enforced locally and in CI; stale artifacts cannot approve release.

Production source hashes: API `c8f46b8b1515f0fc0f7611930f7e6e79acd639f77824a711c62b7c5bfecce9c0`; web `b6b47cf65f3f436a9c14ac6c9f6e59ec3f1ffe5c77f162dbb162eeed3c4be893`. Passing coverage recorded unchanged production sources before/after each run. The browser merge references the complete passing run beginning `2026-11-05T14:14:19.658Z`. Readable reports are under `artifacts/coverage/current/api` and `artifacts/coverage/combined-web`.

One intermediate instrumented API run failed the large-PDF validation wall-clock boundary. The production validation limit was preserved. Test concurrency is now bounded to four workers; the complete repeat passed 446/446, including that real PDF case. The failed intermediate log was superseded by the complete repeat; its summary remains documented here rather than being counted as a pass.

Largest remaining web gaps: CapabilityComposer (942 lines), BusinessWorkflows (768), SkillClaimWizard (599), TeamCapability (598), AccessAdmin (524), EmployeeCapability (500), SkillGrowthJourney (436), Certifications (399), MySkills (389), AssistantWidget (372). These require more workflow interactions, not denominator exclusions. The full 39 SQL-backed application suites and hosted identity/access acceptance remain unexecuted; the new isolated SQL acceptance is bounded to the documented hierarchy/scope cases.

The requested 90% overall target is **not achieved**. A review candidate ZIP may be provided with failed-gate metadata; it is not an accepted release. No live deployment is claimed. The dated checkpoint below is retained as historical evidence.

## Earlier checkpoint

This supersedes the earlier native-V8 partial-file coverage report. The UI review commits through `90348a1` are integrated. New tests, a recoverable failed-sign-out fix, dependency patches and repeatable CI/browser coverage are included. No company user or permission was changed by this verification.

## Results

Release clarification: the earlier ZIP is a build artifact, **not production acceptance**. A 33.07% whole-web line result plus 39 unexecuted SQL suites is insufficient evidence for a full release-readiness claim. No live deployment was performed during that verification. Coverage percentages alone cannot approve a release: current-manager/assigned-reviewer denials, scoped access, real SSO, transactional writes and private files need their own acceptance evidence.

| Check                        | Result                          | Boundary                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API automated tests          | 365 passed                      | Synthetic unit/HTTP/store tests; not installed SQL                                                                                                                                                                    |
| Web automated tests          | 258 passed                      | Helpers, render tests and probes                                                                                                                                                                                      |
| Architecture / packaging     | 7 passed                        | Includes canaries proving fake MSAL/E2E harness cannot enter deployment source ZIP                                                                                                                                    |
| Chromium browser E2E         | 30 passed                       | Desktop 1440×1000 and mobile 390×844; synthetic identity provider and HTTP fixtures                                                                                                                                   |
| Hosted public smoke          | 8 passed                        | Homepage/profile/health/config, anonymous API denials, disabled demo login and missing asset; no authenticated writes                                                                                                 |
| SQL-backed integrations      | **39 NOT RUN / BLOCKED**        | Existing isolated SQL connection failed; no newly approved target supplied. Company real-user database was not used for mutation tests. Full filename/status inventory is in ignored `artifacts/sql-e2e-status.json`. |
| Dependencies                 | 0 reported npm audit advisories | Compatible patches to Azure Identity, Vite, concurrently and transitive dependencies; not a penetration-test claim                                                                                                    |
| Types / architecture / build | Passed                          | API/web typecheck, architecture and production builds                                                                                                                                                                 |

The browser fixture replaces MSAL only in `e2e/vite.config.ts` and intercepts `/api/` with synthetic records. It exercises real React components, navigation, asynchronous loading, CSS/layout, keyboard controls and the actual auth client/session flow against that adapter. It does **not** prove Microsoft consent/MFA, token issuance, SQL grants/transactions or real role authorization. API signed-token/policy checks are separately tested. The fake provider and test harness are excluded from production packaging.

## Coverage with the complete source inventory

Measured with c8 9.1.0 and V8, including **all** production `.ts`/`.tsx` files. Only `.d.ts` declarations are excluded. Native/browser source maps are normalized and merged through Istanbul; untested UI, operator CLIs and SQL adapters are not hidden to inflate percentages. SQL scripts and CSS are outside executable TypeScript coverage.

| Area                   | Represented source files |      Lines | Branches | Functions |
| ---------------------- | -----------------------: | ---------: | -------: | --------: |
| API current            |                123 / 123 |     76.03% |   84.50% |    75.92% |
| Web unit-only baseline |                170 / 170 | **20.57%** |   83.13% |    63.17% |
| Web current unit-only  |                170 / 170 |     20.56% |   83.13% |    63.17% |
| Web unit + browser     |                170 / 170 | **42.93%** |   78.68% |    47.96% |

Frontend line coverage increased **22.36 percentage points** versus the complete-inventory baseline and **9.86 points** versus the earlier 33.07% unit + browser result. Current recovery handling adds source lines, hence the tiny unit-only denominator difference. Browser execution discovers more functions/branches in previously unexecuted components, so those denominators grow; their percentages are not directly comparable to unit-only counters. The previous 89.79% web number omitted 73 files and must not be compared as whole-web coverage. The previous native API figure also used different V8 attribution; use the c8 series for comparisons.

| Previously missing integration area | Current line coverage |
| ----------------------------------- | --------------------: |
| `App.tsx`                           |                81.62% |
| `IdentityPending.tsx`               |                  100% |
| `auth.ts`                           |                62.16% |
| `CatalogueCertificationPicker.tsx`  |                92.55% |
| `SkillReviews.tsx`                  |                74.40% |
| `business/BusinessWorkflows.tsx`    |                61.44% |

Coverage is still incomplete: 20 frontend files have zero hit lines. Learning, personal skills and request screens now have browser execution, but large parts of intake, administration, catalogue and AI flows remain uncovered. No 100% requirements coverage or full end-to-end company acceptance is claimed. Prioritize stateful interaction tests for those screens and approved isolated SQL before setting a release-quality coverage threshold.

## New workflow coverage

| Source                               |  Lines |
| ------------------------------------ | -----: |
| `MySkills.tsx`                       | 46.04% |
| `SkillClaimDialog.tsx`               | 60.66% |
| `capabilities/SkillCertificates.tsx` | 83.21% |
| `Learning.tsx`                       | 66.94% |
| `LearningHome.tsx`                   | 79.30% |
| `LearningSession.tsx`                | 60.19% |
| `Requests.tsx`                       | 92.52% |
| `RequestList.tsx`                    | 90.88% |
| `RequestActionDialog.tsx`            | 46.03% |

The realistic fixture writes are local browser adapter state. They validate command contents, required text, refreshed views and revision progression, not actual database persistence or SQL authorization.

## What was added or corrected

- Signed-token missing-claim/app-only/scope/header boundaries and MSAL redirect/account/retry regressions: 21 scenarios, counted with their parent by Node.
- Eight additional desktop/mobile cases use fictional human-readable workforce data for skill filtering/feedback, learning pause/resume and study notes/resources, request comments/cancellation with changing revisions, and expired reviewed credentials. Fixtures do not contain real employee identities or mutate company data.
- Local browser tests for Admin/Manager/Employee presentation, keyboard account menu, error/retry/recovery/logout, verified-identity card, mobile overflow, unknown paths, picker synchronization, Provider amendment routing and review history filters.
- Failed sign-out on the recovery card now displays a recoverable error and enables retry; no unhandled promise or permanently busy state. Desktop/mobile regression cases exercise failure then success.
- Full-source c8 reports and merged browser coverage with repeatable scripts; CI runs those checks and uploads reports.
- Development-only fake provider and test fixture isolation verified by release packaging canaries. No application permission or production sign-in bypass added.

## Repeat

```powershell
npm ci
npm run typecheck
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm run coverage:browser
npm run build
npm audit
```

For a before/after baseline, `node scripts/test-coverage.mjs --baseline` writes a separate directory. Baseline here was collected before the recovery fix/browser additions using the same patched dependencies/toolchain. Current evidence: `artifacts/coverage/current/{api,web}/`, `artifacts/coverage/combined-web/`, `artifacts/e2e/report/`, JSON results and retained failure traces. These generated records stay ignored; no source employee exports or tokens are committed. CI uses Ubuntu/Node 24; this local run uses Windows/Node 26.8.2. The previous 519d335 CI run passed on Ubuntu/Node 24; the new workforce scenarios still require their own post-push CI result.

## Remaining functional and environment gates

The two P2 findings in [the f07f320 audit](UI_FIX_AUDIT_2026-11-05.md) remain: cold-edit linked-skill name hydration and the existing archived-mapping SQL blocker. No unverified migration was shipped to change that policy. Read [case inventory](TEST_CASE_GAPS_2026-11-05.md) for expected SQL rollback/concurrency/revocation and company-login outcomes. Real-company Admin/Manager/Employee roles, the pending limited lead grant, shared GatePass compatibility, corporate policy, recovery and live SQL mutation E2E remain unverified here.
