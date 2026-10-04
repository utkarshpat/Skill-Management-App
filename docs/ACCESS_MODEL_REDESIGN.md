# Access management: approved baseline

Status: user-approved Access Management baseline as of 4 October 2026. Future UI, backend, dashboard and AI access work must follow this contract. Approval of the design does not mean every scope or evaluator is implemented, and does not migrate production grants or replace currently enforced SQL checks. Named people and departments in the supplied specification are illustrative; actual relationships must come from current stored records.

## Locked invariants

1. Person, role and access are distinct. Permission, scope, relationship and workflow constraints must remain separate.
2. Hierarchy does not automatically grant authority. The explicitly defined current direct-manager skill-review policy is relationship-derived authority.
3. Access templates are reusable permission bundles. Scoped allow/deny exceptions require a reason and expiry.
4. Backend effective access is the canonical decision contract, with a `Why?` explanation. Sidebar, dashboard, AI tools and APIs consume projections of the same contract.
5. Unsupported actions and scopes cannot be assigned through the UI. OWN, DIRECT_REPORTS, TEAM, DEPARTMENT, DELIVERY_UNIT, ORGANIZATION and SPECIFIC_RESOURCE become operational only when backend and SQL enforce them.
6. Explicit DENY overrides ALLOW within its matching resolved scope. Workflow constraints, especially no self-review and current-manager verification, still apply after a permission allows the action.
7. Access mutations follow Preview → Recheck → Transaction → Audit. Existing unsupported grants are identified for review, never silently deleted.

The conceptual entry point is `EffectiveAccess(actor, action, resource, purpose)`. Purpose is server-defined or validated against an allowed server context; caller-supplied purpose cannot expand authority. Gather candidate grants/denies, resolve their current scope, then determine which denies actually match the resource. Return ALLOW/DENY with availability, applicable sources, scope, constraints and reasons; fail closed when required relationships cannot be resolved.

## Implemented baseline increment (4 October 2026)

- One backend decision/explanation registry drives existing `can` and reporting-review discovery, so sidebar, dashboard, AI tools and API gates share the same implemented-action policy. SQL independently enforces availability, active status, grants/denies and current claim/workflow constraints.
- `/api/effective-access` explains only the authenticated person's access. Access administrators can inspect a selected person through authenticated `/api/access/effective/:id` (or the gated demo equivalent). Summaries are not mutation authorization tokens.
- People & Access exposes selected-person effective decisions, assignments, exceptions, organization links and permitted history. Access templates retain existing role IDs. My profile exposes own access explanations; the existing `my_permissions` AI tool returns compact actor-bound reasons and constraints.
- Access and reporting/membership edits preview before confirmation, recheck current authority/input/revision, then use existing transactional SQL procedures and audit. Bulk template changes explicitly show per-person before/after and independent-save semantics; they are not one atomic bulk transaction.
- New or changed individual exceptions require reason and future expiry, persisted in SQL and audit. Legacy unsupported assignments and undocumented exceptions remain visible and may be retained unchanged or explicitly removed. They cannot be copied to newly assigned people or expanded silently.
- Migrations 031/032/033 add implemented-scope enforcement, exception reasons and trusted reporting edges for accurate deactivation preview impacts, and fail-closed reporting-chain integrity checks. They do not delete, rename or grant production permissions.
- Migration 034 and the resource evaluator narrow a specific claim decision to its current active owner, current direct manager, exact assigned reviewer and submitted state. Review detail returns an actor-bound `reviewAccess` explanation with claim ID/revision; it is not a save token. The decision endpoint and review AI recheck this resource contract, and SQL independently checks current records in its transaction. Historical submitted/decided records remain readable through the existing assigned-review history policy; private draft edits remain excluded. UI explains eligibility and disables decisions when current access cannot be resolved. No new grant scope is enabled by this increment.

- Migration 035 adds aggregate capability analytics over the same current active direct-report selector and search filter. Coverage counts distinct reviewed skill holders at the selected minimum level; its denominator is all matching active direct reports, including members with no reviewed claims. Approved claim category/level counts and assigned-pending counts exclude private drafts and other reviewers’ pending claims. Aggregate holder IDs support chart filtering without loading every employee’s private claim details. Roster pagination does not change chart totals. This does not enable new grant scopes or recommendation writes.

Scope rollout remains deliberately bounded: own personal/participant workflows, current assigned direct-report reviews, and existing organization-wide administration/catalogue actions. TEAM, DEPARTMENT, DELIVERY_UNIT, REPORTING_SUBTREE, capability intersections and SPECIFIC_RESOURCE assignment workflows remain unavailable until resource-specific service/SQL enforcement exists. Type-level scopes do not establish rollout support. Current direct-report review uses the reporting policy and exact claim constraints; an organization-wide review grant cannot create authority over unrelated employees.

The historical observations below explain the redesign; the implemented increment above supersedes observations about missing effective explanations and wholly separate person administration.

## The problem in the current product

