# Automated flow audit — 14 October 2026

Target: https://skill-management-app.vercel.app. Repository HEAD at start: `dcdad6b`. The working tree already contained an unfinished conversational people-search increment, including migration 082. Existing changes were preserved. The automation memory file did not exist at the supplied path; it was created for this run.

## Findings and corrections

- The new people-results component failed React/TypeScript compilation because an AbortController ref had no initial value. It now explicitly initializes an optional ref.
- People-search input silently dropped malformed falsy scope IDs and selected the authorized union. Explicit malformed scopes now return a validation error; omitted scope still means the authorized union. Regression tests cover malformed scopes, normalized duplicate IDs, forged selectors and bounded requirements.
- New assistant and saved-conversation types imported a private Business module. They now use the public module index; the actual architecture checker passes.
- Migration 082 could not compile because a table-variable declaration was combined with a scalar declaration. After correcting compilation, a foreign-account probe reproduced SQL error 3915: the nested BusinessContext denial attempted rollback underneath INSERT EXEC. The procedure now reads the same canonical Business projection/functions directly, with explicit runtime-account, profile and active-account guards. Foreign-account, unauthorized employee and foreign-scope probes return 51003; normal/eligible-only reads succeed. The migration was tested only within rolled-back development transactions and was not installed.
- Generated Knowledge Transfer inventory omitted the new migration and failed the inventory test. The maintained generator refreshed both generated artifacts.
- The Business SQL fixture retained earlier five-level assumptions, inserted an invalid number of skill row values, created unlinked duplicate renewal identities and attempted standalone submission transitions prohibited since migration 072. The fixture now uses the installed framework and saved level metadata, sets renewal ancestry atomically, checks the current sibling-identity rejection, and limits historical standalone/custom-framework setup to versions that support it. Current grouped transitions are exercised by the separate capability fixture. Production authorization and credential constraints were not relaxed.

## Verification

| Check | Result |
| --- | --- |
| Architecture tests | 6 passed |
| API tests, including new search regressions | 306 passed |
| Web tests | 204 passed |
| Total automated tests | 516 passed; no failures or skips in these suites |
| Business Operations development SQL | 24 rollback scenarios passed; cleanup confirmed |
| Linked capability development SQL | 21 rollback scenarios passed |
| Credential identity development SQL | 6 rollback scenarios passed |
| People-search development SQL | 5 rollback cases passed |
| Production build and typecheck | Passed for API and web |
| Actual architecture check, generated-doc check, diff whitespace | Passed |
| Hosted page routes | All 12 configured page routes returned the SPA with HTTP 200 |
| Hosted main JavaScript asset and health | HTTP 200 |
| Hosted protected APIs without authentication | All 8 sampled endpoints returned HTTP 401 |

SQL cases cover scope/DENY, foreign account/resource, stale revision, inactive people, administration lockout, files, amendment/matching/shortlist/recovery, grouped upload and decisions, rerouting, renewal replacement/history and credential duplicate rules. These are development database results, distinct from hosted acceptance. Changes and test fixtures were rolled back; no lasting database migration, access assignment or employee-record change was made by this run.

## Remaining hosted acceptance

The in-app browser opened the production application successfully but remained at sign-in. Neither a reusable authenticated session nor the configured hosted demo code was available in this run. A sign-in request was sent while independent testing continued; no login became available. Consequently this run does **not** establish every logged-in flow, action or button on production. It also does not establish real Microsoft SSO, AI provider responses, scheduler delivery, or release acceptance of the local changes.

The fixes remain local and uncommitted. No deployment was made. After an authorized hosted sign-in and release of the reviewed increment, finish employee/manager/business/admin browser actions and AI matching/export acceptance against the deployed release.

Evidence is in ignored `.local/automation-*2026-10-14.log`, `.local/automation-public-production-2026-10-14.json` and `.local/automation-people-search-sql-results.json`. Permanent regression coverage is in `apps/api/test/people-search.test.ts` and the explicit opt-in `apps/api/test/people-search.integration.ts`; the latter is available through `test:people-search` with `RUN_PEOPLE_SEARCH_SQL_TESTS=1` on a development database.
