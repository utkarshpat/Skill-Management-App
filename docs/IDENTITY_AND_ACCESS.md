# Step 02: identity and access foundation

## What exists

- Azure SQL migration for organization hierarchy, stable Entra user identifiers, time-bound roles and reporting relationships.
- Historical role seeds and a permission catalogue with conservative initial defaults. Updated requirements make roles administrator-defined; the earlier six labels are not mandatory.
- Scoped user ALLOW/DENY with expiry, revocation metadata and audit schema.
- Pure server-side authorization functions with tested denial, scope, expiry and N+1 behavior.
- Entra/Azure SQL configuration template with no credentials.

Own-profile HTTP access now uses verified Entra tokens and a restricted SQL procedure. Other workflows remain closed. The pure scoped-policy helpers cover future workflows; see SSO_AND_PROFILE.md for the implemented boundary and verification.

## Authorization inputs

After token signature, issuer, audience, tenant and validity are verified, map the stable Entra `oid` and `tid` to an active AppUser and Account. Load current roles and grants from SQL. Resolve scope IDs using current organizational data. Never use browser-supplied roles, scope IDs or manager IDs as authority.

No implicit hierarchy-based superuser exists. Role names confer no authority. Assign employee actions through permission grants in any custom role or individual override. Role grants must be expanded only for active, unrevoked assignments. Membership, account and organizational scope validity must be checked by the repository/resolver before constructing an Actor or Grant. Account-scoped custom-role and individual administration now persists in SQL; see PERMISSION_ADMINISTRATION.md. Real Entra administration and trusted organization bindings remain pending.

`authorize()` applies account isolation and actor status, blocks self-approval, checks reviewer assignment, filters permissions by target scope/validity, then applies explicit deny before allow. Resource lifecycle, grant authority, payload validation, optimistic concurrency and exact human approval are additional service checks.

Scope semantics:

- OWN: actor owns the record.
- TEAM/DEPARTMENT/DELIVERY_UNIT: exact server-resolved organizational ID.
- ORGANIZATION: same account only.
- SPECIFIC_RESOURCE: exact record ID and type.
- CAPABILITY: skill catalogue, learning catalogue or permitted aggregate capability data; never arbitrary individual evidence.

Validity is UTC `[valid_from, valid_until)`. The end instant is excluded. Revocation retains the grant and disables it. Current N+1 lookup fails closed when data is missing, ambiguous or self-referential.

## Migration application

Apply `database/migrations/001_identity_authorization.sql` to a dedicated development Azure SQL database using an authorized migration identity and a current SQL Server client. Example with Entra authentication and an already installed/configured sqlcmd:

```powershell
sqlcmd -S tcp:YOUR-SERVER.database.windows.net,1433 -d YOUR-DATABASE -G -b -i database/migrations/001_identity_authorization.sql
```

The personal development database is provisioned. Migrations 001 and 002 were applied on 2 October 2026, with six role seeds and restricted runtime own-profile access verified live. The CLI skips recorded versions; migration 001 itself refuses direct repeat application. There is no destructive rollback script.

Composite foreign keys stop cross-account relationships. They do not provide row-level read isolation. Future repositories must filter by trusted account context on every query; database RLS and restricted runtime permissions should be added before deployment.

Additional transactional checks required in services:

- Reject overlapping effective reporting/team/role intervals and hierarchy cycles.
- Validate polymorphic permission scope IDs exist inside the grant account.
- Prevent granting broader powers than the approver may delegate.
- Preserve grant/role changes and audit events atomically.
- Restrict UPDATE/DELETE on audit rows through SQL runtime permissions.
- Handle manager changes for pending reviews according to an explicit reassignment policy.

The runtime application must not use schema-owner credentials.

## Next work

Interactive first-login and live profile retrieval are verified. Build the skill-claim vertical slice next. Access administration and production deployment remain pending.

Needed configuration: tenant ID, separate SPA/API app registrations, exposed API scope, localhost redirect URI, Azure SQL server/database and a permitted authentication method. Store secrets only in ignored local environment files or Azure secret management.
