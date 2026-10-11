# Production acceptance — 11 October 2026

Target: https://skill-management-app.vercel.app. This report records hosted testing, separately from earlier localhost and development SQL verification. Implementation through `576bd04` was pushed to `main`; Vercel reported a successful deployment before the final hosted checks.

## Result and boundaries

The exercised personal and current direct-manager workflows passed after the fixes below. All 16 demo identities completed normal production API sign-in and seven authenticated reads each: **112 reads, 99 HTTP 200, 13 expected HTTP 403, zero HTTP 5xx**. The denied reads were Business context discovery for people without amendment/Business responsibility. A manager's amendment context does not grant Business Operations analytics or navigation.

Actual browser workflow testing used Khushi Agarwal and Hemant Navlakha sequentially. Two browser tabs share the same HttpOnly demo cookie, so independent employee and manager browser identities cannot remain signed in simultaneously in this profile. Two independent, legitimate API cookie sessions exercised cross-user concurrency; two actual same-account browser tabs exercised browser synchronization. No authentication bypass, new access grant, or production SQL manipulation was used.

This is not a claim that every production feature is verified. Real Microsoft SSO, authenticated System Admin and scoped Business Operations interactions, actual scheduled expiry delivery, and some secondary workflows remain outside the completed acceptance coverage.

## Hosted workflow coverage

| Flow                          | Evidence                                                                                                                           | Result                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Personal/manager discovery    | 16 production API logins; workspace, profile, effective access, own skills, own certifications, workflow options, Business context | Expected access decisions; no server errors                                 |
| Skill draft and submission    | Browser select/validate, save draft, reopen, submit                                                                                | Passed                                                                      |
| Skill correction and evidence | Manager requests changes; employee edits, uploads compressed PNG, previews and resubmits                                           | Passed                                                                      |
| Skill approval race           | Two concurrent manager API decisions on the same submitted revision                                                                | One HTTP 200, one HTTP 409; APPROVED revision 7                             |
| Skill final view              | Employee browser shows React as Manager reviewed                                                                                   | Passed                                                                      |
| Certification file and wizard | Required validation; PNG upload/preview, draft persistence, submit; PDF replacement and resubmit                                   | Passed                                                                      |
| File limits and download      | File over 5 MB rejected; private PDF downloaded normally                                                                           | Passed                                                                      |
| Certification review race     | Two concurrent manager API approvals                                                                                               | One HTTP 200, one HTTP 403; APPROVED revision 8; no second decision         |
| Certification authorization   | Owner self-review, unrelated person's request and attachment reads                                                                 | Self-review 403; unrelated private reads 404                                |
| Review versus validity        | Existing AZ900 remains Manager reviewed and separately Expired; renewal action visible                                             | Passed; existing record unmodified                                          |
| Renewal draft                 | Prefilled new credential, current issue date, reset attachment/details, TXT upload, save draft                                     | New DRAFT created; original APPROVED revision 8 unchanged                   |
| Credential recommendation     | Manager sends free-form suggestion; employee requests discussion then accepts                                                      | Browser passed; employee and manager API feeds agree on ACCEPTED revision 3 |
| Request                       | Browser create, select recipient, manager start and resolve                                                                        | RESOLVED revision 3; three activity events                                  |
| Request retry idempotency     | Two identical concurrent CREATE retries for the existing synthetic request                                                         | Both 200; revision and event count unchanged                                |
| Incident                      | Browser create and comment; manager API start and resolve; employee browser refresh                                                | RESOLVED revision 4; all four activity events visible                       |
| Same-account browser tabs     | Comment in first tab produces New updates banner in second; Refresh updates shows comment                                          | Passed on deployed synchronization fix                                      |
| Cross-user notifications      | Manager start/resolve produces employee New updates banner; refresh shows final incident timeline                                  | Passed; polling-based, not instantaneous WebSocket delivery                 |
| Learning                      | Browser creates one-task manual plan, schedules calendar, logs one synthetic minute                                                | Calendar task shows Completed; persisted plan revision 2                    |
| AI quiz                       | Production assistant asked for a 10-question networking quiz; browser navigated to question 10                                     | Exactly ten questions rendered                                              |
| Dialog responsiveness         | Skill popup at 800 × 600; keyboard scroll and footer bounds; final certificate popup                                               | Body scrolls and footer remains reachable; expiry label/checkbox aligned    |

PNG, PDF and TXT were exercised through hosted file controls. JPEG, WebP and DOCX have automated validation coverage but were not uploaded during this hosted run. File chooser interaction was tested; an actual pointer drag/drop was not exercised. Renewal submission/approval, request cancellation/reassignment, quiz scoring, all learning recovery variants, catalogue amendment approval and report exports were not exercised in this run.

