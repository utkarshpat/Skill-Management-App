# Skills and certifications refinement

The first implemented increment repairs the new Certifications feature. Skills retains its existing published-definition, proficiency and assigned-review behavior. The complete Skills subsystem has not been redesigned or certified bug-free by this increment.

## Implemented in code

- Shared actor/account-bound SQL certification records; no browser persistence fallback.
- Authenticated own portfolio and current assigned direct-manager queue.
- Two-step details/review form, required issuer/date validation, optional credential link/ID/notes, mobile cards, server search and pagination.
- Atomic save-and-submit, explicit rerouting after manager changes, locked submitted/approved details and corrections of returned/rejected records.
- Review notes, saved reviewer/date, immutable audit entries and participant notification links.
- Independent expiry and review status; approval never verifies the issuer or creates skill proficiency.
- No simulated document extraction or issuer lookup. File attachments are explicitly unavailable.

The feature shares existing skill read/claim/review permissions. It does not create automatic grants or expose an organization-wide directory. The approved current-manager selection is recorded in the Access Management baseline.

## Release gate

On 9 October 2026, after user approval, migration 053 was persistently applied to `skill-management-dev` using the separate setup identity. The runner confirmed versions 001–053. All eight rollback SQL scenarios passed before installation and again against installed 053; the latter also verified manager approval through the restricted runtime user without direct certification-table SELECT. Fixture records, permissions and audits were rolled back, and the workspace revision stayed unchanged.

Hosted API/web deployment and authenticated browser acceptance remain pending. Verify the deployed API/web on the same exact commit with owner and manager accounts, including revoked access, reassignment, failed saves and renewals. SQL acceptance and synthetic UI previews do not establish production acceptance. Other target databases must install 053 before the API/web increment.

The old browser store `cil.certifications.v1` is left untouched. It contains no trustworthy owner IDs, actor-bound review audit or account binding. Do not automatically import its verified flags or bundled example records. Any historical import needs a separately reviewed mapping and should create unverified owner drafts.

## Recommended next increments

1. **Connect evidence:** allow a certification to be referenced by an employee's skill claim through a server-validated owner-bound link. Show credential review and validity alongside the skill evidence without changing the skill's proficiency or claim status.
2. **Credential evidence storage:** reuse the private evidence architecture with certification-specific upload/read authorization, immutable submitted snapshots, retention/delete policy and file validation. Add real extraction only as a reviewed draft assist; unknown fields stay unknown.
3. **Unified UX:** consistent draft/submission/feedback language, a combined personal attention view and a manager workbench separating skill proficiency review from credential review. Keep private drafts and personal learning logs excluded.
4. **Renewal/version history:** relate a new credential to an earlier credential through validated ownership and show previous reviews without allowing historical approved facts to be overwritten.
5. **Catalogue mapping and reporting:** optional links to published catalogue skills with version-aware display. Define implemented reporting permission/resource scopes before adding directory exports or department/unit analytics.

Do these as successive tested increments. A shared visual experience should not collapse credential authenticity, expiry, claimed skill level and manager-reviewed proficiency into one badge.
