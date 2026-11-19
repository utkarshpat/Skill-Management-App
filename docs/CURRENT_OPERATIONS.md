# Current company operations — 20 November 2026

This is the current operational entry point. It supersedes old demo/deferred-SSO instructions for this company environment. Historical reports retain their original dates and evidence. Documentation is not enterprise go-live certification.

## Release status

| Area | Evidence as of 19 November 2026 |
| --- | --- |
| Hosted development | Release `13508c2` is live on Azure Linux App Service `SSSkillmgmtAppWebAppDev` in UK South. The public landing page returns HTTP 200, the frontend bundle matches the release build, and `/api/health` returns `ok`. |
| SQL | The operator reported applying migration `115` to `SS-SkillMgmtApp-SQL-Dev`. Fresh install, repeat run and recovery from partial application passed against local SQL Express. |
| Code and delivery | Azure Repos and GitHub carried the same release on `production`. Pipeline configuration commit `d8928a4` reached both `main` branches. App Service currently deploys from Azure Repos `production`. The compiled ZIP deployment job in Azure Pipelines awaits a service connection and App Service cutover. |
| Verification | The application regression run passed 1,197 automated tests, including 504 API and 683 web tests plus 10 tooling checks. A focused 26-case browser run covered announcements and approvals. A subsequent 6-case desktop/mobile run covered organization canvas and People & Access. Hosted role-based acceptance is pending. |
| Identity and AI | The operator reported company sign-in, SSO, sign-out and Azure AI working. Confirm current access with representative employee, manager, Business Analytics and Admin profiles before broad rollout. |
| Files and handover | Private files use SQL storage in the company development configuration. Blob support remains available. The authenticated knowledge-transfer workspace remains enabled. |

The 90% coverage target remains report-only in the Azure DevOps pipeline. See the [operating workflow](SKILL_MANAGEMENT_WORKFLOW.md), [deployment runbook](AZURE_DEVOPS.md), [hosted development app](https://ssskillmgmtappwebappdev-dugxhfchcbhsc3gv.uksouth-01.azurewebsites.net/) and [release commit](https://dev.azure.com/soprasteria/Skill%20Management%20App/_git/Skill%20Management%20App/commit/13508c207e2ab79cbc707baf1d2b590e74bf8519).

## Historical cutover checkpoint

The earlier company inventory confirmed migration `087`. The original cutover reported 20 restored roster profiles, two projects and 19 reporting links at revision 76, with archived historical audit records and grants. The operator reported completing the reviewed identity binding. Use these figures as historical setup evidence. Current active roster and adoption reporting require a fresh measurement.

## Identity and access

Historical coverage follow-up: see [complete-inventory coverage](TEST_COVERAGE_2026-11-05.md). UI review commits are integrated; 22 local synthetic Chromium desktop/mobile E2E cases and 8 nonmutating hosted HTTP checks passed. Full-source frontend line coverage increased from 20.57% to 33.07%. Existing isolated SQL connectivity failed, leaving 39 SQL-backed suites blocked. This does not supersede the real-company identity/access acceptance boundary above. KT stays enabled.

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
- Deploy the API and frontend together through the current Azure Repos production source. Use the [deployment runbook](AZURE_DEVOPS.md) for the planned switch to Azure Pipelines.

## Application logs

The API writes structured JSON diagnostics to stdout/stderr: one completion record per HTTP request (request ID, route template, status, elapsed time, and database phase counts/timings); state-changing API calls are logged as `app.action` with success/denied/rejected/failed outcome. OIDC/session, AI usage, database failure, and server lifecycle events are also logged. The web client reports uncaught JavaScript errors, unhandled promise rejections, React render failures, and allowlisted notification actions (open/close/refresh/item-open/read/unread/filter) to the API. Client reports are same-origin and rate-limited. `APP_LOG_LEVEL` controls verbosity (`info` by default); `HTTP_TIMING_ENABLED=false` disables database phase timing only. Logs omit query strings, bodies, tokens, credentials, names, email/UPN, employee/person/object IDs, prompts, browser URLs, notification IDs, messages, and stack traces. Successful data mutations continue to be attributed with before/after details in the existing SQL activity/audit records; diagnostic logs supplement those records rather than replace them.

For Azure App Service, enable **Monitoring → App Service logs → Application logging (File System)**, then open **Monitoring → Log stream** to view stdout/stderr. The code does not enable this Azure resource setting. File-system logging is operational/temporary; configure Azure Monitor diagnostic settings to Log Analytics or another approved destination if logs need durable retention, alerting, or cross-instance search. Do not copy secrets, employee exports, or identity data into log messages.

See [SSO/provisioning](REAL_USER_SSO.md), [cutover history](REAL_USER_CUTOVER.md), [Azure AI](AZURE_AI_FOUNDRY.md) and [approved policy](ACCESS_MODEL_REDESIGN.md).

## Setup audit and remaining work

The bulk binding template is DBA-only: preview, review the exact mapping/revision, recheck in a serializable transaction, bind inactive/unbound employees and audit. Exact active bindings are preserved; conflicts/deactivated identities abort. Roles/scopes/reporting are not broadened. `OperationsIdentityBindingAudit` records the real SQL operator and before/after; `OperationsRealUserCutover` retains cutover audit/source provenance. These setup-only tables are not application migrations and are absent from the migration-generated schema explorer. No runtime table grants were added.

Keep employee-specific exports/JSON/SQL, secrets and logs ignored. Superseded artifacts belong in an ignored archive, not the active deployment folder. Preserve backups/provenance; do not delete audit archives or blindly rerun initial bootstrap.

Next acceptance: capture final bulk result, verify Admin/Manager/employee workspace access and revocation, implement/verify limited lead access, and exercise hosted file/AI flows under real policy. Lifecycle/deprovisioning automation, directory synchronization, scheduler ownership, monitoring, load/fault tests, scanning/retention and coordinated restore remain separate work. A successful sign-in does not establish these.