The manager's hosted catalogue Amendments tab and provider proposal reached the server's Review & confirm preview successfully. Back and Cancel closed it without submitting an amendment or publishing a definition. The fresh manager sidebar included Reviews and Skill catalogue and excluded Business Operations.

Hosted manager skill Team analytics loaded 11 active direct reports, two reviewed claims and two assigned pending reviews. Its Team summary CSV downloaded successfully; the file's scope and counts matched the screen and excluded private drafts. Certification Team analytics showed zero assigned pending credentials after the synthetic approval and explicitly limited its aggregates to current assigned submissions. This extends the coverage table above and supersedes the untested report-export note for the manager Team summary only. Business Operations exports remain separate and unverified.

## Bugs fixed and deployed

1. Personal skill and certification pages did not consume remote notification update events, leaving manager decisions stale. Both now refresh through their existing request cancellation/race protection.
2. Same-account request updates could leave a second tab showing an earlier state. An actor-bound, coalesced BroadcastChannel signal now feeds existing remote-update listeners. It ignores other identities, avoids echo loops, and cleans up subscriptions.
3. Shared dialogs without an external form ID left body controls active during a save. The shared disabled fieldset now covers both dialog variants. Hosted incident submission showed body edit controls disabled while saving.
4. Skill wizard labels still displayed Required/Optional; required fields now use red stars with accessible required semantics.
5. Both draft and submit buttons displayed mutation progress simultaneously. One announced saving/upload status now communicates progress while actions stay disabled.
6. An old page loaded before a deployment failed to fetch a removed hashed certification chunk and displayed workspace recovery. Production now handles Vite's preload-error event with one bounded reload, preserving open dialogs and avoiding offline/reload loops. Explicit manual recovery was verified on the original hosted failure; automatic recovery guards have regression coverage, but automatic recovery across a later deployment was not reproduced live. Vite documents this deployment failure mode and event in its [build guide](https://vite.dev/guide/build).
7. Certification expiry star wrapped separately and the no-expiry checkbox sat above its label. The fixed layout was visually verified on production.

Implementation commits: `110a71f`, `192370d`, `caa642b`, `576bd04`. Earlier development fixes and account verification are documented in `ACCOUNT_WORKSPACE_VERIFICATION_2026-10-11.md`; their local results must not be presented as hosted browser acceptance.

## Regression validation

The final root `npm test` invocation passed **453 tests**: architecture 6, API 278, web 169; zero failures or skips. Root typecheck, architecture check, generated-document check and diff whitespace check passed. The latest web production build passed after implementation changes. Previous development SQL rollback verification passed 17 Business scenarios; those are development database results, not production SQL acceptance.

Notification freshness is adaptive polling, with same-account browser signals for local mutations. Observing successful eventual refresh does not establish a latency SLA or instant delivery guarantee. No measured latency percentile or load-test claim is made.

## Retained synthetic data

Records explicitly identify themselves as synthetic QA, not professional credentials, real incidents or employee proficiency evidence. They remain in the normal audit history and affect demo counts. No irreversible cleanup was performed.

| Synthetic record      | ID                                     | Final state                               |
| --------------------- | -------------------------------------- | ----------------------------------------- |
| React claim           | `6115de71-dcb0-4288-9856-d41fa494de2a` | APPROVED, revision 7                      |
| Production Credential | `3b3650dc-b482-4e1c-8f7a-86dbb5f26b9c` | APPROVED, revision 8                      |
| Renewal draft         | `b14ec564-0b75-463f-ae3c-5e2250e4dfa9` | DRAFT, revision 2                         |
| Suggested Credential  | `126030cf-9901-4cff-98f6-aef6cbf2152f` | ACCEPTED, revision 3                      |
| REQ-101               | `c6d81077-f480-474f-934b-af2247854506` | RESOLVED, revision 3                      |
| INC-102               | `ee08343a-a1ad-48a9-a38f-874c2d02268c` | RESOLVED, revision 4                      |
| Production learning   | `74f9299c-f9a9-4f04-ab67-e24116c4681a` | ACTIVE plan, one completed synthetic task |

The production renewal read does not expose its internal source link. The browser renewal flow and unchanged original were checked; the persisted source-link invariant remains covered by development/automated checks rather than a direct hosted response assertion.

## Remaining acceptance

- A real Microsoft SSO session is needed to exercise the authorized System Admin and Business Operations paths, including access preview/recheck/audit and scoped analytics/exports. Demo identities were not elevated to manufacture access.
- Expiry notifications at 14/10/7/5/3/last-day boundaries need actual production scheduler-run evidence. SQL/automated checks do not prove scheduled hosted delivery.
- Organization directory API integration is still a future integration; current demo acceptance does not validate an external organizational provider.
- Complete the secondary workflows and file/drag-drop variants listed above in a follow-up acceptance pass.

Raw API artifacts and screenshot evidence are kept in ignored `.local` files. Credentials and session cookies are excluded from this report and committed artifacts.
