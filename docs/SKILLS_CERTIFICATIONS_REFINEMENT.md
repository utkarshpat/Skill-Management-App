# Skills and certifications refinement

The first implemented increment repairs the new Certifications feature. Skills retains its existing published-definition, proficiency and assigned-review behavior. The complete Skills subsystem has not been redesigned or certified bug-free by this increment.

## Implemented in code

- Shared actor/account-bound SQL certification records; no browser persistence fallback.
- Authenticated own portfolio and current assigned direct-manager queue.
- Two-step details/review form, required issuer/date validation, optional credential link/ID/notes, mobile cards, server search and pagination.
- Atomic save-and-submit, explicit rerouting after manager changes, locked submitted/approved details and corrections of returned/rejected records.
- Review notes, saved reviewer/date, immutable audit entries and participant notification links.
- Independent expiry and review status; approval never verifies the issuer or creates skill proficiency.
- Migration 057 adds owner-only in-app reminders exactly 14, 10, 7, 5, 3 and 0 UTC days before an approved credential expires. Reminder IDs are stable per credential/stage and use the existing notification feed; there is no email or push delivery. The 90-second active notification refresh picks up a newly due reminder, and opening Notifications fetches it on demand.
- A reminder's **Record renewal** action opens a prefilled draft with current credential identity and a new issue date; the owner enters the renewed expiry and attaches the new certificate. Renewal links are owner-checked and audited. The approved source remains immutable, and its reminders stop once the linked renewal is submitted or approved. Rejected/returned renewals do not suppress reminders.
- No simulated document extraction or issuer lookup. One private certificate attachment is required to submit: PDF, JPEG/PNG/WebP, DOCX or UTF-8 text up to 5 MB. Images are normalized to WebP; the server checks file signatures and retains non-image files as private downloads.
- Unified personal sidebar entry **Capabilities**, with permission-gated Skills and Certifications tabs. Existing portfolio URLs and their claim deep links remain valid.
- Certification portfolio uses the Skills profile's shared metric, table, filter, pagination and overview styles. Total/review/pending/draft metrics and review distribution use every authorized certification page, not only the first 25 records. Search, category, review status, validity and To complete/Reviewed views filter the loaded portfolio. Renewal attention keeps expiry independent of manager approval. Credential details and saved feedback open in a read-only dialog; edit/submit/review controls still come from each server record. Multi-page loading rejects changed totals, duplicate IDs and incomplete results; these reads are independently authorized pages, not one atomic SQL snapshot.
- **Reviews** has two clear destinations: Skills retains its review queue, history, team analytics and skill recommendations; Certifications has its own review queue, certification analytics and free-form credential recommendations. Certification analytics aggregates only submissions currently assigned to the authenticated manager and labels validity separately from review. Credential recommendations go only to current active direct reports under the existing recommendation access contract; an employee may accept, decline or ask to discuss. Accepting a suggestion does not create, approve or verify a certification record. Credential decisions and skill decisions retain separate forms and execution-time checks.

The feature shares existing skill read/claim/review permissions. It does not create automatic grants or expose an organization-wide directory. The approved current-manager selection is recorded in the Access Management baseline.

## Release gate

On 9 October 2026, after user approval, migration 053 was persistently applied to `skill-management-dev` using the separate setup identity. The runner confirmed versions 001–053. All eight rollback SQL scenarios passed before installation and again against installed 053; the latter also verified manager approval through the restricted runtime user without direct certification-table SELECT. Fixture records, permissions and audits were rolled back, and the workspace revision stayed unchanged.

Migrations 054–056 are installed on `skill-management-dev`; migrations 057–058 and authenticated hosted acceptance remain pending. Verify the deployed API/web on the same exact commit with owner, recipient and manager accounts, including revoked access, reassignment, failed saves, renewal creation/submission and recommendation response. SQL acceptance and synthetic UI previews do not establish production acceptance. Other target databases must install migrations 053–058 before enabling these changes.

The old browser store `cil.certifications.v1` is left untouched. It contains no trustworthy owner IDs, actor-bound review audit or account binding. Do not automatically import its verified flags or bundled example records. Any historical import needs a separately reviewed mapping and should create unverified owner drafts.

## Recommended next increments

1. **Connect evidence:** allow a certification to be referenced by an employee's skill claim through a server-validated owner-bound link. Show credential review and validity alongside the skill evidence without changing the skill's proficiency or claim status.
2. **Credential evidence follow-up:** one private certificate attachment, replacement/removal, server file validation, submitted-state locks and date-based renewal reminders are implemented across migrations 054–057. Finish retention cleanup, authenticated hosted acceptance and operational scanning. Add real extraction only as a reviewed draft assist; unknown fields stay unknown.
3. **Further unified UX:** extend the portfolio navigation with a personal attention view and add globally ordered server pagination if needed. Keep private drafts and personal learning logs excluded; preserve separate skill proficiency and credential review semantics.
4. **Catalogue mapping and reporting:** optional links to published catalogue skills with version-aware display. Define implemented reporting permission/resource scopes before adding directory exports or department/unit analytics.

Do these as successive tested increments. A shared visual experience should not collapse credential authenticity, expiry, claimed skill level and manager-reviewed proficiency into one badge.
