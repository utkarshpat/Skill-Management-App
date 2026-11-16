# Web workflow coverage checkpoint — 9 November 2026

This increment continues from `d118fcf` and [the corrected coverage follow-up](COVERAGE_FOLLOWUP_2026-11-08.md). The 90% gate remains unchanged for all four metrics. Complete source inventory and generated-variant source mapping remain enforced.

## Fixed admin dialog stacking

The new template and person-preview tests reproduced two simultaneously mounted FormDialogs in AccessAdmin. While a review is open, its underlying template/person editor is now unmounted. All editable values remain in the parent component; **Back to edit** restores the same permissions, name and employment fields. A failed recheck closes the preview and retains the draft for a new preview. Receipt, revision, authorization and save/audit API behavior are unchanged.

The regression tests first failed with two dialogs, then passed with one. The change adds no database migration, permissions or authorization cache. It does not change current-manager review policy, effective access, scope resolution or historical grants.

## Added cases

Five new suites and two extended suites add **31 behavioral tests**:

| Suite                                       | Added tests | Verified flows                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capability-upload-controls.test.tsx`       | 7           | Evidence format validation and removal; saved claim revision forwarded to upload; upload revision forwarded to submit; 5 MB certificate promotion limit; supporting skill retained; advisory autofill; upload-before-submit ordering; submitted-skill guard; reviewed links use publish-links without fields/review writes; failed upload never submits; renewal autofill preserves original name and issuer. |
| `business-compose-controls.test.tsx`        | 5           | Explicit scope binding and demand requirements; preview before confirmation; scope/record conflicts; old receipt invalidation; new issuer catalogue save; selected mapping labels survive search; archived mappings require explicit removal; non-approver proposals remain proposals.                                                                                                                        |
| `access-admin-save-controls.test.tsx`       | 4           | Template permission preview, single modal and back-to-edit; receipt-bound save; failed recheck preserves draft and requires re-preview; new person employment fields do not assign roles/hierarchy; preset proposals and failed preview never write.                                                                                                                                                          |
| `claim-evidence-controls.test.tsx`          | 5           | HTTPS reference presentation; empty/invalid upload; conflict/retry and confirmed revision; review endpoint without upload/promotion controls; denial/retry; six-file limit; exact private-file reread for certificate promotion; failed promotion and abort-on-unmount; object URL cleanup.                                                                                                                   |
| `business-administration-controls.test.tsx` | 5           | Exact Portfolio DENY and expiry; Admin switches to organization/null binding; Business project and membership commands remain separate from responsibilities; uncertain save keeps assignment ID; baseline preview does not remove historical grants.                                                                                                                                                         |
| `certification-dialog.test.tsx`             | 3           | Keyboard issuer choice and Escape; custom issuer/category, clear and pointer choice; validity preset/lifetime dates; explicit save preserves credential edits.                                                                                                                                                                                                                                                |
| `own-skills-workflow-controls.test.tsx`     | 2           | Legacy draft editing preserves conflict values; save precedes submit; submit uses the saved next revision; save-success/submit-failure offers an exact recovery link.                                                                                                                                                                                                                                         |

These tests use actual application components, intercepted HTTP calls and synthetic delivery records. Names, job titles, reporting structures and access profiles in fixtures are not sources of authority. The payload assertions test UI contracts; they do not establish installed-SQL enforcement. No company SQL, real employee data, Entra identities or AI quota was changed.

## Follow-up through 9 November

The notification panel uses the browser top layer for a right-side drawer with search, read filters, category filters, refresh, keyboard dismissal and full-width mobile layout. A request-list regression showed that reselecting the active tab dropped loaded rows without starting a new read. Reselecting now clears filters without discarding the current list. Switching between My requests and Assigned to me still clears the previous list before the new read.

| Suite                                    | Added tests | Verified flows                                                                                                                                                                                 |
| ---------------------------------------- | ----------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history-notification-controls.test.tsx` |           5 | Audit history and feedback pagination, denied refresh and retry, per-person notification read state, storage event isolation and partial feed recovery.                                        |
| `business-analytics-controls.test.tsx`   |          10 | Portfolio and hierarchy intersection parameters, rank and renewal drill-through, explicit search, pagination, filter resets, export capability and denial, and cancellation on filter changes. |
| `assistant-output-controls.test.tsx`     |           5 | Explicit draft handoff, edited text, copy retry, quiz completion and reset.                                                                                                                    |
| `assistant-chat-controls.test.tsx`       |           5 | Execution-time action recheck, actor-bound learning ticket, demand and catalogue handoffs, denied request options and scoped matching prompt.                                                  |
| `sidebar-controls.test.tsx`              |           5 | Keyboard and pointer ordering, actor-specific persistence, unavailable storage, fixed profile position and navigation callbacks.                                                               |
| `learning-home-controls.test.tsx`        |           5 | Independent task and history pagination, week navigation, read-only paths, AI draft retry and plan deep links.                                                                                 |
| `request-list-controls.test.tsx`         |           5 | Active tab reselection, inbox switching, query and pagination resets, exact record opening, denial recovery and late-response cancellation.                                                    |
| `access-admin-save-controls.test.tsx`    |           2 | Receipt and revision per person, retry of remaining bulk changes, and activity cursor, search and denial recovery.                                                                             |

