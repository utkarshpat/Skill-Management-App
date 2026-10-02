# Step 02: identity and access foundation

## What exists

- Azure SQL migration for organization hierarchy, stable Entra user identifiers, time-bound roles and reporting relationships.
- Six role definitions and permission catalogue with conservative initial defaults.
- Scoped user ALLOW/DENY with expiry, revocation metadata and audit schema.
- Pure server-side authorization functions with tested denial, scope, expiry and N+1 behavior.
- Entra/Azure SQL configuration template with no credentials.

The helpers are not wired to HTTP or SQL yet. Protected endpoints still return 401. This is a reviewed code foundation, not completed sign-in or database integration.

## Authorization inputs

After token signature, issuer, audience, tenant and validity are verified, map the stable Entra `oid` and `tid` to an active AppUser and Account. Load current roles and grants from SQL. Resolve scope IDs using current organizational data. Never use browser-supplied roles, scope IDs or manager IDs as authority.

No implicit hierarchy-based superuser exists. Users needing employee actions should also hold EMPLOYEE. Role grants must be expanded only for active, unrevoked assignments. Membership, account and organizational scope validity must be checked by the future repository/resolver before constructing an Actor or Grant.

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

The personal development database is provisioned. Migration 001 was applied and verified live on 2 October 2026 using the passwordless Node migration command. A new connection confirmed version 1 and all six roles. Application identity, scoped repositories and runtime database access remain pending. The script records its version transactionally and refuses repeat application. There is no destructive rollback script.

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

Connect real Entra application sign-in, configure a restricted runtime SQL identity, implement authenticated repositories and `/api/me`, then build the skill-claim vertical slice. The development schema is now initialized.

Needed configuration: tenant ID, separate SPA/API app registrations, exposed API scope, localhost redirect URI, Azure SQL server/database and a permitted authentication method. Store secrets only in ignored local environment files or Azure secret management.
