# Company Microsoft sign-in rollout

Updated 16 November 2026. The company cutover was confirmed committed at revision 76: 20 initially inactive employees, two projects and 19 manager edges. The operator reports completing reviewed bulk identity binding; the final commit result/revision and each employee role/access are not independently verified. The operator reports successful hosted Microsoft sign-in, automatic SSO, and sign-out in a normal Edge profile; the exact deployed source hash and per-employee access remain independently unverified. Read [current operations](CURRENT_OPERATIONS.md). Do not rerun cleanup.

## Implemented authentication

Hosted company sign-in uses a server-side OpenID Connect (OIDC) authorization-code flow with PKCE. The browser is redirected to Entra; the API exchanges the code using the server-only `ENTRA_WEB_CLIENT_SECRET`, validates the ID-token signature/JWKS, issuer, web-client audience, nonce, expiry, tenant and UUID object ID, then requires the verified `preferred_username` to end in `@soprasteria.com`. The application identity is `(tenant ID, object ID)`; the email-domain check is an admission restriction, not the identity key. No Microsoft Graph call or Graph `User.Read` permission is used by this sign-in flow. SAML is not configured.

The server issues an opaque `__Host-skill-session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict` and host-only scope. A verified OIDC login starts a fixed eight-hour app session. The ID token must be valid at sign-in. Hosted OIDC state and application sessions use shared SQL storage after migration 113. They remain available across app instances and process restarts until expiry or sign-out. Mutating cookie-authenticated requests require the configured exact Origin. Current authorization and active employee mapping are still checked by the existing backend/SQL policy. A valid Microsoft sign-in alone does not provision a profile, link by email, activate an employee or grant workspace access.

At the bare app URL, the page first attempts silent OIDC sign-in with `prompt=none` and a remembered, verified `login_hint`. The hint only helps Entra find an account; it is not proof or authorization. If Entra has no usable SSO session or requires interaction, the app shows its Microsoft sign-in action. Entra/Conditional Access can still require an account choice or other interaction. Explicit sign-out ends the app session and redirects to Entra's OIDC logout endpoint; because that also ends the relevant Entra browser session, the next visit may require interactive sign-in rather than silent SSO.

`GET /api/auth/config` exposes the public tenant/client identifiers and supported session/sign-in mode with no-store caching. The same-origin SPA does not receive a secret or Entra tokens in the backend OIDC mode. This permits one deployment artifact with App Service environment settings. Missing or malformed configuration fails closed. Never put `ENTRA_WEB_CLIENT_SECRET` in Vite variables, browser code, source control or chat.

`GET /api/auth/identity` returns only the requesting person's verified `tid`/`oid`, even before employee provisioning. It cannot query another identity, bind a profile, activate a person or grant access. An unprovisioned signed-in user sees these identifiers and instructions for administrator review. Email/name/source roster matching is not authentication. No automatic privileged linking or Graph directory permission is added.

`database/operations/review-employee-identity-binding.sql` is a DBA-operated, preview-first setup operation. It targets the exact company server, DB, tenant and archived roster, requires the reviewed expected workspace revision and an inactive unbound employee, rejects duplicate object bindings, and allows only the designated initial Admin as the first active employee. Applying binds/activates one explicitly reviewed employee, advances revision and records actual SQL operator plus before/after in `OperationsIdentityBindingAudit`. It grants no new responsibilities and cannot replace existing bindings. No runtime permission or API for executing it is added. The setup audit is separate from app-actor audit to avoid impersonating the new administrator. It is not an installed migration or self-service approval workflow.

The capability-lead restricted view/export assignment remains pending and is not granted by SSO or identity binding. Reporting and exact assigned-current-manager review policies remain unchanged.

## Entra registration settings to verify

By explicit user instruction, temporarily reuse the existing GatePass India registration in company tenant `8b87af7d-8647-4dc7-8df4-5f69a2011bb5`. The backend Web client ID is `431d86d8-4a51-4dda-a821-8d0d66a83eb7`; the API client ID setting currently uses the same ID. The operator reports configuring OIDC settings and successful hosted sign-in/sign-out. Preserve existing GatePass URLs/permissions; shared registration changes can affect its other consumers.

