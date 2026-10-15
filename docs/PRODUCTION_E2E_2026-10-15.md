# Production acceptance — 15 October 2026

Target: https://skill-management-app.vercel.app

Release: `e0fa9a38c91c9dade99dd6b81e87bf3b77561a62`. GitHub CI and Vercel production deployment succeeded before testing. This is hosted API lifecycle testing plus browser acceptance, not a claim that every operation was performed through the UI.

## Passed

- Linked intake lifecycle: 18 recorded checks. Private certificate draft, one certificate linked to two skills, 6 MB ordinary PDF evidence, 5 MB certificate limit, download integrity/safety headers, stale revision rejection, duplicate submission rejection, assigned manager snapshots and atomic review, owner notifications, immutable approved evidence, scoped Analytics file reads and CSV/XLSX reconciliation.
- Requests/incidents/learning: 45 recorded checks. Idempotent creates/retries, unauthorized reads, comments, stale transitions, start/resolve, reassignment/cancellation, plan rescheduling/pause/resume/completion/archive, notification feeds.
- Renewal: 10 recorded checks. Original remains current until approval; new credential ID/date/expiry becomes current after approval; original retained as superseded history; Analytics excludes superseded credential from current records; reused reviewed skills do not require another decision.
- Live AI: four conversational turns. Topic clarification, short answer retaining quiz task and exactly three questions, explicit switch to a learning plan, and profile answers checked against actual approved skill records. No AI-created plan was saved.
- Role matrix: Khushi, Hemant, Anupriya and Humayun. Personal APIs accessible; manager review and Analytics dashboard access matched canonical workspace capabilities. Manager amendment discovery can return context without granting Analytics read access.
- Browser employee flow: dashboard Add skill opens unified intake; centered Keep editing/Discard preserves or discards unsaved input correctly; saved PDF restores with preview/View/Download; authenticated saved-file AI autofill shows a busy state and fills printed details without re-upload; missing category stays blank; Network Security suggestion uses the catalogue; four-level proficiency requires user selection; selected suggestion is not duplicated; blank experience description submits successfully.
- Browser manager flow: dashboard review link opens the correct combined request; two decisions and certificate preview appear; saving without feedback is blocked; after feedback, both decisions save and the request leaves the queue. Independent owner API confirms `REVIEWED`, approved skill/certificate, blank description preserved and outcome notification present.
- Employee reopened the completed request in the browser: “Review Completed”, both “Manager reviewed” badges, recorded feedback, and certificate View/Download/first-page preview were present. Screenshot: `.local/e2e-approved-review-20261015.png`.

## Test records and safety

All created records are labelled synthetic QA, not real qualifications or issuer verification. Existing unrelated pending reviews were untouched. Synthetic requests/incidents were closed and the learning plan archived. Approved QA submissions and renewal history remain for traceability; no storage objects were deleted and no access grants changed.

- Linked intake: `5b0ac5f7-30c5-4364-b139-d9e093258fc3`
- Renewal: `5196c3fe-c2af-4126-8e3e-46e03818f835`
- Browser intake/review: `42c13eca-71b1-45c5-9621-e47e04b4a808`

Detailed local journals/scripts are under ignored `.local/`: `e2e-20261015.json`, `automation-hosted-lifecycle-2026-10-15.json`, `e2e-renewal-20261015.json`, `e2e-ai-20261015.json`, `e2e-role-matrix-20261015.json`, and `e2e-ui-final-20261015.json`. Credentials and session cookies are not included in this report.

## Coverage limits

- Browser users were switched sequentially. Separate authenticated HTTP sessions exercised access boundaries; two isolated simultaneous browser profiles were not tested.
- Native before-unload confirmation was not observable in the in-app browser, so that UI check remains unverified. The release's local regression checks cover the guard.
- Production network failure/lost-response injection and maximum-volume export load were not performed. Normal hosted CSV/XLSX exports and chunked 6 MB PDF evidence were verified.
- Real SSO, real-account administration, issuer authenticity and final hosting operations remain deferred. Notifications were verified through feeds/destinations; this does not assert WebSocket delivery.
- Certificate files were staged through authenticated HTTP before browser preview/autofill testing; native file chooser/drag-drop was not exercised in this run.

No confirmed application bug or blocking UI issue was found in the exercised flows. Harness corrections involved UTC issue dates, the certificate size response status, supported decision fields, employee search semantics and manager amendment context versus Analytics access.
