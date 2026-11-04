# Coverage and release verification — 5 November 2026

This supersedes the earlier native-V8 partial-file coverage report. The UI review commits through `90348a1` are integrated. New tests, a recoverable failed-sign-out fix, dependency patches and repeatable CI/browser coverage are included. No company user or permission was changed by this verification.

## Results

| Check                        | Result                          | Boundary                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API automated tests          | 365 passed                      | Synthetic unit/HTTP/store tests; not installed SQL                                                                                                                                                                    |
| Web automated tests          | 258 passed                      | Helpers, render tests and probes                                                                                                                                                                                      |
| Architecture / packaging     | 7 passed                        | Includes canaries proving fake MSAL/E2E harness cannot enter deployment source ZIP                                                                                                                                    |
| Chromium browser E2E         | 22 passed                       | Desktop 1440×1000 and mobile 390×844; synthetic identity provider and HTTP fixtures                                                                                                                                   |
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
| Web unit + browser     |                170 / 170 | **33.07%** |   80.65% |    52.37% |

Frontend line coverage increased **12.50 percentage points** versus the complete-inventory baseline. Current recovery handling adds source lines, hence the tiny unit-only denominator difference. Browser execution discovers more functions/branches in previously unexecuted components, so those denominators grow; their percentages are not directly comparable to unit-only counters. The previous 89.79% web number omitted 73 files and must not be compared as whole-web coverage. The previous native API figure also used different V8 attribution; use the c8 series for comparisons.

| Previously missing integration area | Current line coverage |
| ----------------------------------- | --------------------: |
| `App.tsx`                           |                81.62% |
| `IdentityPending.tsx`               |                  100% |
| `auth.ts`                           |                62.16% |
| `CatalogueCertificationPicker.tsx`  |                92.55% |
| `SkillReviews.tsx`                  |                74.40% |
| `business/BusinessWorkflows.tsx`    |                61.44% |

Coverage is still incomplete: 36 frontend files have zero hit lines, including major learning, personal skill intake, catalogue and request screens. No 100% requirements coverage or full end-to-end company acceptance is claimed. Prioritize stateful interaction tests for those screens and approved isolated SQL before setting a release-quality coverage threshold.

## What was added or corrected

- Signed-token missing-claim/app-only/scope/header boundaries and MSAL redirect/account/retry regressions: 21 scenarios, counted with their parent by Node.
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

For a before/after baseline, `node scripts/test-coverage.mjs --baseline` writes a separate directory. Baseline here was collected before the recovery fix/browser additions using the same patched dependencies/toolchain. Current evidence: `artifacts/coverage/current/{api,web}/`, `artifacts/coverage/combined-web/`, `artifacts/e2e/report/`, JSON results and retained failure traces. These generated records stay ignored; no source employee exports or tokens are committed. CI uses Ubuntu/Node 24; this local run uses Windows/Node 26.8.2. Remote CI/Linux-native installation remains a separate result to inspect after push.

## Remaining functional and environment gates

The two P2 findings in [the f07f320 audit](UI_FIX_AUDIT_2026-11-05.md) remain: cold-edit linked-skill name hydration and the existing archived-mapping SQL blocker. No unverified migration was shipped to change that policy. Read [case inventory](TEST_CASE_GAPS_2026-11-05.md) for expected SQL rollback/concurrency/revocation and company-login outcomes. Real-company Admin/Manager/Employee roles, the pending limited lead grant, shared GatePass compatibility, corporate policy, recovery and live SQL mutation E2E remain unverified here.
