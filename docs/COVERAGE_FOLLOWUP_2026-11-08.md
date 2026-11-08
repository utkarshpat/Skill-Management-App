# Workflow coverage follow-up — 8 November 2026

This increment continues [the earlier checkpoint](TEST_COVERAGE_2026-11-08.md) from commit `d6b4001`. The 90% target is still pending; no exclusion or threshold was reduced.

## Organization dialog correction

OrganizationSetup previously mounted its edit dialog and review dialog simultaneously after a successful preview. The edit dialog is now unmounted while a preview is open, in both branch-edit and reporting-assignment modes. Parent-owned draft state survives **Back to edit**. Preview receipt, revision, payload and explicit confirmation are unchanged. The tests assert one mounted dialog, unchanged draft values on return, and a receipt-bound save only after confirmation. Failed rechecks discard the old preview and require another preview.

This is a UI-only correction. It adds no permissions, database migration, queries or caching. It does not change SQL authorization, manager policy or transaction/audit behavior.

## Added behavioral coverage

Six suites add 29 tests using actual application components and synthetic delivery records:

| Suite                                       | Tests | Cases                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommendation-workflow-controls.test.tsx` | 6     | Received/sent paging; unavailable response actions; discussion note validation; decline/back; manager recipient and skill discovery; HTTPS resource validation; failed-send draft preservation; exact revision and stable acceptance plan/task IDs; focused denial and exact plan link. |
| `organization-workflow-controls.test.tsx`   | 5     | Exact hierarchy assignment and receipt confirmation; single review modal; conflict/re-preview; self/descendant manager exclusion; malformed placement repair; branch parent validation; permission denial/retry; reporting/search and archived nodes.                                   |
| `learning-workflow-controls.test.tsx`       | 7     | Pause/resume/archive; reschedule and log completion; conflict draft preservation; manual schedule validation/review; exact calendar dates; stable IDs on unconfirmed create retries; calendar selection; read-only/deep-link denial; AI suggestion remains a draft.                     |
| `own-skills-workflow-controls.test.tsx`     | 4     | Own profile search/filter; read-only claim details; exact-revision submission recovery; conflict/retry; malformed and unknown links; denied refresh clears profile; read-only recovery cannot submit.                                                                                   |
| `assistant-chat-controls.test.tsx`          | 5     | Quota error restores text; explicit retry and new-chat context; history resume/delete; access-change notice; recoverable history read failure; explicit shortcut replacement; collapsed/background reply; unverified/unconfigured navigation disables sending.                          |
| `review-certification-workflow.test.tsx`    | 2     | Legacy queue paging/search/clear; failed decision preserves note; exact credential revision on retry; analytics retry and independent recommendation permission.                                                                                                                        |

Tests intercept network calls locally. No company employee, Entra identity, AI deployment or SQL data was modified. UI projections are tested separately from installed-SQL enforcement; fixture names do not imply authority.

## Verification boundaries

Production web build, web and test typechecks, architecture boundaries, generated-document freshness, formatting and eight tooling checks pass. The complete desktop/mobile browser regression run passes 68/68 on the changed production source. API production files are unchanged; the earlier passing 461-test API evidence remains valid by source inventory hash, rather than being presented as a new API run.

## Coverage mapping correction

The c8 multi-process merge combined generated offsets for the same URL before source mapping. These tests load some TypeScript modules as both ESM and CommonJS, producing different generated code and maps. The raw Node reports confirmed both generated lengths for `auth.ts` within one process, but only one cached map for that URL. Consequently the old percentages varied with cache/report ordering. Measurements from the old mapping must not be compared as though they used the corrected method.

The web runner now groups raw coverage by matching generated-source-map variant, merges only compatible generated ranges, maps each variant to original source, then merges Istanbul coverage. Missing or ambiguous maps fail explicitly. All 173 production files remain represented; unimported files remain zero-covered. Only declarations are excluded, as before. API instrumentation is unchanged.

The new tooling regression checks ESM/CommonJS disjoint execution, reversed report order, a process cache overwritten by another format, uncovered-file retention, missing maps and source-map escape rejection. Reversing **all actual raw reports** also produced identical line, statement, function and branch counters. An unmeasured `branchesTrue` field has no role in the gate. Nine tooling tests pass.

The browser merge and coverage gate now require mapping version `generated-variant-before-source-merge-v1` and an exact match to the unit run completion timestamp. An old merged report cannot approve a newer unit run merely because production source did not change. The 90% requirement remains unchanged.

## Latest measured checkpoint

The corrected complete web run finished `2026-11-08T17:09:12.368Z`: **509 passed**, zero failures, skips, cancellations or TODOs. Production source hash: `83e4b8f77fa682305e506528e4530f008cd31e5d14dbef8904f9b7f57af170b1`.

| Area                                       | Files   | Lines/statements | Branches   | Functions  | 90% gate |
| ------------------------------------------ | ------- | ---------------- | ---------- | ---------- | -------- |
| API, unchanged production source           | 126/126 | 92.75%           | 90.33%     | 94.52%     | Pass     |
| Web unit, corrected source mapping         | 173/173 | 68.62%           | 83.61%     | 67.79%     | Fail     |
| Web unit + 68 desktop/mobile browser tests | 173/173 | **86.84%**       | **89.01%** | **72.99%** | **Fail** |

Percentages are rounded from counters as in the gate. Merged counters are 38151/43933 lines and statements, 8616/9680 branches, and 1778/2436 functions. At this denominator, 90% requires at least **1389 more lines**, **96 branches**, and **415 functions**. Denominators may change when additional callbacks execute. This is not a completed 90% release.

Largest remaining line gaps: CapabilityComposer 562; BusinessWorkflows 390; MySkills 325; AccessAdmin 299; AssistantWidget 212; CertificationDialog 202; BusinessOperations 196; ClaimEvidence 186. More workflow/save/upload/conflict interactions are needed. UI tests cannot replace installed-SQL transaction acceptance.

`npm run coverage:check` exits 1 as expected. Readable report: `artifacts/coverage/combined-web/index.html`; counters/hash: `summary.json`; raw mapping evidence: `artifacts/coverage/current/web/tmp`; unit evidence: `run.json` and `tests.log`. No ZIP was presented as 90%-accepted, and no deployment or database migration was performed.
