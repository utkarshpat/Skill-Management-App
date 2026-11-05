# Fresh bug review: round 2 — 10 October 2026

Reviewed the current working tree, including the preceding five local fixes. Those changes and the user edit in `SKILLS_CERTIFICATIONS_REFINEMENT.md` were preserved. This round does not modify application code, permanently apply SQL migrations, activate access, or push/deploy.

## Confirmed findings

### 1. P2 — Expiry reminder renewal links fail the credential lookup

Locations: `apps/web/src/certifications/Certifications.tsx:86–103`; `database/migrations/057_certification_expiry_reminders.sql:85`; `apps/api/src/modules/skills/sql-certification-store.ts:64,159`.

SQL emits the reminder's `renew` UUID in uppercase. Credential DTO IDs are normalized to lowercase, but the renewal effect compares `record.id === renewalId` without normalization. Clicking an actual expiry reminder cannot locate its credential, consumes the query parameter, and shows “credential unavailable” instead of opening renewal.

Evidence: the restricted-runtime SQL fixture produced an actual reminder href with an uppercase UUID. Applying the UI's selection expression to the normalized record failed. Normalize and validate the deep-link identifier before lookup, or canonicalize generated links consistently. Retain authorization and source-state checks.

### 2. P2 — An invalid renewal can suppress the valid source's expiry reminder

Locations: `database/migrations/057_certification_expiry_reminders.sql:36–45,90–92`.

Linking checks ownership, draft/source state and source expiry, but not whether the replacement actually extends validity. A draft with an unrelated name/provider and an expiry before the source's expiry is accepted. Once that linked record is submitted, the reminder query suppresses the source purely because a linked SUBMITTED/APPROVED record exists. An already expired replacement can therefore hide a current source's approaching expiry.

Evidence: the real LinkCertificationRenewal procedure accepted a synthetic already-expired, differently named/issued replacement for a reviewed source expiring in ten days. The real notification procedure returned the source reminder before linkage/state transition and omitted it after the replacement became SUBMITTED. That status transition is simulated by a transactional SQL update; it is not an authenticated manager approval or end-to-end upload/submission test.

Fix direction: define and enforce a renewal relationship and validity-extension contract; require an eligible replacement before suppressing the source's reminder. Do not require exact display-name equality if legitimate issuer/credential renames must be supported; use an explicit continuity policy.

### 3. P2 — Correcting a returned renewal can turn a valid conflict into HTTP 500

Locations: `apps/api/src/modules/skills/sql-certification-store.ts:25–58,79–81`; `database/migrations/057_certification_expiry_reminders.sql:12–14,48–51`; `database/migrations/055_required_certificate_image.sql:83–85`.

A CHANGES_REQUESTED/REJECTED renewal is excluded from the active-renewal unique index, so a second renewal draft may be started for its source. Correcting the original returned record changes its status to DRAFT, colliding with the second active draft. Ordinary SAVE executes through run(), which does not map SQL 2601/2627. The special new-renewal path maps these errors, but a later correction sends no renewedFromId and bypasses that handler. The generic API error handler returns 500 rather than an actionable conflict.

Evidence: the real SQL procedure raised 2601 after a second valid link was created and the earlier returned draft was saved. A store-level failure injection confirmed that the ordinary SAVE path exposes that SQL error unchanged. Define which renewal should remain active and return a conflict explaining the competing renewal; do not silently unlink or overwrite history.

### 4. P2 — HTTP preview gates prevent replay after a committed workflow response is lost

Locations: `apps/api/src/modules/business/routes.ts:168–175,185–197`; SQL replay branches in `database/migrations/061_business_workflows.sql:80–90,97–98,128–136,147–153`.

BusinessWorkflow supports idempotent matching retries, but the HTTP endpoint recomputes the preview against current configuration before reaching SQL. The original successful write increments the workspace revision. A repeated PROPOSE/SAVE_DEMAND request then fails the original-revision check; decision/shortlist receipts also change with current context or amendment details. If the success response is lost, the original request cannot return its saved result even though the SQL replay branch is safe. SQL-only retry tests do not establish HTTP idempotency.

Evidence: a synthetic authenticated HTTP fixture previewed and committed SAVE_DEMAND, advancing the workspace revision. An identical request returned 409 “Configuration changed. Reload before previewing.” The store was called only once, proving that replay never reached persistence. No real network loss was induced.

Fix direction: recover a confirmed prior result using actor-bound intent plus exact payload and fresh execution authorization, before applying stale-preview rejection to a genuinely new mutation. Preserve current DENY, scope and access checks; do not accept stale preview receipts as new-write authorization.

## Verification and limits

- Ignored `apps/api/.local/fresh-audit-next-unit.ts`: two deterministic HTTP/store failure checks passed.
- Ignored `apps/api/.local/fresh-audit-next-sql.ts`: restricted-runtime development SQL checks confirmed the reminder link, invalid replacement/suppression, and competing-renewal conflict; transaction rollback and no-fixture/no-pending-schema cleanup passed.
- SQL setup temporarily applies pending 060–062 inside the fixture transaction. Permanent migrations and activation remain pending.
- These are assertions of current faulty behavior, not maintained regression tests demonstrating fixes. No live Blob mutation, model billing, messages, or authenticated hosted acceptance occurred. This audit does not establish that every repository bug has been found.

## Local fix implementation

All four findings have local fixes. Renewal identifiers are validated/normalized in the UI and reminder SQL. Migration 063 validates continuity/extended current validity during linking, saving, submission and approval; invalid historical replacements do not suppress notifications. Ordinary renewal corrections map unique-index collisions to 409 and invalid continuity to 400. Migration 064 recovers only exact already committed audited commands for the authenticated actor, with fresh SQL authority/scope/deny checks; the HTTP route retains Preview → Recheck → Transaction → Audit for new mutations. Maintained unit/HTTP tests and development-only rollback scenarios verify recovery, altered-payload rejection, actor isolation, renewal validity, reminders and conflicts. Permanent installation and deployment remain pending.
