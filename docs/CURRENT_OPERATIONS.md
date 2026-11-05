# Current company operations — 5 November 2026

This is the current operational entry point. It supersedes old demo/deferred-SSO instructions for this company environment. Historical reports retain their original dates and evidence. Documentation is not enterprise go-live certification.

## Recorded status

Final integration follow-up: [final merge audit](FINAL_MERGE_AUDIT_2026-11-05.md) records the user-authorized main integration, person-first access/review/request corrections and required schema versions 088–090. The user explicitly deferred the 90% coverage target until after this release; CI reports the existing target without blocking this integration. The older checkpoint below retains its original test counts. Company migration installation/backfill and hosted verification remain operator steps; no company SQL changes or live deployment were performed during this audit. Code-first remains on its separate branch.

Local follow-up (not hosted acceptance): hierarchy e37df62 is merged. Portfolio Business Analytics scope/filter increment 089 is implemented and passed rollback SQL checks on a newly created local SQL Express audit database; company SQL remains at the last recorded version until an operator verifies otherwise. The full current unit run passes **864 checks** (8 tooling, 444 API, 412 web), with typechecks/build/docs verification passing. Recovery/practice malformed-response fixes and strict current-source coverage provenance checks are included locally. The separate 90% coverage release gate remains incomplete; older percentages below are historical, not approval to deploy. See [Portfolio scopes](PORTFOLIO_SCOPES_2026-11-05.md) and [coverage status](TEST_COVERAGE_2026-11-05.md).

| Area         | Status / evidence                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting      | Azure Linux App Service `SSSkillmgmtAppWebAppDev`; company sign-in and verified-identity screen observed in a user screenshot. Exact running source hash not independently measured.                           |
| SQL          | `ssskillmgmtappsqlsrvdev.database.windows.net` / `SS-SkillMgmtApp-SQL-Dev`, restricted managed-identity runtime. Supplied inventory confirmed migration 087; 065 is absent.                                    |
| Cutover      | Screenshot confirmed `COMMITTED`, revision 76, 20 inactive real profiles, two projects and 19 manager links. Reviewed demo/test runtime data retired; historical audit/grants archived. Do not replay cleanup. |
| Provisioning | All 20 roster emails exactly matched unique Entra export UPNs/object IDs. User reports completing bulk binding; final result/revision and individual employee access are not independently verified.           |
| SSO          | Signed token verification implemented; hosted verified-identity screen observed. Employee activation and effective access remain separate from sign-in.                                                        |
| AI           | Azure `gpt-6-luna`, Responses API, managed identity, low reasoning. User reports hosted AI/associated workflows working. Gemini runtime/configuration removed.                                                 |
| Files        | `STORAGE_IS_SQL=true`, per-file registry with retained Blob adapter. Four reviewed SQL test files included in cutover. Ongoing retention and recovery drills remain separate.                                  |
| KT           | Keep `KNOWLEDGE_TRANSFER_ENABLED=true` by explicit user instruction. Authenticated, source-generated guide; no employee record reads or business execution tools.                                              |
| Verification | Latest runtime: 630 checks (7 architecture/packaging, 365 API, 258 web), typecheck and builds passed. Operational SQL passed Microsoft T-SQL 160 syntax checks; no agent company SQL execution is claimed.     |

## Identity and access

Latest test/release follow-up: see [complete-inventory coverage](TEST_COVERAGE_2026-11-05.md). UI review commits are integrated; 22 local synthetic Chromium desktop/mobile E2E cases and 8 nonmutating hosted HTTP checks passed. Full-source frontend line coverage increased from 20.57% to 33.07%. Existing isolated SQL connectivity failed, leaving 39 SQL-backed suites blocked. This does not supersede the real-company identity/access acceptance boundary above. KT stays enabled.

By explicit user choice, the existing **GatePass India** registration is temporarily shared. API and Web both use client ID `431d86d8-4a51-4dda-a821-8d0d66a83eb7`, in tenant `8b87af7d-8647-4dc7-8df4-5f69a2011bb5`. The user reports configuring the SPA redirect, `access_as_user` scope/client preauthorization and requested access-token version 2. Preserve the other app's URLs and permissions; shared token-format changes can affect its API consumers.

SPA callback/logout return: `https://ssskillmgmtappwebappdev-dugxhfchcbhsc3gv.uksouth-01.azurewebsites.net/`. No Skill Management front-channel logout handler was added.

Runtime authentication uses verified tenant/object IDs and active employee bindings. Email/UPN is an offline reconciliation key, not runtime authorization. No automatic first-login email linking, custom employee-ID token claim, Graph directory permission, HR sync or in-app binding approval is implemented.

The explicit initial Admin has no manager; the designated Manager reports to the Admin; the other 18 report to that Manager. Identity binding preserves roles/reporting. The requested capability-lead **two-project view/export-only** grant remains pending; do not substitute the broader Business Operations bundle. Current direct-manager, exact assigned-reviewer, active-status, workflow-state and no-self-review checks remain mandatory.

## Configuration

- `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_WEB_CLIENT_ID` configure server/public runtime discovery via `/api/auth/config`; VITE Entra build settings are obsolete.
- `HOSTED_DEMO_LOGIN=false`, `DEV_DIRECT_LOGIN=false`; remove old demo access-code/session-secret settings. The server rejects Entra combined with temporary demo login.
- Keep existing account, restricted managed-identity SQL/AI, SQL storage and same-origin hosting settings. Merge partial settings files; do not overwrite unrelated settings.
- Keep `KNOWLEDGE_TRANSFER_ENABLED=true`; retiring KT requires a later instruction.
- Deploy API/web together using the allowlisted source ZIP and remote build. A package hash is not independent evidence of deployed runtime identity.

See [SSO/provisioning](REAL_USER_SSO.md), [cutover history](REAL_USER_CUTOVER.md), [Azure AI](AZURE_AI_FOUNDRY.md) and [approved policy](ACCESS_MODEL_REDESIGN.md).

## Setup audit and remaining work

The bulk binding template is DBA-only: preview, review the exact mapping/revision, recheck in a serializable transaction, bind inactive/unbound employees and audit. Exact active bindings are preserved; conflicts/deactivated identities abort. Roles/scopes/reporting are not broadened. `OperationsIdentityBindingAudit` records the real SQL operator and before/after; `OperationsRealUserCutover` retains cutover audit/source provenance. These setup-only tables are not application migrations and are absent from the migration-generated schema explorer. No runtime table grants were added.

Keep employee-specific exports/JSON/SQL, secrets and logs ignored. Superseded artifacts belong in an ignored archive, not the active deployment folder. Preserve backups/provenance; do not delete audit archives or blindly rerun initial bootstrap.

Next acceptance: capture final bulk result, verify Admin/Manager/employee workspace access and revocation, implement/verify limited lead access, and exercise hosted file/AI flows under real policy. Lifecycle/deprovisioning automation, directory synchronization, scheduler ownership, monitoring, load/fault tests, scanning/retention and coordinated restore remain separate work. A successful sign-in does not establish these.
