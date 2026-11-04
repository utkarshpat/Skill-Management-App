# Company Microsoft sign-in rollout

Updated 5 November 2026. The company cutover was confirmed committed at revision 76: 20 initially inactive employees, two projects and 19 manager edges. Hosted verified Microsoft sign-in was observed. The operator reports completing reviewed bulk identity binding; the final commit result/revision and each employee role/access are not independently verified. Read [current operations](CURRENT_OPERATIONS.md). Do not rerun cleanup.

## Implemented authentication

The existing MSAL browser flow uses authorization code with PKCE. The API verifies RS256 signatures against the exact tenant JWKS, issuer, API audience, authorized SPA caller, delegated `access_as_user` scope, token version, expiry/not-before and UUID object ID. ID tokens, Graph tokens, foreign tenants/callers and arbitrary bearer strings do not establish application identity. Active employee access remains resolved by the existing account/tenant/oid SQL mapping and canonical access policy.

`GET /api/auth/config` now exposes only three public registration identifiers from the server's validated Entra configuration, with no-store caching. The SPA uses these runtime settings, not VITE build-time IDs. This permits one deployment artifact with App Service environment settings. The redirect/logout URL is the current origin plus `/`. An unavailable or malformed configuration fails closed and initialization can retry. Do not put a browser client secret in any setting.

`GET /api/auth/identity` returns only the requesting person's verified `tid`/`oid`, even before employee provisioning. It cannot query another identity, bind a profile, activate a person or grant access. An unprovisioned signed-in user sees these identifiers and instructions for administrator review. Email/name/source roster matching is not authentication. No automatic privileged linking or Graph directory permission is added.

`database/operations/review-employee-identity-binding.sql` is a DBA-operated, preview-first setup operation. It targets the exact company server, DB, tenant and archived roster, requires the reviewed expected workspace revision and an inactive unbound employee, rejects duplicate object bindings, and allows only the designated initial Admin as the first active employee. Applying binds/activates one explicitly reviewed employee, advances revision and records actual SQL operator plus before/after in `OperationsIdentityBindingAudit`. It grants no new responsibilities and cannot replace existing bindings. No runtime permission or API for executing it is added. The setup audit is separate from app-actor audit to avoid impersonating the new administrator. It is not an installed migration or self-service approval workflow.

The capability-lead restricted view/export assignment remains pending and is not granted by SSO or identity binding. Reporting and exact assigned-current-manager review policies remain unchanged.

## Entra registration settings to verify

By explicit user instruction, temporarily reuse the existing GatePass India registration in company tenant `8b87af7d-8647-4dc7-8df4-5f69a2011bb5`. Both API and Web client IDs are `431d86d8-4a51-4dda-a821-8d0d66a83eb7`. The operator reports completing the scope, client preauthorization, SPA redirect and v2 access-token settings below. Preserve existing GatePass URLs/permissions; shared token-format changes can affect its other API consumers.

1. API registration: single tenant; expose `api://<API_CLIENT_ID>/access_as_user`; configure API access token version 2 (`api.requestedAccessTokenVersion`).
2. Web registration: add a **Single-page application** redirect URI exactly `https://ssskillmgmtappwebappdev-dugxhfchcbhsc3gv.uksouth-01.azurewebsites.net/`. Avoid implicit-flow toggles and client secrets for this SPA.
3. Web registration: add the API delegated `access_as_user` permission and obtain company consent as required. Confirm the Web client is the API's authorized caller.
4. Existing corporate Conditional Access/MFA and enterprise-app user assignment continue to apply. This implementation does not change those policies or give all directory users employee access.

Microsoft references: [authorization code flow and SPA PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [expose API scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-protected-web-api-expose-scopes).

## App Service settings

Set `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_WEB_CLIENT_ID` to the verified registration IDs. Keep `ACCESS_ACCOUNT_ID=0abd9bd3-7a7e-47b2-bea2-efbb86110cfa`, existing restricted managed-identity SQL and Azure AI settings. Set `HOSTED_DEMO_LOGIN=false`, `DEV_DIRECT_LOGIN=false`; remove obsolete demo secrets. Production real users must not be offered the person-selector login. Keep the authenticated handover route enabled with **`KNOWLEDGE_TRANSFER_ENABLED=true`**, as explicitly requested by the user. Existing frontend VITE Entra settings are no longer consumed.

Deploy the tested package and set these settings before starting the app in the provisioning window. Starting the sign-in page does not activate inactive employees. First sign in as the designated initial Admin; expect a workspace-not-provisioned screen displaying the verified tenant/object ID. Independently confirm that identity belongs to the intended company employee using approved company records. The earlier directory screenshot is only a reconciliation hint, not proof of a sign-in token.

Run the identity binding SQL with the verified object ID and employee code, leaving `@apply=0`. Review the employee, source work email, tenant/object ID and existing responsibilities. Only after review set `@verifiedIdentityReviewed=1` and `@apply=1`. Require `COMMITTED_IDENTITY_BINDING`, then refresh the signed-in app and verify Admin effective access. The single-person script is an exceptional bootstrap/reconciliation tool, not the required workflow for all 20 users. Use the reviewed bulk directory provisioning path below for this roster. Never guess a revision to bypass a conflict.

## Reviewed bulk provisioning — current path

The original 20-user roster was matched offline against the company Entra directory export: 20 unique exact roster-email / directory-UPN matches, no missing or duplicate identities. Names do not determine bindings. Only those required employee records are retained in ignored generated review/SQL files. Email is not used as runtime authorization or automatic first-login linking.

The maintained `database/operations/bulk-employee-identity-binding.template.sql` generates the concrete ignored batch. Run with `@apply=0`, review mappings/actions and `reviewedRevision`, then set `@expectedRevision` to that exact value and `@apply=1`. Apply rechecks server/database/tenant, archived source roster, all 20 current employees, existing identities and initial Admin responsibility inside a serializable transaction. It rejects conflicting/deactivated bindings and revision changes, preserves exact active bindings and audits each newly bound identity with the actual SQL operator. Require `COMMITTED_BULK_IDENTITY_BINDING`, or `ALREADY_BOUND_NO_CHANGES` for a matching active set. Do not guess the current revision.

The user reports completing this batch. The final commit output/revision and individual hosted employee/manager access remain unverified independently. No per-user SQL script is required for this completed batch. Future lifecycle synchronization and an in-app request/approval process are not implemented. Identity binding preserves roles/reporting and does not grant the pending restricted lead view/export responsibility.

Setup-only `OperationsRealUserCutover` and `OperationsIdentityBindingAudit` retain actual SQL-operator provenance without impersonating newly activated employees as app audit actors. No runtime table grants are added. These are operations tables, not migrations, and are absent from the migration-generated schema explorer.

## Verification and remaining acceptance

Latest runtime validation passed 608 checks (7 architecture/packaging, 346 API, 255 web), typecheck and builds. Operational SQL passed Microsoft T-SQL 160 parsing; the agent did not execute company SQL. Hosted sign-in/verified identity is observed, while final bulk outcome, individual effective access/revocation, corporate-policy coverage and exhaustive hosted workflows still need acceptance. No employee data is copied to personal infrastructure.
