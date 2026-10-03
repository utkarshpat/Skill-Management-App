# Permission-based AI tool catalogue

Updated 3 October 2026. This catalogue separates registered tools from implementation contracts. A planned tool is not callable, and adding its name here grants no authority. Roles remain editable permission sets. The authenticated actor/account, current permission, resource ownership, reporting relationship and explicit DENY determine access.

## Registered now

All tools require an active person and effective `profile.view` for their own profile. The registry checks tool permission before and after retrieval. Source links come from application code. Search strings are bounded and passed to domain services, never interpreted as SQL, code, URLs or identity selectors.

| Tool | Inputs | Additional authority | Output and limits |
| --- | --- | --- | --- |
| `workspace_guide` | `{}` | Own profile | Current permitted pages/actions, step-by-step UI guides and explicitly pending workflows; no other person data. |
| `own_profile` | `{}` | Own profile | Own display name, employee code and role labels; labels cannot authorize anything. |
| `my_skills` | `{}` | Effective own `skill.view` | First 25 own draft summaries, total/page/hasMore; no private narrative or another owner. |
| `catalogue_search` | Optional `search` ≤100 characters, `page` 1–100 | Workspace `skill.view` or `skill.catalogue.manage` | Published skills only; 25 compact IDs/names/categories/level counts, catalogue revision and pagination. No draft/archived definitions. |
| `skill_claim_options` | Optional search/page; optional published `skillId` UUID | Own skill-view/claim capability plus workspace published-skill view, matching the My Skills UI | Five eligible published choices/page; selected ID must be in that search/page before returning its full criteria and definition revision. This never infers a level as fact or saves a draft. |
| `workspace_summary` | `{}` | Workspace `permissions.manage` and `users.manage` | Workspace people, active people, role and department counts; requires Organization service. |
| `present_output` | Existing bounded skill/task draft or 1–20-question practice card | Own profile; personal skill draft additionally requires effective claim capability | Presentation only: no record mutation, scheduling, submission or verification. Offered only for draft/quiz requests. |

Catalogue and claim tools are registered only when their backing services are configured. Unknown keys (including personId/accountId/status/URLs), malformed IDs, oversized searches, invalid pages and unsupported tool names are rejected. A missing selected skill requires re-search, not guessing or broadening access. Personal narratives supplied in the chat are not copied into another person's records.

## Next deliverable: conversational own-skill proposals

Build one complete vertical slice before introducing many executors:

1. Collect the person's contribution, experience duration and target skill; reuse supplied facts and ask only for missing ones.
2. Search the published catalogue; read complete proficiency criteria. Present ambiguity rather than silently choosing a match or claiming verified proficiency.
3. Validate an editable proposal for existing supported claim fields: published skill ID, definition revision, rank, experienceMonths and description. Editing an existing claim also requires its ID and expected claim revision.
4. Show the exact change and a single review/confirm action, optionally for a bounded batch. The model cannot press this approval button or treat ordinary chat text as an authorization token.
5. Persist the proposal in account-scoped SQL with actor, immutable validated payload/hash, expected versions, creation/expiry, status and approval/execution identifiers. Edited payloads invalidate prior approval.
6. Execute through the Claims service using the authenticated approving human, fresh policy/version checks and an idempotency key. Save and audit atomically; reconcile uncertain network outcomes. No partial batch success should be hidden.
7. Save as an unverified draft. Evidence submission and manager verification are separate, future workflow actions.

The current description handoff to the existing My Skills form remains available. Durable proposals and the approved executor are not implemented by this catalogue increment.

## Planned read and preparation contracts

Proposed inputs below are domain references, not a model-chosen actor/account. Every record must be resolved inside the caller's account and applicable scope. Resource IDs alone never confer permission. Existing permission codes are reused; narrow TEAM/DEPARTMENT/CAPABILITY scope bindings remain pending and must not be converted into ORGANIZATION grants.