People, reporting lines, role definitions, role assignments and individual overrides are edited on separate screens. The administrator cannot see one person's final effective access and why it exists. Permission choices also include planned workflows, while persisted grants currently support only OWN and ORGANIZATION. The policy domain has richer scope types, but their presence in TypeScript does not mean they are supported end to end.

Migration 030 gives current direct reporting managers review capability independently of role names. That fixes missing review navigation, but this relationship-derived authority must be explained alongside role grants and explicit denies. Adding further isolated sidebar conditions would recreate the same confusion.

## Four separate concepts

| Concept | Purpose | Example |
| --- | --- | --- |
| Person | Verified identity and active status | Khushi's employee record |
| Organization and reporting | Placement and current reporting relationships | Department, team, direct manager |
| Access template | Reusable actions with explicitly supported scopes | Personal learning, catalogue administration |
| Assignment or exception | Bind a template/scope to a person, or a documented temporary exception | Department reporting for one specific department |

An organizational title is descriptive. It does not grant access. Higher placement in the hierarchy does not automatically grant access to everything below it. A direct reporting relationship has one defined policy: the current manager can review the employee's assigned skill claim, subject to explicit deny, active status, the exact reviewer assignment and no self-approval. It does not imply profile editing, department administration or organization-wide browsing.

## Effective access and its explanation

Use a canonical backend access evaluator and an explanation contract. The browser receives a projection of authorized actions; it never calculates authority from role labels or user-supplied scope IDs. SQL reads and writes keep their final current-policy checks. Contract tests must demonstrate parity between discovery/explanation and actual SQL enforcement.

Each decision should expose: action, availability, allowed/denied status, scope type, permitted resource IDs or a narrowly defined relationship selector, source(s), reason and expiry where relevant. Do not expose arbitrary other people's assignments. Permission to inspect one's own explanation is distinct from administering another person's access.

Example explanations:

* Skill review: allowed for assigned claims of current direct reports; source is the reporting policy.
* Personal learning: allowed for this person's plans; source is the Personal learning template.
* Catalogue administration: denied; no applicable assignment.
* Skill review blocked: an applicable explicit deny overrides the reporting policy.

Evaluate implementation availability, actor/account status, current resource scope and workflow constraints, then applicable grants and denies. An expired or revoked assignment does not apply. An explicit deny wins inside its matching scope. Independent template allows combine; there is no role priority or "highest role wins" rule. An OWN deny must not silently become an organization-wide deny. Missing or ambiguous resource relationships fail closed.

Sidebar, dashboard, AI tool discovery and action controls consume this same decision contract. Endpoints and SQL independently recheck the actor, current scope and workflow state when executing. A visible link is never proof that a write is authorized.

## Administration UX

Replace the everyday role-checkbox matrix workflow with one **People & Access** workspace. Search and select a person, then view:

1. **Organization:** department/team and direct reporting manager, with a clear reporting tree.
2. **Assigned access:** named templates, their resource scopes and expiry. Reporting-derived review access is visible here as an automatic, non-editable source.
3. **Effective access:** grouped actions and a "Why?" explanation for each allowed or denied decision.
4. **Exceptions:** explicit allows/denies with a required reason and visible expiry. These are exceptional, not the default provisioning path.
5. **History:** actual changes, actor, time and before/after values.

Keep reusable template editing in a separate **Access templates** area. Use business labels and sensible permission groups. Show scope constraints and implemented availability for each action. Planned capabilities are informational and cannot be assigned as operational access. Preserve historical unsupported assignments visibly for review instead of silently deleting them.

A create/change flow is: select person → organization/reporting → templates and supported scopes → preview final access changes → save. The preview includes new/removed actions, scope changes, unresolved placement, conflicting denies and affected users for template changes. Previewing has no side effects. Saving uses current authorization, revision checks and a transactionally recorded audit. A failed save cannot appear as completed.

The large assignment matrix can remain an optional bulk administration view after the clearer individual flow exists. Bulk changes require per-target results and review; a partially applied operation must not be presented as fully successful.

## Scope model and rollout limits

Useful target scopes are own resources, current direct reports, specific team, specific department, specific delivery unit, organization and explicitly assigned resource. Each scope must have a server-resolved binding. A department assignment must identify the department; a generic string called DEPARTMENT is insufficient.

Only offer a scope when the corresponding service and SQL checks enforce it. Do not widen unsupported TEAM/DEPARTMENT/DELIVERY_UNIT scope to ORGANIZATION. Do not add department/head inheritance until its policy and data queries are defined and tested. Keep the current review policy narrowed by reporting and reviewer checks during migration.

Templates should describe actual work, such as Personal workspace, Skill review, Catalogue administration, People administration and Access administration. Department/unit reporting templates remain planned until those insights and their scope resolution exist. Custom role names remain compatible; no destructive rename or removal is required to introduce the clearer template presentation.

## Implementation sequence