1. The current backend OIDC flow uses the **Web** platform. Register these exact same-origin redirect URIs: `https://ssskillmgmtappwebappdev-dugxhfchcbhsc3gv.uksouth-01.azurewebsites.net/api/auth/callback` and `https://ssskillmgmtappwebappdev-dugxhfchcbhsc3gv.uksouth-01.azurewebsites.net/api/auth/signed-out`.
2. Store the Web app client secret as the server-only App Service setting `ENTRA_WEB_CLIENT_SECRET` using the approved secret store. The operator selected a 24-month expiry; set an owner-controlled reminder well before the actual expiry date and rotate the secret before it expires. Confirm the tenant's allowed lifetime when creating it. Never record the secret value or secret ID here.
3. Keep `ENTRA_TENANT_ID`, `ENTRA_WEB_CLIENT_ID`, `ENTRA_API_CLIENT_ID`, `PUBLIC_APP_ORIGIN` (origin only, no trailing slash), `SERVE_WEB=true`, and `HOSTED_DEMO_LOGIN=false` / `DEV_DIRECT_LOGIN=false` as applicable. Do not remove any old SPA redirect or alter shared GatePass permissions/token settings unless the registration owner confirms they are unused by GatePass. The backend flow does not use the SPA root redirect or delegated `access_as_user` scope for login; no Graph permission is required.
4. Existing corporate Conditional Access/MFA and enterprise-app user assignment continue to apply. This implementation does not change those policies or give all directory users employee access.