| Tool | Bounded input contract | Authority and dependency |
| --- | --- | --- |
| `own_skill_details` | Own claimId UUID | Own `skill.view`; exact own claim and evidence permissions checked independently. |
| `propose_own_skill` | Supported claim fields; optional own claimId/expectedRevision | Own `skill.claim` + catalogue view; creates a proposal, not a claim. Next priority. |
| `propose_catalogue_skill` | Name/category/description/levels with catalogue bounds | `skill.catalogue.propose` in supported scope, or explicitly authorized catalogue maintenance; never self-publishes. |
| `read_reporting_context` | `{}` for own chain; authorized target reference for broader queries | Reporting relationships and privacy policy must be implemented explicitly. Own profile access does not automatically reveal all reports or other profiles. |
| `read_assigned_review_queue` | Page/filter from a fixed enum | Scoped `assessment.view`/`skill.verify` plus actual reviewer assignment; no role-label shortcut. |
| `read_permitted_evidence` | Evidence UUID | `evidence.view` + parent-claim/resource access; private Blob, scanning and retention must exist. |
| `extract_evidence_facts` | Permitted evidence UUID, allowed fact categories | Same evidence authorization, extraction/provider handling policy; referenced facts remain untrusted and AI-derived. No arbitrary uploads/URLs fetched by the model. |
| `read_learning_context` | Own goal/plan IDs, bounded date range/page | `learning.view` in applicable scope; persisted goals/tasks/attempts first. |
| `draft_learning_plan` | Skill/goal, current level, available time, target date/timezone | Effective own `learning.manage`; validated draft only. Today's practice preview remains separate. |
| `read_notifications` | Own page/unread filter | Own addressed events only; never workspace audit payloads or another recipient's inbox. |
| `read_requests` | Permitted request ID or own/assigned paginated query | `request.view`, ownership/recipient scope and routing service. |
| `draft_request` | Configured request type, description, validated resource reference | Own `request.create`; receiver derived from configured routing, never invented. |
| `read_incidents` | Permitted incident ID or own/assigned query | `incident.view` and record scope. |
| `draft_incident` | Title, description, allowed severity/category, attachment references | Own `incident.create`; no arbitrary assignee or resolution claim. |
| `read_demand` / `draft_demand` | Permitted demand ID/query; bounded project/skill/capacity fields | `demand.view` / `demand.create` plus project/resource access. |
| `read_matches` / `prepare_matching_run` | Approved demand ID; permitted constraints | `matching.view` / `matching.run`; explain verified versus claimed/inferred inputs and capacity. |
| `read_insights` / `prepare_report_export` | Allowlisted report/filter/date range | `reports.view` / `reports.export` in supported scope; export audit, destination/retention controls. |

## Planned approved action contracts

Preparation can run autonomously within permissions. Mutations require one explicit review of the exact proposal or batch. Approval is an authenticated UI/API event; it is not a model-callable tool. A background executor can consume that approved proposal while preserving actor attribution and all current policy checks.

| Action | Required authority and rules |
| --- | --- |
| Save own skill draft/update | Current `skill.claim`, own claim, published criteria/version; unverified status only. |
| Attach evidence / submit for review | `evidence.submit` / claim submission authority; scanned private evidence, current reporting-derived reviewer and explicit submit intent. |
| Publish/edit catalogue definition | `skill.catalogue.manage`; catalogue concurrency/version and publication validation; distinct from personal draft creation. |
| Apply a learning plan/reschedule | `learning.manage`; deterministic timezone/capacity scheduling, visible backlog effects and one approved change set. |
| Log learning completion | `learning.manage`; explicit actual completion, duration/notes and audit; opening content or asking AI does not count as completion/streak activity. |
| Start/grade persisted learning test | `learning.view/manage` as defined by Learning service; versioned attempts and authoritative scoring; never skill verification. |
| Submit request/incident or add comment | Relevant create/view permission, record scope, validated routing and side effects. |
| Assign/resolve request or incident | `request.assign/resolve` or `incident.assign/resolve`; allowed transition, actual assignee and revision. |
| Propose access changes | `permissions.manage` plus applicable people/grant authority; exact bounded grants, DENY/scope/expiry, administrator retention and no silent privilege escalation. Highest-risk actions follow their own review policy. |
| Approve business request/skill review | Actual assigned reviewer and `request.approve` or `skill.verify/assessment.approve`; separate human decision. AI may explain evidence but does not approve itself or verify its own draft. |

No generic `execute_sql`, shell, arbitrary HTTP/browser, unrestricted file access, email sending or blanket administrator tool is part of this design. External calendar/email integration requires a separate connector/service and explicit authorization; internal proposal approval does not authorize arbitrary external messages.

## Common execution and output standards

Read outputs carry bounded data, revision/coverage information and trusted source references. Draft outputs declare unsaved/AI-derived status and missing fields. Proposal cards show action, exact changes, target, assumptions, expected versions and expiry. Successful execution returns committed record IDs/revisions and audit reference; failure returns an actionable safe message, request ID and retryability without fabricating success.

Each new tool requires tests for unauthorized actors, explicit DENY/expiry, cross-account and foreign record IDs, revocation during retrieval/execution, unknown arguments, bounded paging, stale versions, altered/expired approval, idempotent retries and uncertain outcomes. Model output is never policy. One user's memory or cached tool results must not become another user's context.

Delivery order: approved own-skill proposals → evidence and assigned-manager review → persisted learning/calendar/backlog/tests → requests/incidents and notification producers → demand/matching/insights. Shared conversation/proposal persistence and durable token budgets are prerequisites for multi-instance deployment.

## Verification

The 3 October 2026 increment passes 73 automated tests (5 architecture, 60 API, 8 web), strict types and both production builds. New coverage verifies actor-bound searches, rejection of foreign selectors and unknown fields, published-only compact results, selected eligible criteria, unavailable IDs, claim revocation during retrieval, permission-derived guides, unconfigured/planned tools remaining absent and the three-round discovery/criteria conversation. A live Gemini synthetic check returned two trusted sources and the selected proficiency criteria in three model calls (3,656 reported input tokens and 116 output tokens). No employee data, Azure test writes or persisted sample catalogue records were used. This does not verify any planned executor or narrow team-scope implementation.
