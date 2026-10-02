# Incremental build plan

Baseline: shared planning chat and full final engineering handover, reviewed 2 October 2026. Handover remains a draft; implementation decisions must be documented.

## Agreed direction

React, Node.js, Azure SQL, private Blob Storage, organizational SSO. No MCP. AI uses an internal allowlisted Tool Registry through an authorization/policy gateway. The API stays a modular monolith with a separate frontend; see ARCHITECTURE.md.

Updated user decision, 2 October 2026: roles and people are administrator-defined. Super Admin creates names, roles and permission assignments; individual IDs can receive or lose permissions independently of roles. The six earlier role labels are editable starting permission sets, not a fixed role model. Policy checks permission codes and resource scopes, never role names. Organizational reporting relationships remain separate from access roles; N+1 is the direct reporting relationship; N+2 follows the reporting relationship of that N+1 person. Neither is a role name. Taxonomy governance and other responsibilities are assigned through permissions rather than hard-coded titles.

Role grants plus scoped user ALLOW/DENY overrides, validity and revocation history determine authorization. Explicit applicable DENY wins. Self-approval is blocked. Scope applies to every API, export, search, job and AI tool.

Technical skills and workplace evaluations are separate. Claimed, verified, certified, inferred, expired and unknown information must stay distinguishable. Tests and training do not automatically verify skills.

## Steps

1. **Frontend/backend foundation:** shell, API liveness, type checking, build and closed protected endpoints.
2. **Identity and data:** organizational SSO, SQL migrations, scoped permissions, reporting hierarchy and audit foundation.
3. **First vertical slice:** employee profile → published skill → claim → private evidence → N+1 review → verified profile, with history and concurrency checks.
4. **Credentials and manager evaluation:** certification lifecycle and defined workplace rubrics.
5. **Learning slice:** goal wizard → AI draft → edit/confirm → deterministic calendar scheduling → today's tasks → completion/backlog → consented recovery → optional ten-question test → progress.
6. **Demand and matching:** approved demand → verified supply/capacity → explainable match → human shortlist.
7. **Requests and incidents:** recipient/routing, approvals, access grant/revoke, IT incident assignment and resolution, comments and timelines.
8. **Insights and AI assistant:** scoped retrieval with sources, drafts/proposals, exact approval payload, policy/version recheck, idempotent execution and audit.

Each step produces a runnable result and relevant verification. Build one complete workflow at a time.

Personal navigation and dashboards now derive from effective permissions for existing presets and custom roles. The development selector identifies each person's assigned roles; administrators can switch workspace contexts. Client-side routing prevents sidebar navigation from reloading the document. Manager review, evidence, learning, requests/incidents and approved AI writes remain upcoming workflows. See WORKSPACES_AND_MODEL_SELECTION.md and LEARNING_AND_CONVERSATIONAL_AI.md.

Current increment: custom-role/person/individual-permission administration persists in Azure SQL through migration 003, with explicit local import, restricted runtime procedures, transactionally generated audit and revision checks. Temporary direct login is development-only. Microsoft-based Super Admin administration is live. Six editable role presets exist. Organization Setup now stores delivery units, departments, optional teams, direct department membership and current person-specific reporting lines with two expandable trees. Scoped permission bindings and workflow routing remain upcoming work; see ORGANIZATION_SETUP.md.

## Decisions still needed

Skill catalogue is implemented as the start of step 3: migration 007, restricted procedures, independently permission-checked API, search/pagination and editable proficiency definitions. My Skills now saves own self-assessed drafts through migration 008, with published choices, proficiency snapshots, per-record concurrency and atomic auditing. The catalogue remains empty until actual definitions are entered; no integration-test skills are retained. Evidence, submission and reporting-manager review are next; see MY_SKILLS.md. Requests/incidents remain in the plan with their routing/approval requirements preserved in REQUESTS_AND_INCIDENTS.md. AI now has a typed ToolRegistry/policy gateway and a read-only own-skills tool; provider setup and approved writes remain pending.

- Company tenant/app configuration and production SQL access. Personal development registrations and restricted profile access exist; see SSO_AND_PROFILE.md.
- Who can grant each permission, including scopes exceeding an N+1's authority.
- Map project ownership, demand approval, matching and IT support responsibilities to permissions within the six roles.
- Exact skill proficiency and workplace evaluation rubrics.
- Retention, evidence scanning, source integration and matching rules.
- Separate platform readiness from liveness; add database/auth readiness when configured.

These unresolved details are not simulated as completed functionality in the foundation.
