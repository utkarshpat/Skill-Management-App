# Evidence production acceptance — 14 October 2026

Target: `https://skill-management-app.vercel.app`. Runtime release: `3a3f0d8`, following `d628af5`, `be1e5e4` and `0895afe`. Vercel Production deployments and GitHub checks succeeded. Migration 084 was applied to the verified shared `skill-management-dev` database; the installed-schema restricted-runtime rollback fixture passed all six scenarios.

## Confirmed on the hosted application

Tests used independent demo HTTP sessions for the owner, assigned current manager, authorized Delivery Unit Analytics user and unrelated employee. UI checks used the owner demo browser session. This was not Microsoft SSO acceptance or two isolated browser profiles.

Synthetic fixture `QA-EVIDENCE-20261014-db39ca2c` created one supporting credential linked to two distinct skill claims. The labels and feedback explicitly state that these are QA fixtures, not actual qualifications or issuer verification.

| Check | Outcome |
| --- | --- |
| Private certificate PDF intake and two-skill linking | Passed |
| Server-side certificate limit rejects chunked 6 MB PDF | Passed; 400 |
| Ordinary skill PDF evidence above 6 MB | Uploaded through bounded parts; metadata retained and private storage keys hidden |
| Owner PDF download | Exact SHA-256 match, correct PDF MIME and `nosniff` |
| Stale upload revision | Rejected; 409 |
| Unrelated employee access | Rejected; 403 |
| Manager and Analytics access to private draft evidence | Rejected before submission |
| Unified review queue | One request for two skills and one credential |
| Manager notification | Correct request destination |
| Immutable submitted evidence snapshot | Current assigned manager downloaded the complete large PDF |
| Manager review | All three items approved in one request |
| Owner outcome notification | Delivered; actor, item counts and action shown in UI |
| Approved evidence writes | Rejected; 403 |
| Scoped Analytics skill/certificate file viewers | Complete authorized PDF downloads |
| CSV and XLSX reconciliation | New skill and credential present; separate datasets retained |
| Certificate PDF above Vercel's ordinary payload limit but below 5 MB | 4,928,964-byte private intake upload/download passed; test draft discarded through the recoverable workflow, no storage deletion |
| Explicit AI autofill | 4,929,543-byte PDF accepted; printed details extracted, two canonical catalogue skills suggested, no proficiency assignment or automatic approval |
| Notification action and PDF UI | Outcome opened the completed request; all three items, feedback and PDF View/Download actions visible |

Analytics search was exercised using the employee name, matching the UI's employee/code search contract. Skill-name/certificate-name search was not claimed. Notification destinations contain valid uppercase UUIDs; test comparisons normalized UUID case.

## Bugs found and fixed during acceptance

1. **Serverless request/response size:** Vercel rejected a 6 MB ordinary evidence upload before the application could enforce its 10 MB rule. Large file uploads now use sequential authenticated private parts. Every part rechecks edit authority/revision; complete files still undergo validation and transactional authorization. Approved file responses stream after access/snapshot rechecks. Certificate intake, replacement and explicit AI autofill share the bounded transport. No public Blob access or storage URL grant was introduced.
2. **Residual viewer limit:** Submitted snapshot and scoped Analytics download readers still rejected files above 5 MB. Their bounded read limit now accommodates 10 MB skill evidence. Certificate writes remain limited to 5 MB.
3. **Installed-schema verification:** Migration 084's consumer projection update now accepts an already upgraded definition, allowing the rollback fixture to verify the installed schema safely.

Local verification: full architecture/API/web suites passed before release; focused regressions and typecheck/build passed after viewer fixes. GitHub CI passed the final runtime release. Local evidence reports/screenshots are ignored under `.local` and contain no login tokens.

## Remaining operational boundaries

- Ownership verification remains manual manager review; this does not establish issuer authenticity.
- Retention remains dry-run only. No objects were deleted. Actual account-wide storage inventory requires securely configured operator storage access; it was not run in the local environment.
- Notifications use activity-aware polling (90 seconds), refresh on panel opening and relevant events. These checks establish notification delivery and UI refresh, not a WebSocket/push delivery guarantee.
- Company hosting, Microsoft SSO, scheduler activation and an actual coordinated database/file restore drill remain deferred. See [operator runbook](EVIDENCE_READINESS_2026-10-14.md).