1. **Effective-access explanation and implemented action registry.** Establish trustworthy allowed/denied, source, reason, scope and availability output. Audit existing grants and identify unsupported or overlapping entries without mutating them.
2. **People & Access person detail.** Combine organization, assignments, exceptions, explanations and history in one usable flow. Add explicit preview-before-save.
3. **Scoped assignments.** Add resource-bound persistence and enforcement one supported scope at a time, with revision/expiry/revocation handling.
4. **Migrate consumers.** Sidebar, dashboard and AI consume the common contract; remove duplicate decision rules once parity is verified.
5. **Reviewed data cleanup and bulk tooling.** Show concrete proposed changes and their impact before changing existing grants.

Regression coverage must include renamed roles, multiple templates, direct-report reassignment/removal, inactive employees/managers, explicit deny, expired grants, self-review, foreign account/resource IDs, forged scope bindings, concurrent changes, and consistent sidebar/AI/API/SQL decisions. Implement this baseline incrementally rather than broadly rewriting live permissions before that foundation exists.

## Refined scope and action contract

Use DIRECT_REPORTS for a person's current immediate reports and REPORTING_SUBTREE for current descendants, rather than a fixed N+2 designation. A senior manager may view a permitted subtree but may verify only claims belonging to their own current direct reports. A directly reporting manager's claim is eligible; that manager's employees' claims are not. Being in the same department or having an organization-level grant does not bypass that rule.

Department and delivery-unit membership scopes follow active stored organization bindings, independently of reporting relationships. Do not assume every reporting edge stays within one department. An organizational tree is a navigation aid, not an access grant: filter both drill-down nodes and records to the authorized scope without leaking out-of-scope names or counts.

Capability is an additional resource filter, not an alternative broad grant. A Cloud responsibility bound to Department A resolves to `Department A people AND Cloud capability records`, not the union of all Department A information and all Cloud information across the organization. An organization-bound Cloud responsibility retains the Cloud filter. Each independent assignment is resolved separately before combining its allowed resources; never combine the department of one assignment with the domain of another.

An extra assignment can expand permitted viewing/recommendation scope but cannot make a non-manager eligible to verify a skill claim. Review decisions still require the exact current assigned reviewer, a reviewable claim state, active account/people, no applicable deny and no self-review. A reassigned reporting manager must not silently inherit an obsolete reviewer assignment: expose the routing mismatch and require the established re-routing/resubmission workflow.

Preserve current action IDs during rollout. `skill.verify` is the current assigned skill-review action; do not introduce a parallel `skill.review` grant. Own claim editing remains a state-checked claim action, not unrestricted `skill.edit`. Capability viewing, recommendations and development assignment need defined action contracts and service enforcement before exposing new grants. Profile editing, evidence uploads, assessments, projects and matching listed in the supplied specification are target capabilities; their listing does not establish that those workflows are currently implemented.

For each decision: verify implementation and actor/account → resolve trusted resource context, scope and assignment validity → identify applicable denies/allows → require an allow with no matching deny → enforce relationship, field-visibility and workflow constraints → return the decision and explanation. Scope resolution must precede deny applicability; an OWN deny cannot block an unrelated subtree resource. Missing, cyclic or ambiguous relationships fail closed. Private AI chats, private drafts and sensitive profile fields do not become visible merely because their owner is in a reporting subtree.

## First deliverable

The first implementation increment should be a read-only effective-access and scope explanation service, with tests for the rules above. Its decision contract needs `action`, `implemented`, `allowed`, `reasonCode`, `sources`, `resolvedScope`, `constraints` and applicable validity. An action summary is distinct from authorization for an exact resource or mutation; summaries must not be reusable as write tokens. Resource IDs are computed by the server and returned only where the caller is permitted to inspect them. Large scopes require bounded pagination rather than sending every employee ID to the client or model.

Keep supported OWN, current direct-report review and existing SQL enforcement intact while introducing this increment. Planned scope/action combinations return an explicit unavailable result. Add People & Access explanations before enabling new broad responsibility assignments. No production role rewrite, automatic promotion of senior titles, or destructive cleanup is part of this design update.

## Current direct-manager learning recommendations (migration 036)

This increment explicitly defines a separate relationship policy for `learning.recommend`: an active current direct manager may recommend a published skill/level to a current active direct report. It does not use role names, does not inherit through a reporting subtree, and does not change the skill-review policy. The reporting chain must be valid. Applicable ORGANIZATION denies override this narrowly resolved policy; OWN denies cannot expand into another person's resource. The action's ORGANIZATION assignment compatibility is retained for explicit exceptions; a grant cannot authorize an unrelated recipient. Sender profile, own learning-view and published-catalogue access are prerequisites. Recipient needs own learning-view access. Only implemented combinations are exposed.

Recommendations are distinct records, with revision checks, scoped participant reads, transactional audit and recipient notifications. The employee owns the response. Accept requires own learning-manage permission and an explicitly reviewed new plan for the same published skill; the plan and acceptance commit atomically. Decline and discussion requests do not create plans. Accepted recommendations do not create a skill claim or verify proficiency. Existing received records remain visible to their owner after reporting changes, but response controls fail closed when the original sender is no longer their current active manager; sent views and notifications resolve the current relationship. Managers see recommendation responses and acceptance state, not private employee task logs or other plans.
