# Fresh bug audit — 16 October 2026

Reviewed baseline: `27ed59a` (runtime repairs in `e0fa9a3`). The approved Access Management baseline was read. This audit made no application fixes, access changes, production mutations or deployment. Findings below were reproduced locally against actual source handlers/services with synthetic data; they are not a new hosted E2E acceptance run.

## 1. [P2] Show more skills repeatedly reloads the first page

Locations: `apps/web/src/capabilities/CapabilityComposer.tsx:219`, catalogue response handler around 536–550, and Show more handler at 1381.

`loadedCataloguePage` starts at zero and is reset on search, but is never advanced after a successful catalogue response. Show more computes its next page from this ref rather than the successful page. The extra attempt counter causes another fetch, so the operation appears to run; it requests page 1 again and replaces the existing options. Users cannot browse beyond the first 12 matches through Show all → Show more, though searching for a narrower name can work around it.

Source-executed reproduction: a synthetic catalogue contains 36 skills, 12 per page. Initial load followed by two Show more clicks requested `[1, 1, 1]`; only 12 skills remained visible. Expected pages are `[1, 2, 3]` with 36 unique choices. The fixture executes the actual catalogue effect and next-page statements, rather than a rewritten implementation.

Repair: advance the successfully loaded page only on a current successful response, retain it after failure, reset it with the search term, and cover repeated loading and retry.

## 2. [P2] AI autofill loses an explicit non-expiring credential

Locations: `apps/api/src/modules/ai/certificate-autofill.ts:114`; client merge in `apps/web/src/capabilities/CapabilityComposer.tsx:601–605`.

The extraction contract permits `expiryDate: null`, while the form uses null to mean Does not expire and an empty string to mean incomplete/unknown expiry. The service sends every non-date value, including null, through a blank-string fallback. Independently, the client merge filters out null values. A correctly extracted non-expiring certificate therefore leaves the expiry incomplete; if an expiry was already filled, the old date survives the autofill instead of switching to Does not expire.

Reproduction used the real `CertificateAutofillService` with authorized synthetic access and a synthetic provider returning a lifetime credential with `expiryDate: null`. The service returned `expiryDate: ""`. Source inspection confirms that even preserving null on the server alone would still be discarded by the form merge.

Repair: preserve explicit null independently of unknown/malformed date values, accept null for the expiry field in the client merge, and test both a blank form and replacement of a previously entered expiry. Continue requiring human confirmation; unknown expiry must not be inferred to mean non-expiring.

## 3. [P2] Reopening the same notification destination does not reopen its dialog

Locations: `apps/web/src/capabilities/CapabilitySubmissions.tsx:72–79` and modal close handlers; equivalent consumed-target guard and close path in `apps/web/src/capabilities/SkillCertificates.tsx:156–177`.

The first submission/certificate/renewal deep link is stored in `consumed.current`. Closing the dialog clears its open state but neither consumes/removes the route parameter nor resets the guard for a new navigation. Clicking the same notification while remaining in the mounted workspace therefore does nothing. Retrying after a failed certificate read has the same problem for that target. A complete remount or another target can work around it.

Source-executed reproduction ran the actual submission-target effect for a valid completed submission, closed its open state, then invoked it for the same destination again. Two destination attempts produced one dialog open. The same guard is present for record/certification/renewal targets. The form of this test forces the effect to run again, so the consumed guard blocks even when React does process a new navigation; unchanged search dependencies can prevent a rerun as well.

Repair: handle explicit navigation attempts independently of “already processed in this render” protection. Remove the handled query parameter on close or track navigation identity, including read failures and repeated identical links; avoid immediately reopening a dialog just because its open state changed.

## 4. [P2] A failed reconciliation read unlocks an uncertain submission

Location: `apps/web/src/capabilities/CapabilityComposer.tsx:875–896`.

After an uncertain save/upload, `recovery` correctly blocks further edits/writes until Check saved submission reads the record. However, the catch branch clears recovery for every read failure, including service/network failures. The read has established neither that the initial write failed nor what revisions/files actually committed. Controls become writable again and the dedicated reconciliation action disappears. A subsequent save can use stale revisions and return another conflict instead of resolving the uncertain operation.

Source-executed reproduction started with recovery enabled and made the authenticated status read fail with a simulated 503. The handler finished with `recovery=false`. Server revision checks still exist: this audit does **not** demonstrate duplicate committed records or an authorization bypass.

Repair: keep reconciliation active after transient/ambiguous reads and retain an explicit retry action. Only a conclusive, authorized result should allow the appropriate transition; handle a verified nonexistent initial draft separately from an unavailable read.

## Verification and scope

- Ignored local fixture: `.local/bug-audit-20261016.ts`; output: `.local/bug-audit-20261016-results.json`.
- Existing focused regression suites pass: six API tests and eleven web tests. They cover adjacent validation, catalogue suggestions, saved-file recovery/autofill and bootstrap, but miss the four scenarios above.
- The initial ad hoc web invocation omitted the web test tsconfig and failed on JSX setup. The documented web tsconfig invocation passed; that harness error is not an application finding.
- Additional source inspection covered renewal lineage/current projections, linked reads, chunked uploads, notifications, AI context, Analytics matching/export and access administration. No new authorization bypass was confirmed in those inspected paths; this is not exhaustive security assurance.
- Already documented native before-unload/browser coverage, retention, hosting/SSO and scheduler boundaries are not counted as new findings.

Suggested repair order: catalogue pagination, uncertain-save reconciliation, repeated notification destinations, then the nullable expiry autofill contract. Add focused regressions and verify the affected UI flows before a separate repair release.

## Repairs completed locally — 16 October 2026

After the user requested repairs, all four findings were fixed:

- Successful, current catalogue responses advance the loaded page. Failed pages remain retryable; cancelled earlier searches cannot alter the new search's page or results.
- Uncertain-save reconciliation remains locked after transient errors, denied reads and malformed/unknown statuses. A confirmed 404 permits a fresh retry only for a new submission with no previously confirmed revision. A known saved draft remains locked if missing. Reads have a synchronous single-flight guard and cancellation/unmount checks; a confirmed DRAFT restores the snapshot, while confirmed submitted/completed states close the editor without replaying a mutation.
- Submission, certificate and renewal deep links are processed once per React Router navigation identity, instead of once per target for the lifetime of the component. Repeated notification navigation can reopen a closed dialog; background data refresh does not reopen it automatically.
- Certificate extraction preserves explicit non-expiring null values, and the client applies them to the expiry field even when an old expiry was entered. Unknown/malformed expiry remains distinct. The extraction instructions reserve null for explicitly non-expiring credentials; renewal issuer/family preservation is unchanged.

Regression coverage executes the current catalogue effect, next-page/search handlers, reconciliation handler and notification-target effects with controlled responses. It includes page failure/retry, stale-search cancellation, ambiguous reads, initial-versus-known 404, concurrent reconciliation, completed state, repeated identical links and null/date/unknown autofill. The API extraction test uses the real service with synthetic provider output. No real provider, database or production record is needed.

Verification passed: **554 tests (6 architecture + 322 API + 226 web)**, typecheck, API/web build, generated-document freshness, changed-file formatting and whitespace checks. No database migration or authority grant is required. These repairs are local; no push, deployment or fresh hosted E2E is claimed in this repair step. Ignored logs: `.local/bug-fixes-tests-20261016.log`, `.local/bug-fixes-typecheck-20261016.log`, `.local/bug-fixes-build-20261016.log`.