The follow-up adds 42 tests to the 31 initial cases above. The notification drawer also has a browser test exercised at desktop and mobile sizes.

## Validation

The web unit and component run passed all 582 tests across 129 test files. The production build, web typecheck, architecture checks, generated handover check and nine tooling tests passed. Coverage includes all 173 production web TypeScript files. The web source hash is `9284b3267dd1513555f5b261f7f95098d7355fe2f26fe80b8383325b4de384eb`. Unit and browser coverage use the generated-variant source mapping introduced in `d118fcf`.

| Web metric           | Unit and component tests | Covered / total |
| -------------------- | -----------------------: | --------------: |
| Lines and statements |                   83.21% | 36,610 / 43,993 |
| Branches             |                   86.25% |   8,284 / 9,604 |
| Functions            |                   78.04% |   1,482 / 1,899 |

The API coverage gate uses the prior passing 461-test run for the current API source hash. Browser tests use local HTTP fixtures.

## Combined web gate

All 70 desktop and mobile browser cases passed on the same production source. The merged results are below.

| Web metric           | Coverage | Covered / total | 90% gate     |
| -------------------- | -------: | --------------: | ------------ |
| Lines and statements |   92.11% | 40,522 / 43,993 | Pass         |
| Branches             |   92.15% | 10,401 / 11,287 | Pass         |
| Functions            |   82.25% |   2,127 / 2,586 | Below target |

Function coverage is the remaining gate. At the current denominator, 201 more functions need coverage. The largest groups of uncovered functions are `Learning.tsx` (25), `KnowledgeTransfer.tsx` (24), `AccessAdmin.tsx` (21), `BusinessWorkflows.tsx` (20), `SkillReviews.tsx` (19), `Certifications.tsx` (18).

## Review queue, learning recovery and handover follow-up

Eleven additional component tests cover skill review denial and conflict, current submission routing, queue filters and deep links, learning recovery and schedule confirmation, and handover navigation, export and cancellation. The full web suite passed 593 tests in 131 files. This test-only increment uses the existing 70 passing desktop and mobile browser cases on the same web production source hash.

| Web metric           | Combined coverage | Covered / total | 90% gate     |
| -------------------- | ----------------: | --------------: | ------------ |
| Lines and statements |            92.52% | 40,702 / 43,993 | Pass         |
| Branches             |            92.59% | 10,663 / 11,516 | Pass         |
| Functions            |            83.72% |   2,201 / 2,629 | Below target |

At this denominator, 166 additional functions would reach 90%. The largest measured groups are `AccessAdmin.tsx` (21), `BusinessWorkflows.tsx` (20), `Learning.tsx` (18), `Certifications.tsx` (18), `MySkills.tsx` (13).

## Certification portfolio and catalogue follow-up

Eight component tests cover renewal from the list, details and deep link, read-only renewal denial, combined credential editing, return from recommendations, catalogue paging and denial recovery, retirement preview, and demand selection across search pages. All 601 web tests and the web typecheck passed. The combined report includes the 70 passing browser cases for the same production source hash.

