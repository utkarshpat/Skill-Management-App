# Personal Azure development setup

The personal account is for development. Company Azure instances will be configured independently later. Connected Chrome is signed in to the personal Default Directory and Azure subscription 1. **No cloud resources have been provisioned yet**: the free SQL creation form is being prepared for final review.

## Azure SQL free offer

Use Azure SQL hub → **Start free**. A normal database is not automatically free just because the account has free subscription credits.

- Prepared resource group: `rg-skill-management-dev`.
- Prepared database: `skill-management-dev`.
- Choose a globally unique logical server name and verify regional availability during setup. The first free database fixes the region for later free databases in that subscription.
- Verify **Free offer applied** and zero estimated monthly database cost.
- Keep **Auto-pause the database until next month** selected when free limits are reached. Do not enable **Continue using database for additional charges**.
- Monthly allowance: 100,000 vCore seconds, 32 GB data and 32 GB backup storage per database. Monitor consumption; idle open database clients can prevent normal serverless auto-pause.
- Prefer Entra authentication. Credential entry and security-sensitive access changes must be handled explicitly during portal setup.
- Restrict networking. Do not enable all Azure services or all IP addresses as a shortcut. Any developer firewall rule should cover only the current developer IP and be reviewed before applying.
- Apply `database/migrations/001_identity_authorization.sql` and verify its migration record and six role seeds. **This migration has not been executed against SQL yet.**

[Microsoft free-offer documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql)

## Identity

Register development SPA and API applications within the development Entra tenant, with single-tenant sign-in. The current SPA development origin is `http://127.0.0.1:5173/`; verify loopback redirect acceptance during registration.

Use authorization code with PKCE; never embed a browser client secret. The API must validate issuer, audience, lifetime, tenant and delegated scope before resolving an active application user. Microsoft sign-in alone must not grant employee roles or read access.

Tenant/app IDs belong in environment configuration. Passwords, tokens and connection secrets never enter Git. `apps/api/.env.example` lists pending backend configuration. The welcome page currently disables sign-in: it does not contact Microsoft or create a session.

## Storage and hosting

Add private evidence storage and hosting after identity and SQL. Blob Storage, monitoring and hosting can incur separate charges even when SQL is free; verify their own free eligibility before provisioning. Keep real employee records and evidence outside the public repository.

## Company migration

Provision company resource groups, SQL, private storage and Entra app registrations independently. Change environment configuration without replacing source code. Apply versioned migrations to company SQL and migrate approved data separately with explicit identity/reporting mapping: tenant object IDs cannot be assumed to survive a tenant change. Never copy personal credentials.

Configure production HTTPS origins, redirect URIs, API audiences and network rules, then retest authentication and scoped authorization in the destination tenant. Current loopback hosting and placeholder sign-in are development only.
