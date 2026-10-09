# Certifications implementation and rollout

## Operational contract

The feature uses authenticated `/api/certifications` endpoints and migration `053_employee_certifications.sql`. Records are account/person-bound SQL resources, not browser storage. No demo approvals, invented employee email, randomized credential metadata or role-name-derived authority is used.

Manual entry is supported. A credential's HTTPS issuer-verification page is required for submission; a current assigned direct manager reviews recipient identity, facts, dates and provenance before approving. Link presence is not automatic issuer validation. AI extraction, vendor metadata fetch, PDF/image uploads and automated expiry reminders are not implemented or advertised as working actions. A credential never changes skill proficiency.

## Provisioning and deployment

1. Review/apply migration 053 through the existing database migration process (`npm run db:migrate -w apps/api`) using the intended environment's setup identity. This migration creates no person or template grants.
2. Configure the existing restricted Azure SQL runtime/account connection. No alternate localStorage or local-file credential store is used; unavailable storage returns an explicit error.
3. Through People & Access, preview and explicitly assign `certification.view` / `certification.manage` with OWN scope to the intended employees. Profile viewing is required. Updated provisioning presets include these as editable, explicit starting fields, but persisted templates are not auto-upgraded.
4. Current active direct managers obtain relationship-derived `certification.verify` eligibility, subject to scoped denies and exact submission assignment. Renaming a role, administering access or managing the skill catalogue does not grant credential review.
5. Assign ORGANIZATION `certification.directory` and, separately, `certification.export` to the intended report viewers through reviewed access changes. Export requires directory access. Capability-specific, unit, department, team and subtree grant scopes remain unavailable.

Apply and verify this in a dedicated test environment before production. No deployment or production migration is performed simply by building this branch.

## Lifecycle and concurrency

- `SAVE`: owner-only create/update of DRAFT, CHANGES_REQUESTED or REJECTED records; valid facts required, issuer link optional until submission.
- `SUBMIT`: owner-only editable record, required issuer link, current eligible manager resolved on the server. Content becomes locked and its exact reviewer is recorded.
- `APPROVED`, `CHANGES_REQUESTED`, `REJECTED`: only current assigned active direct manager, current submitted state, no self-review, expected revision. Changes/rejection require feedback.
- `REROUTE`: owner explicitly routes an unchanged submitted record to a different eligible current manager. Reporting reassignment never silently grants the new manager authority over the old assignment.
- Every write takes the workspace/record lock, rechecks current access and revision, changes one record and atomically appends an immutable full revision snapshot plus AccessAudit.

Employee identity/code and current delivery-unit placement come from trusted account records. Earlier browser-only demo records are neither imported nor silently deleted. They must not be treated as verified enterprise evidence.

Lists are server-paginated (20 records). Mine is owner-bound, queue is assigned/current-direct-report scoped, directory excludes private drafts. All filters, counts and row action eligibility use current server data. Permission/record conflicts fail explicitly instead of showing success.

## Validity and reporting

Current compliance means APPROVED, active employee and an unexpired/lifetime credential. It is recomputed against the current UTC calendar date. Date-only expiry remains valid through that date. Historical approval stays recorded after expiry without counting as current compliance. Expiring-soon counts only compliant dated credentials from today through 90 days inclusive.

No expiry is stored as NULL, not a fabricated 2050 date. CSV uses an empty expiry cell and `Does Not Expire=Yes`. The original twelve report headers are retained, with provider, review status, verified, credential ID and issuer URL appended. Email ID/type remain empty because the authoritative AccessPerson contract supplies neither; another employee's email is never invented.

Export re-queries current SQL scope and the selected search, exact category, delivery unit and compliance filters, ignoring roster pagination. It rejects reports over 5,000 records rather than truncating them. Private drafts never enter organization reports. CSV has UTF-8 BOM, quoting/escaping and leading-formula neutralization. A pending/rejected/expired credential is explicitly distinguishable from current compliant evidence.

## Verification

Focused checks:

```powershell
npm exec -w apps/api -- tsx --test test/certifications.test.ts test/effective-access.test.ts
npm exec -w apps/web -- tsx --tsconfig tsconfig.test.json --test test/certifications.test.tsx
npm run typecheck
npm run build
```

The ordinary tests cover field/URL/date rejection, forged actor/scope inputs, renamed roles, independent grants and denies, exact current reviewer policy, ambiguous reporting, pagination, response validation and CSV disclosure. HTTP fixtures test authenticated binding, changed access and unconfigured storage. SQL-source contract checks are not live SQL execution.

On a **dedicated Azure SQL test database**, after migration 053 is applied and setup authentication is configured:

```powershell
$env:CERTIFICATION_TEST_DATABASE = 'true'
npm run test:certifications -w apps/api
```

The SQL integration runner creates synthetic account fixtures inside transactions and always rolls them back. It requires a setup identity with the existing procedure's account/bootstrap authorization (typically database owner on the dedicated test database). It covers draft privacy, duplicate display names, assigned manager review, expired approval, inclusive UTC expiry, the exact 90-day expiring-soon boundary, no-expiry and inactive-owner compliance, locked states, audit counts, rejected feedback recovery, stale revisions, explicit re-routing, scoped deny, export filters and invalid dates. It must not be pointed at production.
