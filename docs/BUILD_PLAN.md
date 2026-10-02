# Incremental build plan

Baseline: shared planning chat and full final engineering handover, reviewed 2 October 2026. Handover remains a draft; implementation decisions must be documented.

## Agreed direction

React, Node.js, Azure SQL, private Blob Storage, organizational SSO. No MCP. AI uses an internal allowlisted Tool Registry through an authorization/policy gateway.

Updated user decision, 2 October 2026: roles and people are administrator-defined. Super Admin creates names, roles and permission assignments; individual IDs can receive or lose permissions independently of roles. The six earlier role labels are legacy migration seeds, not the required role model. Policy checks permission codes and resource scopes, never role names. Organizational reporting relationships remain separate from access roles; N+1 is resolved from reporting data. Taxonomy governance and other responsibilities are assigned through permissions rather than hard-coded titles.

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

## Decisions still needed

- Company tenant/app configuration and production SQL access. Personal development registrations and restricted profile access exist; see SSO_AND_PROFILE.md.
- Who can grant each permission, including scopes exceeding an N+1's authority.
- Map project ownership, demand approval, matching and IT support responsibilities to permissions within the six roles.
- Exact skill proficiency and workplace evaluation rubrics.
- Retention, evidence scanning, source integration and matching rules.
- Separate platform readiness from liveness; add database/auth readiness when configured.

These unresolved details are not simulated as completed functionality in the foundation.
