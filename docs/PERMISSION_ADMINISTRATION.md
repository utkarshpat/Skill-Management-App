# Permission-led access and temporary direct login

User decision, 2 October 2026: role names and people are not fixed in source. Super Admin defines them and controls permissions, including individual additions/removals. The old six-role SQL seeds are historical development defaults, not mandatory role names. Existing migrations are preserved; the eventual company migration must establish tenant-local custom roles and map users explicitly.

## Current runnable increment

Start local development with NODE_ENV=development and DEV_DIRECT_LOGIN=true in the ignored API environment. The welcome page shows one initial Development Super Admin / DEV-ADMIN. Click Open demo workspace, then Access administration. Create any role name, assign permission codes and scopes, create people IDs, assign roles and set individual overrides. Created active people appear in the direct-login selector. Switch person ends the current demo session before another selection.

The initial administrator is a bootstrap record. Its label does not grant authority: permission administration requires permissions.manage with workspace scope; editing people additionally requires users.manage. Rename the bootstrap role without changing permissions and authority remains intact. No hard-coded role-name bypass exists.

The catalogue defines permissions by application operation, independently from titles. AI tools will use these same codes. Unimplemented workflows are still unavailable even when their permission has been configured. Permissions are not endpoints or a substitute for resource-state, assigned-reviewer and self-approval checks.

## Permission semantics

An assignment consists of a server-defined permission code, ALLOW/DENY effect, target scope and optional expiry. Role IDs are stable even when their display names change. People IDs and their role memberships are separate records. Names do not route reviews or determine access. The permission catalogue is versioned with implemented operations; administrators compose access from it rather than inventing a permission string that the application cannot enforce.

Access defaults to denied. Current role assignments contribute permissions, and individual overrides can contribute ALLOW or DENY. An applicable DENY takes precedence. Removing an individual ALLOW does not remove a permission still inherited from a role; add DENY or change the role assignment to block it. Removing a role assignment stops inheritance. Expired permissions stop applying. Suspending a person prevents login and access.

OWN and entire demo workspace scopes are implemented in the editor. Team, department, delivery-unit, capability and specific-resource policy primitives already exist, but their administration needs trusted organization/resource records and is a later increment. An OWN permissions.manage assignment cannot administer the workspace.

The API reloads the user's active status and current grants on each request. Sessions store only an opaque user reference, never trusted client-supplied roles. Changes take effect in existing sessions. A revision check rejects stale edits with 409; saves are serialized and atomically replace the local file. Audit records include actor, target, time, revision and before/after assignment snapshots. The API prevents removal of the final active administrator with both administration permissions.

## Development boundary and company migration

This temporary identity provider is loopback-only, explicitly enabled, and refuses startup when enabled outside NODE_ENV=development. Absent the flag, direct-login and local administration routes return 404. Mutations require approved local origins; sessions use random opaque HttpOnly/SameSite=Strict cookies, expire after 30 minutes and are invalidated on sign-out/server restart. There is no browser client secret or token in local storage.

Development access configuration persists in ignored apps/api/.local/dev-access.json. This local file is separate from the Entra/Azure SQL personal profile and contains no company employees. It is intentionally not a production access database or an Azure SQL migration. Only one local API process should write it. Session state is intentionally ephemeral; access configuration survives process restarts.

For company hosting, omit/set false DEV_DIRECT_LOGIN, remove the temporary identity provider/UI, and require Entra. Implement tenant-local custom-role tables, audited role membership and per-user grant services in Azure SQL using restricted stored procedures. Preserve the permission catalogue and authorization engine; replace the local access store adapter. Provision the first company administrator explicitly, define delegation limits, then migrate approved role/person configuration with identity mapping. Do not copy development sessions or personal credentials. Permission administration under real Entra identity is not implemented in this increment.

Target SQL model: AccountRole with account_id/role_id/display_name/status/record_version; AccountRolePermission with account_id/role_id/permission_code/effect/scope; time-bound UserRoleAssignment with account_id/user_id/role_id/scope bindings; UserPermissionOverride with effect, scope, validity and revocation; append-only AccessAudit with actor, target and before/after values. Use composite account foreign keys, uniqueness within each account, transactional audit and optimistic concurrency. Legacy global role_code tables must be mapped explicitly rather than reused as company-wide titles. Delegation checks must constrain the permissions and scopes an administrator may grant; permissions.manage is not an unrestricted cross-account superuser.

## Verification

Automated checks cover non-development refusal, absent endpoints when disabled, administrator retention, arbitrary role labels, default denial, individual DENY, expiry, unauthorized administration, stale revisions, persistence, opaque cookies, cross-origin rejection and live grant removal during a session. The existing signed-token and scoped/N+1 authorization tests remain required. Browser verification records the actual creation and login workflow separately.

Browser verification on 2 October 2026: direct Super Admin login succeeded; the UI created QA Profile Reader and QA Test Person / QA-001; the administrator assigned the role and an individual profile.view OWN DENY. Direct login for QA-001 succeeded, but profile access was denied despite the role ALLOW. The same ID could not open access administration. These are clearly labelled test records, not predetermined business roles or company people. Fifteen automated tests, type checking and builds passed.

Administration was visually checked on a laptop and at 390px phone width; no phone horizontal overflow was observed. The administrator session is left open at /access. QA-001 retains the test DENY so its behavior can be inspected or changed through People & overrides.
