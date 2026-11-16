# Current company operations — 16 November 2026

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
| SSO          | Backend OIDC authorization-code + PKCE, verified ID token, `@soprasteria.com` restriction, opaque HttpOnly app session, silent SSO attempt and interactive fallback are implemented. Operator reports hosted login, automatic SSO and logout working in normal Edge. Exact deployed source hash and each employee's effective access remain unverified independently. |
| AI           | Azure `gpt-6-luna`, Responses API, managed identity, low reasoning. User reports hosted AI/associated workflows working. Gemini runtime/configuration removed.                                                 |
| Files        | `STORAGE_IS_SQL=true`, per-file registry with retained Blob adapter. Four reviewed SQL test files included in cutover. Ongoing retention and recovery drills remain separate.                                  |
| KT           | Keep `KNOWLEDGE_TRANSFER_ENABLED=true` by explicit user instruction. Authenticated, source-generated guide; no employee record reads or business execution tools.                                              |
| Verification | Latest runtime: 630 checks (7 architecture/packaging, 365 API, 258 web), typecheck and builds passed. Operational SQL passed Microsoft T-SQL 160 syntax checks; no agent company SQL execution is claimed.     |

## Identity and access

Latest test/release follow-up: see [complete-inventory coverage](TEST_COVERAGE_2026-11-05.md). UI review commits are integrated; 22 local synthetic Chromium desktop/mobile E2E cases and 8 nonmutating hosted HTTP checks passed. Full-source frontend line coverage increased from 20.57% to 33.07%. Existing isolated SQL connectivity failed, leaving 39 SQL-backed suites blocked. This does not supersede the real-company identity/access acceptance boundary above. KT stays enabled.

By explicit user choice, the existing **GatePass India** registration is temporarily shared in tenant `8b87af7d-8647-4dc7-8df4-5f69a2011bb5`; the Web and API client ID settings both currently use `431d86d8-4a51-4dda-a821-8d0d66a83eb7`. Current Skill Management hosted authentication is backend OIDC, not MSAL SPA or SAML. It uses Web redirects `/api/auth/callback` and `/api/auth/signed-out`, `ENTRA_WEB_CLIENT_SECRET` server-side, `PUBLIC_APP_ORIGIN`, and `SERVE_WEB=true`. Preserve other GatePass URLs and permissions; do not remove its existing SPA redirect or alter shared settings without the registration owner's review.

The operator reports successful automatic SSO, interactive sign-in fallback and sign-out in a normal Edge profile after deployment. Automatic sign-in is attempted with OIDC `prompt=none` and a remembered `login_hint`; Entra may still require interaction under account/session/Conditional Access state. Sign-out revokes the app session and starts OIDC RP-initiated logout. This is not SAML SLO and no Entra front-channel logout handler exists. The app login-hint cookie is retained after sign-out, but is only a hint; Microsoft logout can make the next silent attempt fail. See [current SSO guide](REAL_USER_SSO.md).

Runtime authentication uses a verified tenant/object ID and an active employee binding. The verified `preferred_username` must be `@soprasteria.com`, but email/UPN is not the runtime identity key or authorization. This login uses no Microsoft Graph call and requires no Graph `User.Read` permission. No automatic first-login email linking, custom employee-ID claim, HR sync or in-app binding approval is implemented.

The explicit initial Admin has no manager; the designated Manager reports to the Admin; the other 18 report to that Manager. Identity binding preserves roles/reporting. The requested capability-lead **two-project view/export-only** grant remains pending; do not substitute the broader Business Operations bundle. Current direct-manager, exact assigned-reviewer, active-status, workflow-state and no-self-review checks remain mandatory.

## Configuration

- `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_WEB_CLIENT_ID`, server-only `ENTRA_WEB_CLIENT_SECRET`, `PUBLIC_APP_ORIGIN` (exact HTTPS origin, no trailing slash), `SERVE_WEB=true` and `HOST=0.0.0.0` configure backend OIDC and same-origin sessions. Never expose the secret to the web bundle.
- The operator selected a 24-month client-secret expiry. Keep the actual expiry in the approved secret inventory/calendar and rotate well before it; do not store the secret value or secret ID in repository documentation.
- `HOSTED_DEMO_LOGIN=false`, `DEV_DIRECT_LOGIN=false`; remove old demo access-code/session-secret settings. The server rejects Entra combined with temporary demo login.
- Keep existing account, restricted managed-identity SQL/AI, SQL storage and same-origin hosting settings. Merge partial settings files; do not overwrite unrelated settings.
- Keep `KNOWLEDGE_TRANSFER_ENABLED=true`; retiring KT requires a later instruction.
- Deploy API/web together using the allowlisted source ZIP and remote build. A package hash is not independent evidence of deployed runtime identity.

## Application logs

The API writes structured JSON diagnostics to stdout/stderr: one completion record per HTTP request (request ID, route template, status, elapsed time, and database phase counts/timings); state-changing API calls are logged as `app.action` with success/denied/rejected/failed outcome. OIDC/session, AI usage, database failure, and server lifecycle events are also logged. The web client reports uncaught JavaScript errors, unhandled promise rejections, React render failures, and allowlisted notification actions (open/close/refresh/item-open/read/unread/filter) to the API. Client reports are same-origin and rate-limited. `APP_LOG_LEVEL` controls verbosity (`info` by default); `HTTP_TIMING_ENABLED=false` disables database phase timing only. Logs omit query strings, bodies, tokens, credentials, names, email/UPN, employee/person/object IDs, prompts, browser URLs, notification IDs, messages, and stack traces. Successful data mutations continue to be attributed with before/after details in the existing SQL activity/audit records; diagnostic logs supplement those records rather than replace them.

For Azure App Service, enable **Monitoring → App Service logs → Application logging (File System)**, then open **Monitoring → Log stream** to view stdout/stderr. The code does not enable this Azure resource setting. File-system logging is operational/temporary; configure Azure Monitor diagnostic settings to Log Analytics or another approved destination if logs need durable retention, alerting, or cross-instance search. Do not copy secrets, employee exports, or identity data into log messages.

See [SSO/provisioning](REAL_USER_SSO.md), [cutover history](REAL_USER_CUTOVER.md), [Azure AI](AZURE_AI_FOUNDRY.md) and [approved policy](ACCESS_MODEL_REDESIGN.md).

## Setup audit and remaining work

The bulk binding template is DBA-only: preview, review the exact mapping/revision, recheck in a serializable transaction, bind inactive/unbound employees and audit. Exact active bindings are preserved; conflicts/deactivated identities abort. Roles/scopes/reporting are not broadened. `OperationsIdentityBindingAudit` records the real SQL operator and before/after; `OperationsRealUserCutover` retains cutover audit/source provenance. These setup-only tables are not application migrations and are absent from the migration-generated schema explorer. No runtime table grants were added.

Keep employee-specific exports/JSON/SQL, secrets and logs ignored. Superseded artifacts belong in an ignored archive, not the active deployment folder. Preserve backups/provenance; do not delete audit archives or blindly rerun initial bootstrap.

Next acceptance: capture final bulk result, verify Admin/Manager/employee workspace access and revocation, implement/verify limited lead access, and exercise hosted file/AI flows under real policy. Lifecycle/deprovisioning automation, directory synchronization, scheduler ownership, monitoring, load/fault tests, scanning/retention and coordinated restore remain separate work. A successful sign-in does not establish these.
