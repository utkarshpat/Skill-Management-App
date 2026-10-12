# Linked capabilities — implementation and release record

The approved workflow supports skills without certificates and many-to-many links between an employee's skill claims and certification records. New or editable certifications require at least one owned, published-catalogue skill before submission. Historical submitted/approved credentials retain their existing review history.

## Employee workflow

The common Add capabilities dialog starts with certificate / no certificate, then one details page and review. Certificate cards use collapsible sections, upload/preview on the left and all credential details on the right. Related skills are canonical catalogue chips; they are not free-text tags. Each new skill still requires its own proficiency and experience. Existing reviewed records can be reused without another approval or duplicate upload.

Incomplete private drafts store bounded form data independently of real claims, including authenticated private staged files. Completing a draft materializes valid records and transfers its file metadata transactionally without copying Blob bytes. Save/recovery uses a stable submission ID plus expected group and item revisions. File uploads remain separate operations: a failed upload preserves a draft and must not appear as successful submission.

New certificates accept the existing validated PDF, JPEG/PNG/WebP, DOCX and UTF-8 text formats up to 5 MB. Images normalize/compress to WebP. Certificate files are mandatory for new submission, while incomplete drafts may be missing a file. Previously reviewed certificates reuse their saved file. Supporting skill image uploads remain available after saving a real skill draft.

## Review and authorization

One combined request is assigned to the exact current direct manager. Each new skill and credential has its own decision and feedback; all decisions commit together. Grouped items cannot be submitted/reviewed independently through legacy endpoints. Current account/person activity, explicit DENY, required permissions, current reporting chain, assigned reviewer, submitted state and no-self-review remain mandatory. Manager changes require the owner to explicitly reroute the complete request.

Submission snapshots preserve credential/skill details, relationship mapping, attachment metadata and decisions. Later corrections do not rewrite a previous review. Draft links are private; submitted links are published. Linking already approved records produces LINKED status, not a new manager approval.

Business Analytics retains migration 070's exact submitted-file scope; relationship counts operate over existing individual records and do not multiply skill/certificate totals. A linked or approved certificate never automatically proves proficiency or current validity.

## AI assistance

Explicit AI autofill sends the selected file to the configured provider. Gemini supports image/PDF parts; DOCX/text use bounded extracted text. Other providers return a manual-entry fallback for unsupported binary extraction. Suggestions are bounded to current published skill and active credential/provider catalogue candidates, rechecked before delivery and confirmed by the user. No automatic proficiency, employee identity, approval, expiry assumption or catalogue amendment is generated. AI read tools return compact own/assigned group progress without uploaded file contents.

## Release checks

Migration 071 includes schema, authorization, transactional workflow, private file staging, notifications and own/manager/Business read projections. Migration 065's scheduler remains deferred for organization hosting. Migrations 071 and 072 are installed on `skill-management-dev`, which also backs the current hosted demo. Commits 2f5f898, fe8b224 and c0f4ae7 were pushed to main and Vercel reported successful deployments; final label/field styling is released with this verification record.

Validation: 6 architecture tests, 293 API tests and 177 frontend tests passed (476 total), plus typechecks, generated-document checks and builds. Thirteen rollback SQL scenarios passed: mixed decisions, foreign read denial, stale revision, missing file, missing link, changed manager, incomplete intake with staged file materialization, incomplete decision rejection, immutable correction snapshot, reuse/publication without new approval, standalone submission prevention explicit rerouting and returned legacy credential submission enforcement.

Hosted demo acceptance used clearly marked synthetic data: submission `9c27b423-ecde-42ab-a43f-313b851ddd39` contains two skill claims and one certificate with two links. Private PDF save/resume, snapshot metadata/bytes for the assigned manager, a single combined notification, atomic separate decisions and owner review history passed. Duplicate submission returned 409; an unrelated employee read returned 403. All three acceptance items were returned with explicit synthetic-test feedback, so no real proficiency or credential approval was recorded. Authorized Business Analytics returned one matching certificate row among eight Khushi portfolio records, consistent with the owner portfolio rather than duplicate rows per link.

