# Organization and reporting setup

The Microsoft Super Admin dashboard includes Organization. A searchable expandable hierarchy shows Delivery Unit → Department → Team, alongside a selected-branch editor. Each person can have one current team and one direct reporting manager. Reporting Lines shows a separate person-based tree and the saved chain above the selected person. Role names never determine reporting levels.

## Current behavior

- Create, rename and move departments/teams to valid parents; level is immutable after creation.
- Archive branches only after removing team assignments and archiving active children. No destructive delete is exposed.
- Search matches ancestors of matching descendants. Expand/collapse controls, keyboard-focusable selection, labelled forms, success/error feedback and responsive stacked panels are provided.
- Assign an existing active person to an active team and/or active reporting manager. Clearing a field removes that current assignment.
- An absent manager ends the chain. N+1 is the first person above the employee; N+2 is the next person's manager. The UI calls these reporting levels rather than role titles.
- Self-reference, cycles, invalid parents, cross-account identifiers, inactive targets and chains deeper than 200 are rejected. SQL serialization prevents two simultaneous writes from creating a cycle.
- Saved branch and assignment changes appear in the existing activity log, with actual before/after snapshots.

The personal development starter branches are explicitly named Development Delivery Unit, Development Department and Development Team. These are editable development records, not company HR data. Existing people and their role memberships are not automatically changed when a branch is created.

## API and SQL boundary

Migration 005 adds AccessOrgNode and AccessOrgAssignment with composite account foreign keys, sibling-name uniqueness and self-reference constraints. Runtime receives EXECUTE on ReadOrganization and SaveOrganizationChange and no direct table rights. Its database principal remains bound to the configured Account.

GET/POST /api/access/organization use the verified Microsoft identity resolved to the current AccessPerson. The administration route requires permissions.manage and the organization endpoints additionally require users.manage at ORGANIZATION scope. SQL rechecks both current grants inside each write transaction; DENY/expiry/suspension wins. The browser cannot choose its actor, account, reporting level or authorization role.

Reads hold the shared AccessWorkspace lock for a consistent revision, nodes, assignments and people snapshot. Writes use that same lock, expected-revision compare, parent/assignment validation, bounded reporting-chain walk, mutation, revision increment and audit insertion in one transaction. Concurrent role edits, people edits and organization edits invalidate stale forms with HTTP 409; reload and review before resubmission. Existing app middleware hides unexpected SQL/internal errors.

Organization data uses the custom AccessPerson model. The original migration-001 organization tables are historical foundation schema; this UI does not silently copy or reconcile them. Later skill-review routing must use the trusted custom organization resolver rather than role labels or browser-submitted hierarchy.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:organization -w apps/api
```

Automated tests verify N+1/N+2 derivation, duplicate/inactive/broken/circular reporting denial, payload validation, verified actor binding and immediate people-permission denial. Opt-in live SQL tests create temporary nodes and a team/manager assignment in an outer transaction, verify a multi-person cycle is rejected, and roll everything back. Separate checks cover invalid IDs/parents, self-reporting, unauthorized actor, stale revision, workspace isolation and direct-table denial. A fresh connection verifies no test records or audit changes remain.

## Remaining integration

The tree and current reporting setup are implemented. Team/department/unit/capability permission presets still need explicit scoped-grant bindings and workflow authorization before becoming effective. Creating a team or selecting a manager grants no employee-data access. Multiple-team membership, effective-dated reporting intervals, future-dated reorganizations and reassignment of pending reviews are follow-up work. Microsoft identity linking for new employees remains an explicit privileged onboarding step; this form does not link users by name or email.

Verified on 2 October 2026: migration 005 applied to the personal development database; 20 automated tests, strict type checking, builds and live organization/access SQL checks passed. The real Microsoft owner session created the three Development branches and assigned QA Test Person to Development Team with Utkarsh Patel as its development reporting manager. Role grants were unchanged. Browser search, expand/collapse, editable details and saved reporting chain worked. Layouts were inspected at 1440x900 and 390x844 with no page-level horizontal overflow.
