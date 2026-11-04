# Real-user cutover preparation — 4 November 2026

Status updated 5 November 2026: the user supplied a successful COMMITTED result at revision 76, confirming reviewed dummy/test cleanup and import of 20 inactive profiles, two projects and 19 manager edges. Microsoft sign-in was subsequently observed and the user reports completing bulk identity binding. Final binding result/revision and per-user effective access acceptance remain unverified independently. **Do not replay cleanup.** Read [current operations](CURRENT_OPERATIONS.md) and [bulk provisioning](REAL_USER_SSO.md).

The preparation/next-step sections below are historical records of the reviewed operation, not instructions to repeat it. Keep source/audit provenance; do not silently delete archived history.

## Company snapshot received — 5 November 2026

The supplied company inventory is revision 75, schema 087: 16 unbound legacy demo/test people, three test skills, two test credential definitions and two test providers. Four registered private files are SQL-backed (6,294,866 bytes); no external Blob deletion is implied. There are 74 AccessAudit entries and one legacy AuditEvent. The reviewed identities, counts and full table fingerprints are embedded only in the ignored generated SQL.

`scripts/prepare-real-user-cutover.py` generates `02-company-cleanup-import.sql` from the roster and supplied snapshot. The default is read-only preview. It checks the exact company server/database/tenant, schema, workspace revision and every account table count/fingerprint inside a serializable transaction. Any changed data or added account table aborts; refresh/review the inventory instead of bypassing the check. Foreign-key deletion order comes from the installed schema, with row-count checks, constraints enabled and transactional rollback on failure.

The apply path removes reviewed old runtime data and imports 20 fresh inactive profiles, 19 reporting edges, two projects and 20 project memberships. It preserves Account, AccessWorkspace, AccessRuntimeAccount, migrations and global system/framework definitions. Daily demo AI usage counters are retired with other test activity. Only the explicit initial Admin responsibility is staged; the inactive profile cannot use it. The requested lead view/export restrictions remain pending implementation/verification; the broad Business Operations bundle is not assigned. This is deliberately incomplete lead activation, not a claim of implemented read-only scope support.

Before apply, stop the hosted app and retain a recoverable company backup; confirm those completed steps using the script's two flags and then set `@apply=1`. Applying retires the only working demo administrator: keep maintenance in place until real SSO and verified initial-admin identity binding are installed. This preparation does not provide an authentication recovery endpoint or activate identities.

Historical audit rows, old actor identities, organization relationships and all old responsibilities/templates/overrides are retained in the setup-only `dbo.OperationsRealUserCutover` archive with original SQL operator, timestamp, reviewed snapshot and employee source manifest (including email/location/client and pending access intent). No application/runtime permission is granted to this table. Old audit entries leave active application tables to remove their person foreign keys; they are not silently discarded or attributed to the new administrator. Existing unsupported grants are explicitly shown in preview and archived before retirement. This archive is not a full backup and cannot restore deleted private bytes. It is a setup record, not an installed application migration or an SSO directory implementation.

Validation: synthetic generator guard tests and Microsoft T-SQL 160 parser checks are local only. No company SQL execution or end-to-end transaction validation is claimed. The next user action is running the default preview and reviewing its results; a preview result is not a committed import.

The supplied workbook has 20 distinct employee codes, 20 distinct work emails and two project names. Employee Code is the import reconciliation key; display-name similarity to demo users must not move their histories/grants to real employees. Assignment Location and Client/Account Name are source facts, not organization placement or authorization scope grants. Preserve these fields for the subsequent directory/SSO mapping rather than silently discarding or treating the client account as the application's tenant/workspace.

Explicit user instructions establish this reporting/access intent:

- Initial administrator: the explicitly designated employee, identified by exact employee code in the ignored preview.
- Manager: the explicitly designated manager, reporting to the initial administrator.
- Other 18 listed employees report directly to that manager. The initial administrator has no manager.
- Capability lead: the explicitly designated employee, with requested Business Analytics view/export confined to the two workbook projects.

Project membership is separate from reporting and responsibility scope. There is no automatic promotion from the source job title or the phrase Capability Lead. The existing Business Operations bundle includes additional actions; a request for only view/export must not silently receive that broader bundle. Preview the actually implemented capabilities before assigning responsibility or implement and verify the narrower capability contract separately.

## Prepared artifacts

`scripts/prepare-real-users.py` validates the source and writes an ignored account-bound JSON preview. It rejects duplicate employee codes/emails, missing identities, unexpected populated columns and formulas. It preserves supplied spelling/casing, project, email, client and location. Deterministic fresh real-person IDs are independent of old demo IDs. The preview records the workbook SHA-256, exact reporting edges, requested responsibility scopes and pending Entra identity bindings. It does not connect to a database or grant access.

The prepared source is under ignored `artifacts/real-user-cutover-2026-11-04/`; employee data must not be committed to source control or copied into personal hosting/databases. The original workbook is unchanged.

## Next read-only company database preview

Run [the inventory SQL](../database/operations/real-user-cutover-preview.sql) through the existing approved company SQL connection (for example SSMS). It targets database `SS-SkillMgmtApp-SQL-Dev`, tenant `8b87af7d-8647-4dc7-8df4-5f69a2011bb5`, account `0abd9bd3-7a7e-47b2-bea2-efbb86110cfa`. It does not use the local personal SQL configuration and does not require a developer CLI login.

The SQL has no permanent mutations. It returns table counts/fingerprints, current identities, scope responsibilities, private-file provider totals and person foreign-key dependencies. Binary contents are hashed internally and never exported. Its temporary inventory and short serializable read transaction obtain a consistent review snapshot; execute during a quiet period. The actual server/account/schema must match before a mutation script is prepared.

Use that snapshot to prepare the exact dummy-data deletion and roster import. Review unknown identities, catalogue amendments/test masters, grants, workflow history, AI conversations, evidence/certificate files and their dependencies. Demo names/prefixes alone are not sufficient deletion criteria. Retain genuine approved catalogue masters, company account, migrations, restricted SQL principal/runtime bindings and service configuration. Audit actor foreign keys require an explicit historical-audit retention/archival treatment rather than blindly deleting referenced people or disabling constraints. Retained Azure Blob objects require their own exact object manifest if present; SQL deletion alone is not a physical Blob deletion.

Any execution must bind the exact target, source hash and reviewed inventory, recheck under the transaction, audit the operator/change and validate resulting row counts and foreign keys. Do not truncate the database or disable all constraints. Preserve a recoverable pre-cutover backup before irreversible deletion.

## Identity transition

Microsoft company users already have an Entra object ID even if it is absent from the workbook. A company administrator may export the directory mapping, or a subsequent sign-in flow may capture `tid`/`oid` from the validated API access token and stage an explicit employee identity-binding request. Email/name matching is a reconciliation hint, not authentication or authorization. Do not automatically attach privileged access from `preferred_username`, display name or a typed email.

Profiles can be imported inactive/pending until verified identity binding and real SSO are ready. Do not make unmapped real employees active while temporary demo login is enabled: the old demo selector permits active unbound people. The initial real administrator's verified binding and usable access must be ready before retiring the only working administrator unless a reviewed maintenance/setup recovery path is explicitly selected. Authentication is the next requested increment, not implemented by this document.

The user reports hosted Azure AI and its tool/learning/file flows working; that report does not grant this local process company SQL administrative access. Company cutover execution remains separate from source/artifact preparation.