Microsoft references: [authorization code flow and SPA PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [expose API scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-protected-web-api-expose-scopes).

## App Service settings

Set `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_WEB_CLIENT_ID`, server-only `ENTRA_WEB_CLIENT_SECRET`, exact HTTPS `PUBLIC_APP_ORIGIN`, `SERVE_WEB=true`, and `HOST=0.0.0.0`. Keep `ACCESS_ACCOUNT_ID=0abd9bd3-7a7e-47b2-bea2-efbb86110cfa`, existing restricted managed-identity SQL and Azure AI settings. Set `HOSTED_DEMO_LOGIN=false`, `DEV_DIRECT_LOGIN=false`; remove obsolete demo secrets. Production real users must not be offered the person-selector login. Keep the authenticated handover route enabled with **`KNOWLEDGE_TRANSFER_ENABLED=true`**, as explicitly requested by the user. Existing frontend VITE Entra settings are not used by backend OIDC mode.

Deploy the tested package and set these settings before starting the app in the provisioning window. Starting the sign-in page does not activate inactive employees. First sign in as the designated initial Admin; expect a workspace-not-provisioned screen displaying the verified tenant/object ID. Independently confirm that identity belongs to the intended company employee using approved company records. The earlier directory screenshot is only a reconciliation hint, not proof of a sign-in token.

Run the identity binding SQL with the verified object ID and employee code, leaving `@apply=0`. Review the employee, source work email, tenant/object ID and existing responsibilities. Only after review set `@verifiedIdentityReviewed=1` and `@apply=1`. Require `COMMITTED_IDENTITY_BINDING`, then refresh the signed-in app and verify Admin effective access. The single-person script is an exceptional bootstrap/reconciliation tool, not the required workflow for all 20 users. Use the reviewed bulk directory provisioning path below for this roster. Never guess a revision to bypass a conflict.

## Reviewed bulk provisioning — current path

The original 20-user roster was matched offline against the company Entra directory export: 20 unique exact roster-email / directory-UPN matches, no missing or duplicate identities. Names do not determine bindings. Only those required employee records are retained in ignored generated review/SQL files. Email is not used as runtime authorization or automatic first-login linking.

The maintained `database/operations/bulk-employee-identity-binding.template.sql` generates the concrete ignored batch. Run with `@apply=0`, review mappings/actions and `reviewedRevision`, then set `@expectedRevision` to that exact value and `@apply=1`. Apply rechecks server/database/tenant, archived source roster, all 20 current employees, existing identities and initial Admin responsibility inside a serializable transaction. It rejects conflicting/deactivated bindings and revision changes, preserves exact active bindings and audits each newly bound identity with the actual SQL operator. Require `COMMITTED_BULK_IDENTITY_BINDING`, or `ALREADY_BOUND_NO_CHANGES` for a matching active set. Do not guess the current revision.

The user reports completing this batch. The final commit output/revision and individual hosted employee/manager access remain unverified independently. No per-user SQL script is required for this completed batch. Future lifecycle synchronization and an in-app request/approval process are not implemented. Identity binding preserves roles/reporting and does not grant the pending restricted lead view/export responsibility.

Setup-only `OperationsRealUserCutover` and `OperationsIdentityBindingAudit` retain actual SQL-operator provenance without impersonating newly activated employees as app audit actors. No runtime table grants are added. These are operations tables, not migrations, and are absent from the migration-generated schema explorer.

## Verification and remaining acceptance

The earlier release validation passed 630 checks (7 architecture/packaging, 365 API, 258 web), typecheck and builds; it predates this backend OIDC change. The OIDC/session implementation has targeted API tests (2 suites) and web auth integration tests (29 cases), plus API/web typechecks. Operational SQL passed Microsoft T-SQL 160 parsing; the agent did not execute company SQL. The operator reports that hosted automatic SSO and sign-out work in normal Edge. Exact deployed source hash, final bulk result/revision, individual effective access/revocation, corporate-policy coverage and exhaustive hosted workflows remain unverified independently. No employee data is copied to personal infrastructure.

## Same-origin company sessions

When Entra sign-in, `SERVE_WEB=true` and an exact HTTPS `PUBLIC_APP_ORIGIN` are configured,
the backend OIDC callback issues an opaque, host-only, Secure, HttpOnly session cookie.
The server verifies the ID token before issuing it and uses the verified tenant/object ID
for current workspace access checks. Cookie-authenticated writes require the configured
Origin. Logout revokes the local session before redirecting to Microsoft's OIDC logout
endpoint. This is relying-party-initiated OIDC logout, not SAML Single Logout (SLO); no
Entra front-channel logout notification endpoint is implemented. The signed-out callback
returns to `/?signin=signed-out`. A separate login-hint cookie is retained to help a later
silent attempt identify the account, but a hint never authenticates a user. Explicit logout
ends the relevant Entra browser session, so the next silent attempt can fail and show the
interactive sign-in action. This does not promise sign-out from every Microsoft app or
browser profile.

Hosted OIDC sessions expire eight hours after issuance. The legacy bearer-to-cookie exchange caps its session at the earlier of the bearer token expiry and eight hours. The backend OIDC flow requests `openid profile`. It makes no Graph call and requires no Graph `User.Read` permission. Deploy migration 113 before the matching app. From that deployment onwards, hosted sessions survive an App Service restart. The first deployment requires one fresh Microsoft sign-in because earlier sessions were stored in the process.

If an open workspace loses its session, use **Sign in with Microsoft** to sign in in the new tab. The original tab verifies the same work account, refreshes permissions and resumes with the open form or draft. If automatic recovery is unavailable, return to the original tab and select **Resume workspace**. A different account keeps the original tab paused and prompts for the correct account. If the original tab is closed, the sign-in page offers **Open a new workspace**.

Company browser tabs identify the account whose workspace they loaded. If the Microsoft account changes in another tab, the server rejects requests from the stale workspace before reading or changing records. The original tab pauses and requires a fresh account check before continuing.

### Web callback and scaling boundary

The current same-origin backend OIDC flow registers Web redirect URIs ending in
`/api/auth/callback` and `/api/auth/signed-out`. The backend callback is enabled by the
server-only `ENTRA_WEB_CLIENT_SECRET`, `PUBLIC_APP_ORIGIN` and `SERVE_WEB=true`. It uses
authorization code with PKCE, requests `openid profile`, validates the ID token and then
issues the application cookie. The API client ID setting remains required by the current
configuration contract, although this login flow does not request the API's `access_as_user`
scope. Employee profile resolution still requires an existing Entra binding.

Hosted login state is consumed once in shared SQL. Session cookies remain opaque, and SQL stores hashes of the opaque identifiers. Development fixtures and the legacy bearer-only mode retain process-local storage.
