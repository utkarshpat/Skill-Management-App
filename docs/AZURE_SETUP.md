# Personal Azure development setup

The personal account is for development. Company Azure instances will be configured independently later. Connected Chrome is signed in to the personal Default Directory and Azure subscription 1. The user submitted Create on 2 October 2026. The portal reports **Your deployment is complete** and database status **Online**. Pricing is **Free - General Purpose - Serverless: Gen5, 2 vCores**, with **Overage billing Disabled**. Live Node SQL access is verified. Migration 001 was applied successfully and a fresh connection confirmed version 1 with six role seeds.

## Azure SQL free offer

Use Azure SQL hub → **Start free**. A normal database is not automatically free just because the account has free subscription credits.

- Deployed resource group: `rg-skill-management-dev`.
- Deployed database: `skill-management-dev`.
- Deployed server: `sql-skill-management-utkarsh-dev.database.windows.net`, in Southeast Asia. The first free database fixes the region for later free databases in that subscription.
- Verify **Free offer applied** and zero estimated monthly database cost.
- Keep **Auto-pause the database until next month** selected when free limits are reached. Do not enable **Continue using database for additional charges**.
- Monthly allowance: 100,000 vCore seconds, 32 GB data and 32 GB backup storage per database. Monitor consumption; idle open database clients can prevent normal serverless auto-pause.
- Prefer Entra authentication. Credential entry and security-sensitive access changes must be handled explicitly during portal setup.
- Development networking: the user explicitly approved `AllNetworksDev` (`0.0.0.0`–`255.255.255.255`) on 2 October 2026, and the rule is saved. Entra-only authentication remains required. The separate Azure-services exception stays unchecked. Company deployment must select its own network policy.
- Apply `database/migrations/001_identity_authorization.sql` and verify its migration record and six role seeds. **Applied and verified on the development SQL database on 2 October 2026.**

[Microsoft free-offer documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql)

## Local SQL setup commands

Copy `apps/api/.env.example` to the ignored `apps/api/.env`, then configure `AZURE_SQL_SERVER` and `AZURE_SQL_DATABASE`. No password is needed. Browser portal sign-in does not automatically sign in the local Node SDK; `DefaultAzureCredential` needs a supported local developer identity (such as Azure CLI sign-in), or a configured managed identity when hosted.

From the repository root:

```powershell
npm.cmd run db:check -w apps/api
npm.cmd run db:migrate -w apps/api
npm.cmd run db:check -w apps/api
```

`db:check` reads connectivity, applied migration versions and role count. `db:migrate` applies reviewed migrations 001/002, skipping recorded versions. Use a single migration worker. Setup connections close after use. TLS encryption and certificate validation are required. Raw driver errors and credentials are never printed. These commands are not HTTP endpoints.

Azure CLI 2.90.0 is installed and signed in to the personal development tenant. `db:check` verified the live connection; `db:migrate` applied migration 001; a separate `db:check` confirmed migration version 1 and six roles. Azure resource verification also confirmed `useFreeLimit=true`, `freeLimitExhaustionBehavior=AutoPause` and 32 GB maximum data size. Restart terminal sessions after CLI installation so it is available on PATH. CLI login is developer tooling authentication, not application SSO.

## Application identity

Development SPA and API applications are registered with single-tenant sign-in. The registered SPA redirect is `http://localhost:5173/`; use this origin for local sign-in testing.

Use authorization code with PKCE; never embed a browser client secret. The API must validate issuer, audience, lifetime, tenant and delegated scope before resolving an active application user. Microsoft sign-in alone must not grant employee roles or read access.

Tenant/app IDs belong in environment configuration. Passwords, tokens and connection secrets never enter Git. Both apps provide environment templates. Microsoft sign-in and restricted own-profile access are implemented and verified through the full browser journey after user-completed consent; see SSO_AND_PROFILE.md. The SQL runtime never uses the developer's owner identity.

## Storage and hosting

Add private evidence storage and hosting after identity and SQL. Blob Storage, monitoring and hosting can incur separate charges even when SQL is free; verify their own free eligibility before provisioning. Keep real employee records and evidence outside the public repository.

## Company migration

Provision company resource groups, SQL, private storage and Entra app registrations independently. Change environment configuration without replacing source code. Apply versioned migrations to company SQL and migrate approved data separately with explicit identity/reporting mapping: tenant object IDs cannot be assumed to survive a tenant change. Never copy personal credentials.

Configure production HTTPS origins, redirect URIs, API audiences and network rules, then retest authentication and scoped authorization in the destination tenant. Loopback hosting, personal bootstrap membership and local client secret are development only. The secret expires 1 November 2026 at 00:00 UTC; replace it with company managed identity at hosting.