| Web metric           | Combined coverage | Covered / total | 90% gate     |
| -------------------- | ----------------: | --------------: | ------------ |
| Lines and statements |            92.91% | 40,874 / 43,993 | Pass         |
| Branches             |            92.88% | 10,755 / 11,580 | Pass         |
| Functions            |            84.62% |   2,222 / 2,626 | Below target |

At the current denominator, 142 more measured functions need coverage to reach 90%.

## Access, skills and request detail follow-up

Eleven component tests cover account and permission exception previews, skill editor cancellation, explicit draft submission, skill-profile filters and pagination, and request detail refresh and conflict recovery. All 612 web tests and web typecheck passed. Combined coverage uses the 70 passing browser cases for the same production source hash.

| Web metric           | Combined coverage | Covered / total | 90% gate     |
| -------------------- | ----------------: | --------------: | ------------ |
| Lines and statements |            93.18% | 40,991 / 43,993 | Pass         |
| Branches             |            93.02% | 10,893 / 11,711 | Pass         |
| Functions            |            86.21% |   2,275 / 2,639 | Below target |

At the current denominator, 101 additional measured functions need coverage to reach 90%.

## Employee capability, learning and combined drafts follow-up

Ten component tests cover employee skill filters, scoped review history and decisions, learning journey resume and session completion, and confirmed draft removal and restore. All 622 web tests and web typecheck passed. Combined coverage uses 70 passing browser cases for the same production source hash.

| Web metric           | Combined coverage | Covered / total | 90% gate     |
| -------------------- | ----------------: | --------------: | ------------ |
| Lines and statements |            93.49% | 41,130 / 43,993 | Pass         |
| Branches             |            93.15% | 11,000 / 11,809 | Pass         |
| Functions            |            86.97% |   2,297 / 2,641 | Below target |

At the current denominator, 80 additional measured functions need coverage to reach 90%.

## Organization and People & Access follow-up

Seven component tests cover client-scoped role assignment, project creation under a selected client, branch archive preview, reporting navigation, project moves, profile deactivation preview, inactive employee template controls, and effective-access identity validation. All 629 web tests and web typecheck passed. Combined coverage uses the 70 passing browser cases for the same production source hash.

| Web metric           | Combined coverage | Covered / total | 90% gate     |
| -------------------- | ----------------: | --------------: | ------------ |
| Lines and statements |            93.54% | 41,151 / 43,993 | Pass         |
| Branches             |            93.18% | 11,024 / 11,831 | Pass         |
| Functions            |            87.32% |   2,306 / 2,641 | Below target |

At the current denominator, 71 additional measured functions need coverage to reach 90%.

## 90% coverage gate follow-up

Sixteen additional web tests and an expanded skill-claim journey cover demo-session verification and recovery, team analytics, published-skill lookups, handover navigation, catalogue and credential filters, organization zoom, request recipients and drafts, and browser theme preferences. All 645 web tests and web typecheck passed. Combined coverage reuses the 70 passing browser cases for the identical application source hash. This batch changed test and report files.

| Web metric           | Combined coverage | Covered / total | 90% gate |
| -------------------- | ----------------: | --------------: | -------- |
| Lines and statements |            94.21% | 41,445 / 43,993 | Pass     |
| Branches             |            93.52% | 11,259 / 12,039 | Pass     |
| Functions            |            90.08% |   2,388 / 2,651 | Pass     |

The measured covered function count increased from 2,306 to 2,388. The gate passed for both web and API.

## Access recovery and review edge cases

Nine web tests cover retrying a failed selected-person read, missing preview receipts, unconfirmed saves, person-scoped audit denial and retry, review queue and team navigation, project deactivation preview, and organization preview cancellation and revision reload. The selected-person regression reproduced a missing retry after a failed read. Reselecting that person now issues a fresh read.

All 654 web tests and 70 freshly run desktop and mobile browser tests passed. Web typecheck and the API and web coverage gates passed.

| Web metric           | Combined coverage | Covered / total | Uncovered |
| -------------------- | ----------------: | --------------: | --------: |
| Lines and statements |            94.28% | 41,477 / 43,994 |     2,517 |
| Branches             |            93.58% | 11,305 / 12,081 |       776 |
| Functions            |            90.53% |   2,400 / 2,651 |       251 |