Actual Gemini PDF extraction returned the printed issuer, issue date, expiry and credential ID and two published skills (Agile/Scrum and AI Evaluation), with no inferred proficiency; unknown category remained blank. Browser testing verified PDF thumbnail/View/Download, private incomplete draft save and the Continue draft action. SQL JSON identifier casing, staged file path compatibility, unsaved-change confirmation visibility and modal heading clipping were found and fixed during acceptance. Follow-up acceptance also fixed absent empty-record arrays in incomplete draft responses and blocked the legacy standalone API from resubmitting returned credentials without the current linked request policy.

Incomplete intake groups/files are owner-private form drafts, not certification records; they are excluded from profile/organization credential totals until valid records are materialized. Real Microsoft SSO/access verification remains intentionally deferred, as previously requested. Scheduler activation and storage-retention cleanup remain separate organization-hosting operations.

## Intake UX refinement, 12 October 2026

The common form now starts directly with certificate upload and explicit AI autofill, with an “Add skill without certificate” action below. There is no separate upload page. Selected canonical skills appear as editable chips inside the search box. Suggestions use a horizontal row and a “Show all” grid. Selecting a skill opens a separate proficiency/experience dialog. Certificate additions sit below the credential cards. Manual filling, incomplete private drafts, many-to-many links and exact current-manager review remain supported.

Migration 073 adds owner-only recoverable submission-draft removal and restoration with revision checks, current effective claim permissions, transactions, audit and repeat-request handling. Removed submissions are hidden from the personal list and cannot be read or submitted until restored. Existing saved profile skills/certificates and their files are retained: this action removes a submission draft, not an approved profile credential. The UI explicitly explains this distinction and offers Undo. Restoring fails if another active submission now uses one of its review items.

Verification: 16 rollback SQL scenarios, including remove/restore, duplicate removal, foreign owner and stale revision. Upload/storage configuration is reported in plain user-facing language. Local storage is unavailable in the current API environment; production attachment upload was verified in the preceding release and this refinement does not alter its byte-handling path.

## Unified Skills portfolio

The user selected a single Skills page, replacing personal Skills/Certifications tabs. Both existing URLs remain compatible entry points. Skills are the primary table; each row expands its related certificates with independent review/validity states and file viewing. The sidebar/header use Skills, with one Add skill action that supports certificates. Private incomplete submission drafts appear above the profile with Continue and icon-only recoverable removal; submitted/history groups are opened through their notification links rather than repeated above the profile table.

A separate certificate renewal summary counts unique certificates once, including credentials linked to several skills. Historical unlinked credentials remain accessible from the summary. Owner-authorized certificate reads, attachments, correction, renewal and recommendation deep links continue to use the existing API checks. No access grant or scope is introduced. AI guidance now describes the unified Skills navigation.

User-authorized demo cleanup: 16 active demo-login people (active and no Entra binding), 7 skill claims, 8 certificates and 2 submissions. A local metadata backup was saved before transactional deletion of their dependent evidence/notification/link metadata. Catalogue and people counts were rechecked unchanged. Access/reporting assignments and audit history were retained; private object bytes are retained for recovery. A single `capability.demo_cleanup` audit records before/after counts. This maintenance action is not an application permission or an automatic migration.

## Compact three-stage intake

The Add skill modal now uses Certificates → Skills → Review. Certificate upload/preview and all credential fields share the first stage, with one accordion card expanded at a time. Adding another certificate expands the new card and collapses the previous one without losing its data. The second stage contains skill selection, individual skill details and certificate-to-skill mapping; the final stage remains review/save.

Issue and expiry dates are adjacent. Explicit 6-month, 1-year and 2-year presets calculate from the issue date using calendar-aware month-end clamping; Does not expire stores null and disables the expiry input. No expiry is inferred by AI or by missing dates. Incomplete draft saving remains available.

Unsaved-change confirmation uses a separate centered modal with Keep editing and Discard. Escape/close keep editing; only Discard closes the intake. Local browser checks verified retained details, a single expanded certificate, 31 January + 6 months = 31 July, no-expiry input disabling, and centered sizing. Frontend typecheck, build and 179 tests passed. Local attachment storage is unavailable in this environment, so no new upload-success claim is made for this check. Manager review navigation unification remains a separate pending change.
