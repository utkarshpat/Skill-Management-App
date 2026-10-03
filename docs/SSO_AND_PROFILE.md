# Microsoft sign-in and own profile

## Implemented behavior

The React SPA uses MSAL authorization-code/PKCE sign-in with a single development tenant. It requests the custom API delegated scope access_as_user, uses session-scoped MSAL caching and never contains a client secret. Local redirect URI is http://localhost:5173/. Use this hostname when testing sign-in.

The API validates signed RS256 tokens against tenant JWKS, exact issuer/audience/tenant, lifetime, delegated scope, token version, stable user object ID and the configured SPA caller. Browser-submitted role or identity fields do not determine access. JWKS retrieval has a timeout. The API rejects ID tokens and tokens for other resources/callers.

GET /api/me resolves the active account and user from trusted tid/oid. SQL procedure GetOwnProfile checks current role/grant validity and applicable explicit DENY before returning the user's own profile and active roles. It returns no other employee profiles. Sign-in does not auto-create employees or grant roles.

Responses use no-store. Invalid authentication returns 401 with a Bearer challenge; unavailable membership or profile permission returns generic 403 ACCESS_NOT_PROVISIONED; database failures return generic 500 with a request ID. Other unimplemented API workflows remain closed.

## Configuration and runtime isolation

### Development-login availability and recovery

Local direct login requires the API's existing development-only opt-in and loopback restrictions. Production returns 404 and the selector stays hidden. A network error, timeout, database error or invalid response is different: the welcome page keeps a Development login section with an error and **Retry development login**, instead of silently hiding the selector. Discovery uses a 15-second timeout per attempt and one automatic retry; manual retry rechecks the endpoint without reloading the page. Requests use `no-store`, and only a validated response can restore an existing development session.

An enabled endpoint with no eligible people shows an explicit empty state and refresh action. Microsoft-linked accounts still use Microsoft sign-in. Failed direct sign-in shows an error alongside the selector and allows refreshing the available people. Server authorization, person eligibility, permission checks and session lifetime are unchanged; API restarts invalidate in-memory demo sessions.

A 401 response during an authenticated demo request clears the frontend demo-session flag, unmounts the old workspace/chat and rediscovers login availability. The welcome page explains that the session expired or the API restarted and asks the user to choose a test person again. This does not create another AI login, automatically impersonate a person, change Microsoft sessions or recover invalid server sessions. Browser verification used an isolated synthetic 401 during a chat request.

Verified on 3 October 2026: six discovery regression tests cover transient and persistent failures, later recovery, disabled endpoints, empty rosters, malformed/network responses and valid session restoration. An isolated browser fixture returned two synthetic 503 responses; the welcome page displayed the error and its Retry button restored the real fixture selector without a page refresh. The fixture uses no Azure database or paid model calls.

Copy apps/web/.env.example into ignored .env.local and apps/api/.env.example into ignored .env. Configure matching tenant, SPA/API IDs and API scope. Register the SPA redirect as a SPA URI. No Microsoft Graph application permission is required by this feature.

The personal development SPA/API registrations exist. The user completed individual first-login Microsoft consent in their browser. Organization-wide consent was not requested by our test automation.

Setup/migration commands use a developer Entra identity. HTTP database requests use a separate restricted runtime credential; they never fall back to developer SQL owner access. Development uses an ignored client secret expiring 1 November 2026, 00:00 UTC. Rotate before expiry or replace with a managed identity at hosting. Production must configure AZURE_SQL_RUNTIME_AUTH=managed-identity and grant that identity only the needed procedures.

For the configured runtime database user, a DBA grants EXECUTE ON dbo.GetOwnProfile. Migration 002 creates the procedure; it does not grant a service identity or onboard employees. Those are explicit environment-specific administrative operations. The current development user is skill_management_runtime, a contained external service-principal user with this procedure grant and no direct table read grant.

Migration 003 additionally provides SQL-backed custom access administration. The runtime is explicitly bound to the development Account and receives EXECUTE on ReadAccessWorkspace and SaveAccessChange; direct table/audit modification remains denied. Development direct identities are separate from real Entra users. See PERMISSION_ADMINISTRATION.md for import, SQL transaction checks and Microsoft permission administration.

An explicit personal development bootstrap created Development Workspace, DEV-001 (Utkarsh Patel) and one EMPLOYEE role with a bootstrap audit event. This is test workspace membership, not company HR data or an automatic onboarding mechanism. The runtime cannot create or elevate employees.

## Verification

Cryptographic tests cover valid tokens, forged signatures, wrong issuer/audience/tenant/caller, invalid identity/scope/version, expired and future tokens. HTTP tests cover denial before SQL, trusted subject usage despite attacker query fields, missing membership and generic database failures.

Live restricted SQL verification on 2 October 2026: the explicitly provisioned user's profile and EMPLOYEE role succeeded; an unknown object ID returned no profile; direct SELECT on AppUser failed with SQL permission error 229. Migration versions 1 and 2 are recorded. After user-completed consent, the browser returned to the app and displayed the live Utkarsh Patel / DEV-001 / EMPLOYEE profile from Azure SQL. The complete interactive sign-in, API token validation and own-profile retrieval succeeded.

Additional live transactional checks confirmed that an explicit OWN DENY blocks the role grant, a revoked DENY no longer applies, and a suspended member is denied. All test changes were rolled back. Eleven automated tests, type checking and both builds passed; dependency audit reported zero known vulnerabilities at verification time. Welcome layout was checked at 1440x900 and 390x844; phone horizontal overflow was absent.

## Follow-up

Add scoped skill catalogue and claim workflows, then private evidence and N+1 review. Add operational readiness, operational telemetry and deployment controls before production. AI reuses these identity and policy boundaries as described in AI_INTEGRATION.md.

## Microsoft permission administration increment

Migration 004 resolves explicitly linked Microsoft identities to custom workspace people. The account owner now uses the same validated Microsoft session for the Super Admin dashboard. Custom grants govern mapped profile access; missing profile.view, suspension or DENY does not fall back to the legacy profile. Sign-in creates no grants. The prior EMPLOYEE bootstrap is historical test membership; it is not the owner's current custom administrator policy. See PERMISSION_ADMINISTRATION.md for endpoint behavior, audit and company bootstrap requirements. The live owner dashboard and restricted SQL integration checks succeeded on 2 October 2026.
