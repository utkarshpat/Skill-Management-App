# Cognitive Intelligence Lab — Project Handover

Version: 2026-10-06. This is the maintained project handover. The interactive reader is `/knowledgetransfer`. Repository code and reviewed SQL migrations define implemented behavior; the approved Access Management baseline remains the policy authority. Schema and API inventories are generated from repository sources, not live database introspection. Never infer production readiness from documentation, a successful build, a role label or a schema name.

## Release Verification & Current Status

Recorded on 6 October 2026 (Asia/Calcutta). This is dated acceptance evidence, not live health monitoring. The verified application baseline is `main` commit `e1d1f3fa42484a5131b950813d0ae0e75d717e63`, deployed as `dpl_Cn6p1hQ2S8BAeHefdEhb4HaUCrZp` on https://skill-management-app.vercel.app. Later documentation deployments carry their own commit; do not substitute this historical record for a new deployment check.

| Gate | Observed result | Boundary |
| --- | --- | --- |
| Source consolidation | Only main/origin/main remain; clean worktree after consolidation | A local preserved stash is not an unmerged feature branch |
| Regression baseline | 271 tests passed; typecheck, build, architecture and generated-document checks passed | Tests establish tested behavior, not complete BRD delivery |
| Hosted SQL | Migrations 001–050 installed; 041–050 applied during release preparation | No startup seed/import or automatic application migration |
| Restricted runtime | Actor-access parity, audit denial, cross-account isolation, evidence procedure integration passed | Fixture transactions rolled back; does not certify every API path |
| SQL grants | SkillEvidence and ReadOwnOrganization execution verified; direct claim-table SELECT absent | Runtime remains separate from setup identity |
| Hosting | Vercel Ready and correct main source/domain verified | Ready is build/deployment status; runtime smoke is separate |
| Microsoft sign-in | User completed device authentication; real mapped account reached its authorized dashboard | One account tested; provisioning, consent and company tenant migration remain separate |
| Employee Chrome smoke | Dashboard, skills, profile, learning, requests, exact-claim notification link and AI response loaded | No blanket claim of all workflow mutation acceptance |
| Manager Chrome smoke | Assigned review/access explanation, team analytics, individual capability and recommendations loaded | No live proficiency decision submitted during this smoke |
| Private image round-trip | Synthetic QA PNG uploaded through UI; persisted after full reload and decoded preview verified | Existing synthetic demo draft stayed DRAFT; no submission or approval |
| Storage | PNG 15,672 bytes → stored WebP 11,504 bytes, 1600 × 900; private/no-store; anonymous direct blob request denied | Public Blob access disabled, HTTPS required, TLS 1.2; no retention/scanning policy implied |
| Anonymous API | Health 200; me/dashboard/my-skills/skill-reviews 401 without a session | Health is liveness only |

The uploaded sample is clearly labelled synthetic QA evidence on an existing demo draft. It is not employee capability evidence or a customer file. Verification screenshots and the detailed local run record are ignored local artifacts; credentials, cookies, identity tokens, employee rows and storage secrets are excluded from this handbook.

Current availability update, 6 October 2026: the restricted runtime SQL connection reports that the October monthly free allowance is exhausted and the database is paused until 1 November 2026, 00:00 UTC (05:30 IST). Hosted workspace and notifications returned HTTP 500 during the documentation deployment check. The earlier acceptance results above remain historical evidence; the application is currently unavailable for database-backed flows. This is a service quota issue, not proof of expired sign-in or an invalid demo PIN. A Vercel Ready deployment and liveness response do not establish database readiness. Azure offers immediate resumption with additional usage charges; enabling billing requires the owner's approval. Do not reset credentials or loosen SQL permissions to address this quota pause. After resumption, repeat authenticated workspace, notifications, KT reader/guide and core employee/manager smoke checks.

Core employee/manager flows passed the recorded acceptance run, but current availability is blocked by the SQL quota pause. Company production certification, exhaustive browser/accessibility acceptance, performance SLOs and the outstanding functional backlog are not complete. Temporary demo authentication remains deliberately deferred. AI uses read tools and reviewable drafts; it does not autonomously commit business actions.

Next work, one reviewed increment at a time: (1) primary capability and an explicit profile-completeness denominator; (2) certification records and expiry reminders with an approved verifier policy; (3) managed training catalogue/enrolment; (4) persisted project demand and matching; (5) formal assessment and broader scope enforcement. In parallel, measure latency and establish monitoring, recovery, secret rotation and evidence lifecycle operations before company hosting. See Short requirements delivery backlog for functional acceptance and Risks, Gaps & Production Readiness for operational gates.

Free-compute mitigation (6 October 2026): adaptive polling replaces unconditional minute-wise refresh. Only a visible, focused tab with interaction in the last two minutes polls: notifications every 90 seconds, dashboard/workspace projections every five minutes as a backup. Scroll, pointer and keyboard interaction extend the active window. Idle, hidden and unfocused tabs cancel scheduled requests; returning refreshes after one minute of staleness. Local mutation events refresh immediately unless failure backoff is active; overlapping changes coalesce into one follow-up. A changed complete notification feed signals the dashboard and an open review queue (without closing an open review). Request lists refresh automatically; request details/composers show an explicit updates-available action to preserve ongoing input. Dashboard and notifications expose last-successful-check and paused/retrying status. Partial/error responses do not advance that timestamp; failures back off from one minute up to fifteen minutes, with explicit Refresh/Retry still available. Actions always recheck backend/SQL access; no authorized data is cached by this scheduler. This is bounded polling, not push delivery or a guarantee that every business record changes within 90 seconds. Review queues/details and other pages retain their own explicit fetch/action contracts.

A detected SQL monthly-quota pause produces a safe 503 response where propagated and a 60-second per-instance connection cooldown without automatic retries; identity routes with independent failure handling retain their existing contracts. Azure rejected reducing auto-pause to 15 minutes because the current free/AutoPause configuration allows only the 60-minute default. Overage billing remains disabled. Adaptive refresh reduces avoidable requests and lets idle databases pause, but continuous active use still consumes SQL compute; it cannot guarantee that this free allowance covers the workload. These changes do not restore October's exhausted quota. Measure actual savings and remote-update acceptance after database resumption.

## Product & Business Requirements

Cognitive Intelligence Lab is a workforce capability and personal learning platform. Its purpose is to connect an employee's recorded skills, current manager's review, learning goals and requests for help without conflating self-assessment, practice results and verified proficiency.

| Requirement | Implemented behavior | Acceptance rule |
| --- | --- | --- |
| BR-01 Personal capability | Published-skill selection, proficiency criteria, experience, projects, evidence references and private compressed images | Own drafts stay private; submitted claims follow current assigned-manager checks |
| BR-02 Review governance | Review queue, decision feedback, direct-report capability profiles and analytics | No self-review; current active manager and exact reviewer assignment required |
| BR-03 Personal development | Plans, daily tasks, study sessions, practice, logs, backlog and recovery | Opening a task, saving study notes or passing practice never completes or verifies a skill |
| BR-04 Recommendations | Scoped manager recommendations and employee Accept / Decline / Discuss | Acceptance creates a reviewed personal learning plan; does not create an approved skill |
| BR-05 Help workflows | Requests/incidents, named recipient search, comments, start, resolve, reassign and cancel | Actor must have current permission and be an authorized participant for that action |
| BR-06 Access administration | People, templates, exceptions, reporting links, preview and explanations | Preview → Recheck → Transaction → Audit; scoped DENY overrides matching ALLOW |
| BR-07 Actionable dashboard | Authorized manifest, attention, learning, capability, requests and quick actions | Every card/action has implemented data and enforcement; no invented capability KPI |
| BR-08 Contextual AI | Read tools, reviewable drafts, planner, practice and project explanation | AI inherits actor access; no autonomous business writes or authority from prompts |
| BR-09 Usability | Light default, responsive layouts, reorderable navigation, pinned profile, clickable notifications | Loading, retry, empty and error states must communicate what actually happened |

Business personas describe needs, not access grants: employees maintain their own information; current direct managers review assigned submissions and recommend learning; authorized administrators manage people/access/catalogue. Broader department, delivery-unit and organization analytics remain bounded by implemented policy rather than hierarchy alone.

Success measures should be defined from real events: outstanding authorized actions, reviewed claims, completed scheduled tasks, resolved requests and accepted recommendations. No maturity score, gap percentage or assessment certification is implied without a defined denominator and source.

## Architecture & Trust Boundaries

One npm-workspace repository contains a React 19 + TypeScript + Vite frontend and an Express 5 modular monolith API. Azure SQL stores persistent business records. Vercel Services builds `web` and `api` independently behind one domain. `/api` and `/api/*` target `api`; other paths target `web`. Browser calls are same-origin HTTP. No server-to-server call requires a Vercel service binding today.

Request path: Browser → same-origin route → identity validation → effective access / input validation → owning module → restricted SQL procedure → transaction / revision / audit → authorized response. The UI is a discovery projection; it is never the final authority.

| Boundary | Responsibility | Must never cross |
| --- | --- | --- |
| Browser | MSAL SPA sign-in, forms, presentation, explicit review | SQL credentials, Gemini keys, arbitrary actor authority |
| API identity | Verify delegated token or gated demo session, resolve person/account | Treat caller-provided person ID as authenticated actor |
| Effective access | Implemented action, grant/deny, scope, relationship and workflow explanation | Infer permissions from organizational title |
| SQL runtime | Execute guarded procedures under restricted principal | Direct unrestricted table access or developer setup identity |
| AI provider | Generate bounded answers/drafts from selected authorized context | Receive credentials, execute SQL, select another person's authority |

Composition is `apps/api/src/server.ts` and `create-app.ts`; Vercel Express entrypoint is `apps/api/app.ts`. The frontend entry is `apps/web/src/main.tsx`. HTTP middleware installs Helmet, a request ID and a 128 KiB JSON parser. Module-level validation can impose smaller limits. Unknown API paths do not expose unfinished features.

This is a modular monolith, not nine independently hosted microservices. Runtime imports must use another module's public `index.ts`; frontend/backend source imports are forbidden. `scripts/check-architecture.mjs` enforces the source graph. Its guard is not an authorization sandbox.

## Module Ownership & Code Map

| Module | Owns | Public interaction |
| --- | --- | --- |
| identity | Microsoft token validation, development/demo sessions, own profile, notification composition | Actor resolution and authenticated HTTP contracts |
| access | Templates, assignments, exceptions, effective decisions, workspace manifest | `can`, effective-access explanations, AccessStore |
| organization | Organization nodes, placement and current reporting relationships | Validated organization contract and SQL persistence |
| skills | Catalogue, frameworks, immutable definition versions, own claims and manager reviews | CatalogueStore and ClaimsStore |
| learning | Personal plans, completion, sessions, practice, planner and recovery | LearningStore and typed learning changes |
| recommendations | Manager-to-current-report recommendations and employee response | RecommendationStore, validated acceptance plan |
| workflows | Requests, incidents, recipient discovery, lifecycle and events | Participant-bound WorkflowStore |
| dashboard | Authorized card registry/manifest and actionable aggregates | Independently loaded card endpoints |
| ai | Provider gateway, read tools, presentation artifacts, bounded memory, shared request budget, KT guide | AssistantService |

Shared `database.ts` manages restricted runtime connection lifecycle and separate short-lived setup connections. It does not own business rules. `shared/errors.ts` contains the HTTP-aware error contract. SQL procedures and migrations own the final persisted state and transaction checks.

Frontend major screens: `Workspace`, `Dashboard`, `MySkills`, `SkillReviews`, `Learning`, `Recommendations`, `Workflows`, `OwnProfile`, `AccessAdmin`, `AssistantWidget` and `KnowledgeTransfer`. Locate actual filenames through `rg --files apps/web/src`; business source ownership is more stable than incidental component names.

Runtime dependency graph: Identity → Access; Organization → Access; Skills → Access; Learning → Access; Workflows → Access; Recommendations → Access + Learning; Dashboard → Access; AI → Access + Organization + Skills. Additional injected contracts are type-only. Update guard tests if a genuinely necessary dependency changes.

## Identity & Effective Access

Person ≠ Role ≠ Permission ≠ Scope ≠ Relationship ≠ Workflow. A role/access template is only a reusable bundle. Microsoft sign-in verifies identity but does not automatically provision employees or infer administrators. Missing active membership fails closed. The API maps validated tenant/object identity to a current access person.

The conceptual evaluator checks implementation availability, active account/person, applicable grants and denies, server-resolved scope, relationships and workflow state, then returns ALLOW/DENY + WHY. Caller-supplied purpose or resource IDs cannot broaden authority. Matching scoped explicit DENY overrides ALLOW; expiry and revocation apply immediately at execution.

| Scope / policy | Current boundary |
| --- | --- |
| OWN | Implemented own profile, learning, claims and authorized participant workflows |
| ORGANIZATION | Only implemented administration/catalogue actions with actual SQL enforcement |
| Current direct reports | Explicit review/recommendation policy, current active reporting selector and exact workflow checks |
| TEAM / DEPARTMENT / DELIVERY_UNIT / REPORTING_SUBTREE / SPECIFIC_RESOURCE grants | Not assignable operational scopes merely because types or codes exist |

For skill review, check current active claimant, current active direct manager, exact assigned reviewer, submitted state and no self-review after the permission gate. Historical assigned-review records have a separate read policy; private employee drafts remain excluded. An organization-wide review grant cannot override these constraints.

Self explanations: `/api/effective-access`. Authorized administrators can inspect selected-person decisions via the access API. Explanations and previews are not mutation authorization tokens. Save rechecks identity, access and revision inside the transaction.

Approved target design is retained in `docs/ACCESS_MODEL_REDESIGN.md`. Any code change affecting access, dashboard, sidebar, hierarchy or AI must follow it. Unsupported historical grants remain visible for deliberate review; do not silently delete them.

## People & Access Administration

Migration 043 adds a read-only own-organization profile projection. `/api/me` resolves the authenticated profile, then reads only that person's stored placement and current reporting manager through `ReadOwnOrganization`; Microsoft and configured demo sessions use the same projection. Workspace name comes from the active account, department is resolved directly or through an active team's parent, and delivery unit comes from the active department parent. Invalid/inactive placement or reporting chains return an explicit needs-attention state without exposing unresolved names. No directory or manager identifiers are returned, no hierarchy-derived authority is added, and SQL rechecks own `profile.view`. My Profile distinguishes loading, unavailable, unassigned and needs-attention states; access templates are explicitly separate from job titles/grades. Primary capability and profile completeness remain unimplemented. Apply 043 before deploying this profile increment.

Migration 045 adds nullable business job title (100 characters) and grade (40 characters) to AccessPerson. People administrators maintain them in the existing person Details editor, using Preview → Recheck → Transaction → Audit; the confirmation shows server-normalized before/after values separately from effective-access impacts. The existing person-administration prerequisite remains both `permissions.manage` and `users.manage`; this increment does not enable a users-only administration surface. Assigned templates, exceptions, identity bindings and reporting policy remain unchanged. SQL independently validates input type and unbounded JSON length, preserves omitted values on legacy/bulk updates, and clears explicit null/blank values. Existing people start unassigned; titles/grades are not inferred from templates or hierarchy and do not grant authority.

Microsoft and configured demo `/api/me` projections return only the authenticated person's work fields. My Profile shows them read-only, with distinct unassigned, loading, unavailable and failed states. Legacy AppUser-only profiles without an AccessPerson link do not have these managed fields and are shown as unavailable, not guessed. No self-service profile write endpoint is added. Apply 045 before deploying; the opt-in `test:employment` setup-identity fixture runs against a migrated workspace and rolls all writes/audits back. The code increment did not apply migrations automatically; the dated release verification below records subsequent installation through 050.

The everyday workflow is Search person → Organization/reporting → Assigned templates → Effective access / Why → Exceptions → History. Exceptions require reason and future expiry for new/changed entries. Role names remain compatible with existing stored IDs.

Create/change: select exact target and supported actions/scopes → preview before/after plus unresolved relationships/conflicts → explicit Save → recheck active authority, expected revision and input → transactional persistence and audit → refresh effective decisions. Concurrent revision mismatch returns conflict and requires reload.

Organization placement and reporting are distinct. Editing current manager must preserve account boundaries, active references, no self-management and reporting-chain integrity. It does not implicitly grant subtree visibility. Preview includes affected review relationships; SQL verifies the current records again.

Bulk template changes have per-person outcomes and independent-save semantics, not a fictional single atomic bulk transaction. Legacy unsupported exceptions can be retained unchanged or intentionally removed; they cannot be copied or expanded as operational access. Do not mutate permissions simply to make a navigation link visible.

## Catalogue & Skill Claim Workflow

Catalogue definitions follow DRAFT → PUBLISHED → ARCHIVED governance. Proficiency frameworks/levels are shared definitions; skill-specific criteria are versioned. Publishing creates immutable definition versions used for historical claim criteria. The claim's definition revision/snapshot is historical data; it is not a declared foreign key to SkillDefinitionVersion.

Migration 044 introduces `enterprise-v2`: exactly five ranked labels, Awareness → Foundation → Practitioner → Advanced → Expert. The catalogue editor, API and SQL enforce these labels for every new or changed definition. Criteria remain skill-specific, editable and required at all five ranks before publishing. Existing definitions remain readable; the editor offers explicit alignment with a criteria review before Save. Mapping retains criteria at the same rank; missing ranks start blank and ranks above five are excluded only from the proposed new version.

For the dummy workspace, `npm run catalogue:seed -w apps/api -- --align-existing` previews mappings for all existing five-level definitions (including drafts/archives and skills without business codes). Add `--apply` after reviewing the plan to commit atomically through `SaveSkillCatalogue` under the configured linked Microsoft owner's current catalogue permission. Unsupported custom level counts fail the entire bulk plan for manual mapping; no guessed criteria or partial bulk writes. Skill identifiers, names, codes, categories and statuses are preserved; definition and workspace revisions advance with each audited write. Prior versions and claim/recommendation/learning snapshots are not rewritten, and no claim becomes verified. The original enterprise-v1 JSON and shared labels are retained as historical inputs; the seed adapter uses the new labels by rank for new skills. The default seed command still preserves existing business codes; it does not align them implicitly. Apply 044 before deploying or running alignment; the operator command is development-only and never runs at startup.

Employee flow: Search published skill → choose defined level → enter actual experience/projects/evidence references → Review → Save self-assessed draft → Submit to eligible assigned current manager. AI may prepare description text; it cannot invent experience or save the draft autonomously.

Migration 042 adds optional employee-reported `lastUsedOn` (`YYYY-MM-DD`) to skill claims. The experience step offers a date picker with inline validation and an explicit unknown/blank state; review and claim detail display the date separately from proficiency. API and SQL reject invalid calendar dates and dates after the current UTC day. Existing records remain unknown; an omitted field preserves the date on legacy updates, while explicit null clears it. Historical manager reads use the submitted audit snapshot, never a subsequent private draft edit. Recency is descriptive, not verification or an expiry rule. Deploy migration 042 before deploying this form/API increment; no new permission or scope is enabled.

Manager flow: Review queue → open assigned submitted claim → inspect evidence references and criteria → Verify/Approve, Request Changes or Reject with feedback → final current relationship/permission/revision recheck → SQL commit + audit + notification. Text/link references and private uploaded images are distinct. Images are decoded and re-encoded, but are not malware-scanned or independently certified evidence.

| Claim state | Meaning | Next authorized step |
| --- | --- | --- |
| DRAFT | Private self-assessment | Edit or explicitly submit |
| SUBMITTED | Assigned claim awaiting decision | Current eligible reviewer decides |
| CHANGES_REQUESTED | Feedback returned to employee | Employee revises/resubmits through supported flow |
| APPROVED | Manager-reviewed proficiency claim | Read as reviewed record; no AI auto-approval |
| REJECTED | Recorded non-approval decision | Preserve history and feedback |

Do not treat catalogue publication, course completion, practice score or recommendation acceptance as claim verification. Definition revisions and record revisions serve different purposes: definition versions preserve criteria; record revisions prevent stale updates.

## Team Capability & Recommendations

Skill Reviews provides Review Queue, Team Analytics and Recommendations. Team analytics uses current active direct reports, not arbitrary role-name routing. Roster search and chart filtering resolve the same scope. Aggregate exports omit identifying search text; filtered small cohorts can still be identifying. Recorded-rank chart averages consistently cap historical ranks above five at L5+, with explicit labels; they do not establish equivalence between different assessment frameworks. Manager AI demand actions appear only when server discovery advertises the configured model and implemented team tool. AI qualification requires an exact normalized published skill name; similar names require clarification before any qualification calculation. Pagination changes visible roster rows, not aggregate denominators.

Coverage = distinct matching active direct reports with a manager-reviewed skill at or above selected level / all matching active direct reports. Members with no reviewed claim remain in the denominator. This measures recorded coverage, not a business gap without a requirement. Reviewed proficiency/category counts and assigned pending claims remain distinct from private drafts and other reviewers' submissions.

View capability opens an individual manager-facing capability profile, separate from the employee's editable My Skills screen. It shows authorized records, not ownership transfer or permission to edit the employee's skills.

Recommendation: eligible manager → search current report(s) → published skill + target defined proficiency → reason + optional HTTPS resource + target date → explicit Send → recipient notification. Recipient can Accept, Decline or Ask for Discussion. Acceptance reviews a new personal learning plan; its creation and response use the owning transaction. The flow does not create an approved skill claim.

Migrations 048/049 integrate the pending access-read optimization with unique versions: actor-only effective-access projections preserve descriptive employment fields, and admin activity uses bounded cursor pagination. Personal authorization reads do not load the full directory/audit. Mutations and workflows still recheck current service/SQL authority. Installed restricted-runtime checks remain an explicit deployment gate; rollback setup tests are not evidence that the production procedures are installed.

Migrations 046/047 enforce own skill-view access on claim reads and provide a bounded actor-owned projection for skill-linked active/paused learning plans. The journey reads one recent recommendation page and the bounded claim projection independently; unavailable claim status does not hide learning tasks or imply that no claim exists. Additional recommendations remain available through the full Recommendations view.

Skill Growth Journey connects the implemented lifecycle: recommendation → accepted personal plan → logged learning tasks → an explicitly employee-created claim with their own experience/evidence → submission → current assigned manager review. The Learn & Grow journey reads existing recommendations, plans and personal claims; offers the appropriate next link/action; and displays learning progress separately from assessed proficiency. It does not invent evidence, create claims automatically, submit claims without confirmation, or approve proficiency. Formal certification, automated workplace assessment and broad organization gap matching are not implemented.

## Learn & Grow Workflow

Learning views: My learning, Learning paths, Goals, Growth journey, Recommendations, Today, Calendar and Backlog. Tab query parameters persist through refresh; changing tabs removes stale focused recommendation/plan parameters. Named notifications focus an exact recommendation using page one regardless of prior pagination. Growth journey combines the current user's received recommendations, linked non-archived learning plans and own claims; it links into existing review/learning actions and follows current claim permissions. It never interprets course/practice completion as claim verification.

Plan creation: Goal & time → optional focus + published skill mapping → daily tasks → Review → explicit Create. The manual plan supports 1–60 tasks, one per day, including weekends; each person retains at most 50 plans. Available minutes are validated. Skill mapping is derived from the same-account published catalogue, not a caller-supplied skill name. Debounced server search/pagination replaces downloading hundreds of definitions.

Study session has notes, draft actual minutes and up to five named HTTPS resource references. Saving a session does not complete a task. Explicit Log completion stores 1–480 actual minutes, optional notes and a server-owned UTC completion timestamp. Task completion is unique; stale/double writes are rejected. Resource links are never fetched as trusted content by the backend.

Practice generates 1–20 informal questions for the owned task. Stored quiz reads exclude answer keys. Attempt submission accepts quiz ID, request UUID and answer indices; SQL grades its stored key and assigns timestamp. Matching retries are idempotent; changed retries fail. Results/review explanations are owned data and do not verify proficiency or automatically complete a task.

Recovery previews a capacity-aware proposal for missed tasks. The user reviews before application; current plan/task revision and permission rechecks prevent overwriting concurrent changes. Pause / Resume / Archive are explicit actions; archived records/logs stay readable. LearningPlan payload stores task/log structures as JSON, not fictional LearningTask/LearningLog physical tables.

Monthly progress denominator is tasks scheduled for the month; logged time uses actual completed timestamps in the plan timezone. Streak derives from distinct qualifying actual completion days, continuing through today/yesterday. Opening a task does not count. No fake course enrolment, provider URL or proficiency improvement is inserted into empty states.

## Requests & Incidents Workflow

My requests and Assigned to me are participant views. Cards filter real records; search covers subject/reference/description with kind, category, status and priority filters. Categories include learning, skill, assessment, project, profile/access and other. Current priorities are NORMAL/HIGH, not every label shown in old mockups.

Compose: Topic → Details → search and visibly select a named recipient → Review & Send. The recipient is explicit; the app does not invent automatic IT routing, a line-manager approval stage or department triage. An eligible user can address an eligible person subject to current workflow checks. Being selectable does not grant all future lifecycle permissions.

| State/action | Actor boundary | Effect |
| --- | --- | --- |
| CREATE → SUBMITTED | Current create permission, valid active recipient | Record + committed creation event |
| COMMENT | Authorized current participant | Append timestamped event |
| START → IN_PROGRESS | Current addressed recipient + implemented action | Recorded transition |
| RESOLVE → RESOLVED | Current addressed recipient + implemented action | Recorded resolution note |
| REASSIGN | Authorized requester/current recipient + current checks | Explicit new recipient + event; no global assignment privilege |
| CANCEL → CANCELLED | Authorized requester + valid state | Preserve record and cancellation event |

Expected revision and event ID prevent stale or duplicate mutation effects. Detail responses expose canComment/canStart/canResolve/canReassign/canCancel based on the current resource. Buttons and AI draft affordances use these facts. AI can prepare editable comment/action notes; the normal UI rechecks and explicitly commits the action.

SLA promises, due timers, escalation engines, knowledge-base quick links, attachments, automatic assignment, approval/request-more-information states and incident priority matrices are not present solely because sample screenshots contained them.

## Dashboard, Navigation & Notifications

Dashboard = authorized work to do + changes to track + recorded capability. The backend builds an authorized manifest, resolves implemented scope and ranks action urgency. Cards load independently so one slow/failing card does not block every other card.

Hierarchy: Needs Attention → Today's Learning / My Capability → My Requests / Quick Actions → contextual AI assistance. Broader capability/gap/demand/matching cards require actual implemented scope/data before being displayed. Quick actions require both permission and a real implemented destination. No decorative metric should imply missing business functionality.

Same-revision dashboard refresh retains loaded data; transient refresh failures show a retry/status instead of blanking all cards. Authentication/permission failures clear affected data. Background workspace navigation refresh retains mounted unsaved forms on transient failures, but fails closed for denied access. Concurrent manifest loads are coalesced.

Sidebar links derive from backend effective capabilities; role labels and organizational titles do not create links. Dashboard stays high priority, My Profile stays fixed at bottom, logo is centered, and draggable grips permit per-person local ordering with reset. Local personalization cannot add an unauthorized destination.

Notifications aggregate addressed profile-change, review, workflow and recommendation sources independently. A transient source failure produces an explicit partial-feed message; authorization failures fail closed. Read/unread state is device-local, not a guaranteed cross-device inbox. Links use validated same-origin paths, reject control characters/backslashes and open the exact authorized resource with immediate loading feedback. Access is rechecked at the destination.

## AI Architecture, Budget & Memory

AssistantService owns bounded read orchestration. Provider is selected server-side by AI_PROVIDER/AI_MODEL; Gemini is the current deployment family. The repository default Gemini model is `gemini-3.8-flash`; an environment override can change it. Never claim the live exact model from source defaults alone. Azure/OpenAI-compatible and loopback-only Ollama adapters also exist.

Tool registry permits only server-registered read tools. It derives actor from authenticated context, validates tool arguments, filters discovery by current access and rechecks before/after retrieval and before returning generated output. The model cannot pass another person's actor or execute SQL/writes. Profile, own skills/learning, catalogue criteria, participant workflow detail/recipient search and eligible assigned reviews are bounded projections, not unrestricted database exports.

Generic chat has at most 12 incoming legacy messages / 12,000 characters; user messages cap at 2,000 characters. Current orchestration has bounded rounds and a 32,000-byte request-context limit; these are transport bounds, not exact tokenization. Task-specific output limits constrain answer/draft/quiz length. UsageMeter records returned provider usage without exposing credentials.

Durable AiConversation storage retains only two recent chats per actor and up to 20 recent exchanges per chat. The model working context keeps two recent complete turns and four short excerpts of older user requests. A process-local working cache expires after 30 minutes idle; durable saved conversations survive restarts and restore bounded context. Excerpts are untrusted and may omit facts. Permission-policy changes reset stale working context. KT guide history is separately transient and explicitly not persisted.

Hosted SqlAiBudget is shared across API instances: 10 requests per actor per UTC minute, 500 requests per account per UTC day, and one expiring 120-second actor lease. Release requires the exact lease ID; an old request cannot clear a newer request's lease. SQL failures fail closed. These are request budgets, not exact token-spend caps. MemoryAiBudget is a local/test fallback, not the hosted runtime guarantee.

Main assistant collapse resumes the same conversation/draft. Close starts a fresh chat on next open. Background response produces a reply badge; stale cancelled history cannot overwrite a new chat. Drafts open reviewable UI; autonomous request submission, skill approval, access edits and durable approved-write proposals remain unavailable.

Knowledge Transfer AI uses the same configured provider and shared budget, retrieves bounded matching documentation excerpts on the server, receives no employee records and has no application tools. Source context links are returned from trusted retrieval. It distinguishes implemented behavior, approved target policy and limitations; answers are explanations rather than deployment evidence. Never paste secrets or employee records into the guide. This temporary helper is isolated in its own module and never joins the core assistant tool registry.

## Database Schema & ERD

The interactive Schema Explorer contains physical tables, every parsed column/type/nullability/declaration, exact primary and unique key tuples, declared foreign keys, explicit indexes, source migrations and related-entity navigation. The ERD draws only declared foreign keys, including composite account keys. It does not fabricate foreign keys from JSON fields or procedural checks.

Schema reconstruction reads reviewed migrations 001–050. It is a repository-specific DDL extractor: literal CREATE TABLE, ALTER TABLE ADD, DROP TABLE, explicit indexes and CREATE VIEW are parsed. Dynamic CHECK removals in migrations 010/015/023/044 are reconciled explicitly. It is not a general T-SQL parser or a live database schema certification. Compare with DBA introspection before company migration.

| Domain | Persistence |
| --- | --- |
| Original identity foundation | Account, AppUser, AppRole, grants, membership and AuditEvent |
| Current workspace access | AccessWorkspace, AccessPerson, AccountRole, assignments/overrides, AccessAudit and implementation registry |
| Organization/reporting | AccessOrgNode and AccessOrgAssignment; not aliases for original Team/Department tables |
| Catalogue/claims | SkillCatalogue, framework/levels, immutable definition/criterion versions, SkillClaimDraft, claim notifications and SkillClaimEvidence |
| Learning | LearningPlan JSON task/log payload plus LearningSession, LearningQuiz and LearningAttempt |
| Recommendations | LearningRecommendation and LearningRecommendationEvent |
| Requests/incidents | WorkflowRecord and WorkflowEvent |
| AI | AiConversation, AiAccountBudget and AiActorBudget |

Important distinctions: SkillProficiencyLevel is a view after migration 012, not a physical table. Claim definition_revision has no declared FK to definition versions. Some actor/person/task fields are validated in procedures without a physical FK. AI budget tables intentionally have no declared person/account FK. Do not draw these as enforced relationships. JSON payload shape is a domain contract; migration presence alone does not establish successful deployment.

Migration 039 removes audit data from routine authorization snapshots when requested and changes workspace read to shared serializable locks. Notification audit is addressed-person filtered. Hydration uses Maps instead of repeated per-person filters. Migrations 048/049 subsequently add actor-only authorization reads and bounded cursor-based admin audit. Full workspace snapshots remain for flows that explicitly require them; neither optimization removes execution-time access checks.

Migration 040 adds the atomic shared AI quota/lease procedure and runtime execution grant. Apply 039/040 before deploying code depending on those signatures; no silent fail-open fallback exists. Neither migration grants new business authority or deletes historical grants.

## API Contracts & Error Handling

The interactive API inventory lists literal registered HTTP routes, owning module and source file. It is a discovery inventory, not a complete OpenAPI request/response specification. For exact payloads use the owning TypeScript validators/interfaces and SQL procedure. Middleware mounts/aliases are identified by source; do not assume a route list itself grants access.

Standard mutation flow: authenticate → server actor/account → current permission/resource → exact validated fields → expected revision/idempotency key → SQL guarded transaction → audit/event → refresh response. Reject unknown fields, forged actor/score/timestamp, cross-account IDs, invalid dates and unsupported state transitions.

| Response | Meaning | Client behavior |
| --- | --- | --- |
| 400 / 413 / 422 | Invalid or oversized input/context | Explain and allow correction; do not save partial invalid state |
| 401 | Missing/expired valid session | Recover sign-in; clear protected data |
| 403 | Current access/resource policy denies action | Stop action; do not retry with a broader supplied scope |
| 404 | Record not available in current scope | Show unavailable, do not disclose foreign existence |
| 409 | Stale revision / changed record | Reload and explicitly review again |
| 429 | Shared/local quota or active reply | Show bounded retry guidance; no unlimited automatic retries |
| 502 / 503 / 504 | Provider/storage unavailable or deadline | Keep safe drafts and show retry; never claim committed success |

Responses include an X-Request-Id; structured errors include correlation where supported. `/api/health` is process liveness only: it does not prove SQL, SSO, grants or model readiness. Unknown /api routes are closed. Preserve generic error messages that do not leak driver secrets.

## Setup, Configuration & Deployment

Use Node 24, npm workspaces and the pinned package lock. Copy `apps/api/.env.example` into ignored `apps/api/.env`, and web example into ignored `apps/web/.env.local`. Never commit real values. `npm ci` installs; `npm run dev` starts API 3001 and Vite 5173. Registered local Microsoft SPA callback uses localhost:5173; API liveness uses 127.0.0.1:3001/api/health.

| Configuration names | Purpose / handling |
| --- | --- |
| VITE_ENTRA_TENANT_ID, VITE_ENTRA_WEB_CLIENT_ID, VITE_ENTRA_API_CLIENT_ID, VITE_AUTH_REDIRECT_URI | Public SPA registration identifiers/callback; never provider/SQL secrets |
| ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID, ENTRA_WEB_CLIENT_ID | Server delegated-token validation configuration |
| ACCESS_ACCOUNT_ID | Explicit provisioned workspace account UUID; not chosen by browser/model |
| AZURE_SQL_SERVER, AZURE_SQL_DATABASE | Target SQL endpoint/database |
| AZURE_SQL_RUNTIME_AUTH, AZURE_SQL_CLIENT_ID, AZURE_SQL_CLIENT_SECRET, AZURE_SQL_MANAGED_IDENTITY_CLIENT_ID | Restricted runtime credential; managed identity for future Azure hosting |
| AI_PROVIDER, AI_MODEL, AI_ENDPOINT, AI_API_KEY, GEMINI_API / GEMINI_API_KEY | Server-only model configuration; never VITE variables |
| EVIDENCE_STORAGE_CONNECTION_STRING, EVIDENCE_STORAGE_CONTAINER | Server-only private Blob configuration; never expose credentials or raw blob paths to the browser |
| DEV_DIRECT_LOGIN | Development-only direct login flag, false in production |
| HOSTED_DEMO_LOGIN, PUBLIC_APP_ORIGIN, DEMO_LOGIN_ACCESS_CODE, DEMO_SESSION_SECRET | Temporary gated hosted demo; exact trusted origin and server-only secrets |

SQL setup commands use developer DefaultAzureCredential and close their connections. Runtime uses a separate restricted principal with procedure execution permissions. `npm run db:check -w apps/api` reports schema versions. `db:migrate` applies reviewed outstanding migrations via one worker with transactional version checks; migration 001 owns its initialization transaction. `access:import` is an explicit provisioning operation, never ordinary sign-in onboarding. Do not rerun seed/import tools casually against an existing live account.

Entra setup: register separate single-tenant SPA and API applications; expose delegated `access_as_user` on the API and configure that delegated permission on the SPA. Register exact SPA redirect origins (localhost:5173 for local development and the stable HTTPS production origin followed by `/`). Use authorization-code/PKCE; no browser client secret. The API validates RS256 signature/JWKS, issuer, tenant, audience, lifetime, token version, delegated scope and configured SPA caller before mapping an active member. Consent and membership provisioning are separate operations; never infer onboarding from a successful Microsoft login.

For local setup, sign Azure CLI into the intended tenant/subscription before using developer DefaultAzureCredential; portal sign-in alone does not authenticate Node tooling. Vercel runtime uses `AZURE_SQL_RUNTIME_AUTH=client-secret` with the separately provisioned restricted principal, not the developer owner. On future Azure hosting, explicitly configure managed identity and grant only needed procedures. The previously recorded development credential expiry is 1 November 2026 at 00:00 UTC: inspect the current approved secret inventory and rotate before its actual expiry. Real secrets belong in an approved secret store, not Git or the handbook. TLS and certificate validation stay enabled.

The personal Azure SQL deployment historically used the free serverless offer with overage disabled and AutoPause on exhausted allowance. Its broad development firewall is not a company network policy. Verify current plan, firewall, quota and cost settings in the environment; do not treat historical free-offer limits as a pricing guarantee. Company migration provisions independent SQL, Entra registrations and approved networks, maps identities/reporting explicitly, and migrates approved data separately. Never copy personal credentials or assume object IDs survive a tenant change.

Vercel project is `skill-management-app`, production https://skill-management-app.vercel.app. Root vercel.json defines services/routing; frontend SPA rewrites must include every supported deep link, including /knowledgetransfer. Shared environment settings supply secrets to server only. Bindings are currently none because browser calls API same-origin and services do not call each other at runtime.

Import the repository at its root. `apps/api/app.ts` is the Express deployment entrypoint, importing `src/server.ts`; Vercel owns the listener when `VERCEL=1`. The injected factory is `src/create-app.ts`, avoiding a generated app.js collision. The API bundle includes root package metadata for ESM and clears its own dist before compilation so cached orphan outputs cannot replace the entrypoint. No migration/import is executed at request startup. Preview domains need separately approved callbacks and isolated credentials; do not attach arbitrary previews to the live workspace. Hosted SQL connectivity must be measured from the function, because liveness and laptop connectivity do not establish it.

Temporary hosted demo discovery returns a locked gate without roster data. The access code unlocks active unlinked test people; Microsoft-linked people remain excluded. Signed Secure/HttpOnly/SameSite=Strict cookies last 30 minutes. Mutations require the configured exact HTTPS origin. Demo test identities share their actor-scoped records and recent conversations. Disable `HOSTED_DEMO_LOGIN` and redeploy before company rollout. Do not place the code, signing secret or cookies in documentation.

Release: review diff → test/build/typecheck/architecture → apply required compatible SQL migrations → validate restricted runtime → commit/push → Vercel Ready for exact commit/domain → browser smoke tests → record actual verification. Never deploy signature-dependent code ahead of migrations. A frontend build success is not API runtime proof.

## Operations, Testing & Runbooks

Run `npm run architecture:check`, `npm run typecheck`, `npm test`, `npm run build`. CI installs with npm ci and enforces its configured checks. The consolidated main baseline passed 271 automated tests (5 architecture, 179 API, 87 web); use the latest run output for current counts. Do not freeze a historical count as an acceptance promise.

Opt-in SQL integration suites in apps/api/package.json cover organization, catalogue, access, reviews/review-access, claims, conversations, learning, recovery, practice, workflows/lifecycle and recommendations. They require configured Azure identity/network/runtime. Read each fixture's mutation/rollback behavior before running it against any live workspace. `runtime-optimization.integration.ts` verifies 039/040 inside rollback-only test transactions and supports installed migrations.

| Symptom | Investigation | Safe recovery |
| --- | --- | --- |
| Sign-in succeeds but workspace denied | Membership/active account, tenant/audience/scope, trusted mapping | Authorized admin fixes membership; do not infer role from sign-in |
| Sidebar lacks review | Current direct-report policy, active people, deny and implementation | Inspect effective-access Why and actual reporting assignment |
| Save returns conflict | Record/workspace revision changed | Reload, preview again and review exact change |
| Notifications partly unavailable | Identify failing source, request ID, SQL/provider logs | Retain successful sources; retry without hiding partial status |
| AI busy/unavailable | Shared budget, active lease, provider key/model/quota/deadline | Wait bounded lease or repair configuration; never disable access checks |
| Deep link returns 404 | Root Vercel web SPA rewrite | Add actual supported route and verify deployed direct reload |
| Slow dashboard/login | Cold starts, SQL wake/connect, repeated snapshots, card queries | Measure before/after; use independent loading, bounded reads and no stale permission cache |

Browser regression must cover refresh/back navigation, direct links, notification focus, unauthorized routes, empty/error/retry, unsaved form retention, theme/responsive layout and AI close/collapse/history races. Authorization tests include renamed roles, multiple templates, expired/denied grants, manager reassignment/deactivation, self-review, foreign account/resource IDs and live revocation during generation.

Rollback: inspect the exact failed deployment, revert application commit or promote a verified compatible deployment through the configured host. Check whether old code remains compatible with installed procedures. Do not automatically drop additive migrations or business data. DBA-reviewed backups/restore and migration rollback plans are prerequisites for company hosting; no restore exercise is implied here.

## Risks, Gaps & Production Readiness

Current hosting is a personal/demo deployment, not enterprise production certification. Temporary demo-login PIN attempt throttling and durable signed-session revocation remain deferred by explicit user direction. Hosted logout does not revoke an already copied signed cookie for its remaining fixed lifetime; account activity/current permission checks still apply. Do not silently claim these issues fixed.

Implemented hardening includes restricted runtime procedures, input validation, revision/audit checks, exact-manager policy, bounded provider context, shared request budgets and protected read tools. This does not prove all paths secure or establish an exact AI cost ceiling.

Remaining work: further resource-query optimization based on measurements; measured production latency budgets; stronger demo/real SSO onboarding and revocation; company tenant/network review; secret rotation; evidence scanning, retention, delete/replace and orphan reconciliation; readiness/monitoring/alerts; backups/restore exercise; formal assessments; external calendar/rest-day scheduling; real demand/matching and wider-scope analytics; durable approved AI proposals/idempotent executors; comprehensive phone/browser accessibility acceptance.

Unsupported grant scopes and mockup-only modules must remain unavailable. Recommendations are not verification; missing evidence is not proof of inability. Do not treat top-down hierarchy as unrestricted access. See approved baseline before implementing any new scope or approval workflow.

## Handover Checklist & Documentation Maintenance

New engineer reading path: Product requirements → Architecture → Access → Claim workflow → Learning / Requests / Recommendations → Schema explorer → API inventory → Setup → Operations → Risks. Use the KT guide to ask follow-ups about the current section or selected table; inspect its source context before acting.

| Handover check | Evidence required |
| --- | --- |
| Repository/build | Clean intended diff, reproducible npm ci, passing types/tests/build/guard |
| Identity/access | Configured tenant/mapping/runtime account; deny and relationship tests |
| Database | Applied versions and restricted execution checks; separately verify live schema |
| Product workflows | Actual employee + manager journeys; no mock-only actions |
| AI | Correct configured provider, shared quota, no credential exposure, no autonomous writes |
| Deployment | Exact Ready commit and domain, required migrations first, production smoke record |
| Operations | Ownership, secret rotation, incident escalation, monitoring and rollback/restore agreed |
| Known gaps | Demo risks, unsupported scopes, attachment/formal assessment limits explicitly accepted |

Canonical text is `docs/HANDOVER.md`; approved access policy is `docs/ACCESS_MODEL_REDESIGN.md`. The operator companion [Azure migration with data](AZURE_MIGRATION_RUNBOOK.md) covers free-offer eligibility, source export, target setup/import, private Blob copy, cross-tenant identity/runtime remapping, release gates and rollback. It explicitly distinguishes full migration from fresh setup and records the current quota-paused source blocker; no successful migration or backup is implied. `scripts/generate-handover.py` includes these maintained documents and regenerates the bundled sections, table/FK dictionary, latest SQL procedure/function signatures, migration inventory and literal route inventory. The migration steps are also searchable in the temporary KT reader/AI guide. `npm run docs:check` detects stale output. Generated content contains repository structure and schema, never environment values, employee rows or secrets. The maintained Markdown remains readable without the temporary web reader.

Older topic documents were consolidated after reconciling implemented source behavior; Git history preserves historical plans/acceptance notes. They are not retained as competing current truth. Changes must update the canonical text, regenerate, then test. New migrations require reviewing the repository-specific extractor's supported DDL and dynamic constraint reconciliation. Keep runtime evidence and approved targets distinct.

## Temporary Feature Removal

Permanent schema/API/SQL inventory is retained in `docs/REFERENCE.generated.json`; it contains no live rows or secrets. It remains usable when the temporary UI/API is removed. After removal, set the documentation scripts to `python scripts/generate-handover.py --offline-only` and `python scripts/generate-handover.py --offline-only --check` to maintain that offline reference without recreating the KT module.

The KT reader/AI guide is a temporary, isolated feature. It requires no database migration, new permissions, business tables, scheduled job, seed record or sidebar-order change. Its request budget is the existing shared AI budget. Discussion stays in the current page memory, is bounded to recent turns and is not written to durable employee conversations.

Quick disable: set server `KNOWLEDGE_TRANSFER_ENABLED=false` and redeploy. The default is enabled for this requested handover deployment. Both content and explain endpoints return a disabled-feature 404; the page shows the unavailable state and Back to workspace. Disabling the guide does not disable the normal application assistant. Do not remove shared AI budget tables or alter access grants when retiring KT.

| Removal location | Exact action |
| --- | --- |
| apps/web/src/knowledge-transfer/ | Remove the isolated reader, CSS and types |
| apps/web/src/App.tsx | Remove the KT lazy import, `isKnowledgeTransfer` flag, KT render branch and workspace-refresh bypass; remove that flag from the effect dependencies |
| apps/api/src/modules/knowledge-transfer/ | Remove service, routes, index and generated content |
| apps/api/src/create-app.ts | Remove KnowledgeDependencies type/import/intersection and registerKnowledgeRoutes call |
| apps/api/src/server.ts | Remove KnowledgeTransferService import, knowledgeTransfer construction and dependency property; keep provider/aiBudget used by the core assistant |
| apps/api/src/modules/ai/index.ts | Remove AiBudget type re-export if no other consumer needs it |
| scripts/check-architecture.mjs | Remove only knowledge-transfer module/dependency entries; preserve the nine core modules |
| vercel.json | Remove only knowledgetransfer from the web deep-link rewrite |
| apps/api/.env.example | Remove the KT feature flag entry |
| tests and documentation scripts | Remove KT-only tests; adapt generator to an offline docs output before removing its KT bundle destination |

Keep README, this permanent handover and the approved access baseline. If offline schema export is still required, redirect the generator output to an approved documentation artifact first. Run architecture/typecheck/full regression/build after removal, push, then verify dashboard, own skills, learning, notifications, manager reviews and normal AI in the deployed environment. No data cleanup or permission migration is required.


## Short requirements delivery backlog

The discussion draft in `apps/short requrement` supplies business outcomes. Its suggested Power Platform architecture and role labels do not replace the implemented React/Express/Azure SQL stack or approved effective-access baseline.

Implementation order after the audited foundation passes combined SQL/browser regression:

1. Profile: administrator-maintained primary capability and a transparent completeness denominator, with missing-field actions permitted by actual access.
2. Certifications: credential/provider/skill references, issue/expiry dates, employee evidence, defined verifier policy, expiry status and deduplicated 90/60/30-day reminders. A credential never silently verifies proficiency.
3. Training: maintained catalogue, enrolment, completion, scores and evidence, distinct from generated practice and personal task completion.
4. Projects/demand: persisted required skills, saved assessment criteria/proficiency, headcount, priority and requirement periods.
5. Matching: compare approved demand with authorized reviewed records and resource availability; explain each factor and do not infer qualification from similar skill names.
6. Formal assessments and wider analytics: implement explicitly approved assessor policies and server/SQL-enforced scopes before exposing project/panel/department/organization actions. Reporting hierarchy alone is not access.

Each increment requires implemented actions, current permission checks, genuine loading/error/empty states, regression tests and Chrome acceptance before deployment. These backlog items are not completed features.

## Image evidence and shared interaction feedback

Migration 050 adds `SkillClaimEvidence` and `SkillEvidence`. Images live in the private Azure container; SQL holds actor-bound claim references, dimensions and byte counts. Owners need own profile/skill read plus claim/catalogue access to upload to an editable saved claim. Current exact assigned-manager history policy controls reviewer reads; SQL rechecks scope and expected claim revision in the add transaction. Six images per claim, 1 MB stored per image, maximum 1920 pixels per side. Upload advances claim and workspace revisions and adds an audit event. Submitted/approved evidence cannot be mutated. External text/link references remain supported separately.

The browser accepts JPEG/PNG/WebP up to 10 MB, resizes and compresses before uploading; the server decodes again, rejects other/animated formats, strips metadata and encodes WebP. Blob references never become public URLs or SAS links: authenticated API image reads recheck current access. Original images are not retained. A failed SQL attach triggers best-effort Blob cleanup; interrupted requests can leave an orphan requiring an operational reconciliation job (not yet implemented). No evidence delete/replace UI is offered yet. No image content is sent to AI.

Configure server-only `EVIDENCE_STORAGE_CONNECTION_STRING` and `EVIDENCE_STORAGE_CONTAINER`; never use a VITE variable. Apply 050 before enabling upload. Container must have no public access. The personal/demo production deployment has hosted storage configuration and a verified upload/read round-trip as recorded above. This does not establish company-approved storage governance, retention, scanning or recovery. New claims save first; Save draft opens evidence in place before submission. Review content and decisions share a single dialog; detailed criteria/history/AI are expandable.

Migration 051 fixes draft-image visibility after a claim is returned or rejected. Owner reads retain all attached images; current assigned-reviewer reads include only images with a matching `claim.evidence.added` audit revision before that claim's latest `claim.submitted` audit revision. A later upload becomes visible on resubmission, not on upload or draft save. Revision ordering avoids equal-timestamp ambiguity. Existing records are not backfilled, relabelled or removed: pre-051 images with existing upload/submission audit provenance work with the same filter. Missing submission history explicitly fails; images without matching upload provenance remain owner-visible but are excluded from reviewer reads rather than guessed from timestamps. Preserve these audit records during data migration/retention work.

Both image lists and direct authenticated image reads use the same SQL selection. Image downloads recheck access and membership of the specific image after retrieving Blob bytes. Existing current-manager, exact assigned-reviewer, active-person, deny and no-self-review constraints remain unchanged. The UI explains new-image privacy and latest-submission visibility. The opt-in `test:evidence-snapshot` fixture applies the new procedure within an outer rollback transaction against a schema through 050, creates synthetic people/claims/audits, covers changes/rejection/resubmission/approval, identical timestamps, absent provenance and access/stale-upload denials, then rolls back all SQL/DDL. It does not upload blobs.

On 6 October 2026, after operator-completed Azure CLI sign-in, the setup connection to `skill-management-dev` succeeded, confirmed versions 001-050, applied migration 051 and confirmed versions 001-051. The rollback-only evidence snapshot fixture then passed all scenarios above; no Blob writes or fixture records persisted. This establishes that the configured database was reachable during this operation, superseding the earlier quota-pause observation for this connection at that time. It does not establish how hosting/quota configuration changed, ongoing availability, a deployed frontend/API version or authenticated hosted browser acceptance. Those deployment checks remain separate.

Application authenticated HTTP failures and successful business mutations emit shared dismissible toast feedback. Reads do not emit success toasts. AI generation/login successful requests do not masquerade as saved business changes. Inline errors and recovery controls remain present; toasts supplement them. Dialog-local toast hosts render inside the browser top layer, and the global host suppresses duplicate delivery while a dialog is open. Toast scope does not claim coverage for raw-fetch legacy login flows or every bespoke client validation path.


## Short Requirements Audit — 6 October 2026

Source: `apps/short requrement` (discussion-draft BRD). Technology recommendations (Power Apps, SharePoint, Power Automate, Power BI) are excluded from functional acceptance; resource-language requirements are deferred by the user. This is a repository implementation audit, not production acceptance.

| Business requirement | Current state | Remaining acceptance work |
| --- | --- | --- |
| Employee profile | Partial | Work fields, organization and current manager are implemented; primary capability and profile completeness are not. |
| Skill profile | Implemented in the personal/demo release | Published catalogue, saved proficiency, experience, last-used information, evidence links and private compressed images. Migrations through 050 and hosted storage were verified; evidence retention/scanning/delete remain separate gaps. |
| Assessment | Partial | Self-assessment, exact assigned current-manager review, feedback and audited decisions. Project/technical/certification/panel assessment are not implemented. |
| Five-level proficiency | Supported with versioned definitions | Published levels govern each claim; historical frameworks must not be silently relabelled or treated as equivalent. |
| Certification | Not implemented | Provider, issued/expiry dates, certificate evidence, verification and certification dashboards. A generic evidence attachment is not a certification record. |
| Learning | Partial | Goals/plans/tasks, recommendations, acceptance-to-plan, progress and practice exist. Managed training catalogue/enrolment, formal course score and certification completion require dedicated workflows. |
| Project demand and matching | Not implemented end to end | Team requirement analysis and scoped AI explanations exist; they do not establish persisted project/headcount/period demand, allocation or organization resource matching. |
| Analytics | Partial | Own dashboard and current direct-report coverage/levels, requirement-based team gaps and drill-down. Certification, workforce/future-demand and organization-wide matrices remain pending. |
| Automation | Partial | Workflow notifications and recommendation actions exist. Scheduled certification expiry reminders (90/60/30 days), incomplete-profile reminders and recurring skill-review cycles remain pending. |
| Security and governance | Bounded implementation | Effective permissions, own scope and exact current-manager constraints are enforced. TEAM/DEPARTMENT/DELIVERY_UNIT/organization capability scopes remain unavailable until resource-specific SQL enforcement exists. Temporary demo authentication remains an explicitly deferred infrastructure concern. |

Release assessment: core employee/manager MVP is on track, but neither the complete BRD nor production acceptance is finished. Code checks cannot certify deployed procedures, runtime database grants, storage secrets, response times, backups or rollback. Apply compatible required migrations, check the restricted runtime, and smoke-test the exact deployed commit before declaring a stable release. The audit branch and reviewed local cleanup were consolidated on `main` on 6 October 2026. The backup branch was removed after consolidation; earlier local changes remain preserved in a named local stash; their optimized readers were already integrated with migrations renumbered to 048/049. The merge itself did not apply SQL migrations or configure storage; subsequent release verification is recorded in the dated chapter above. Only main/origin/main remain after branch cleanup. Do not deploy signature-dependent code ahead of SQL.

Dashboard cards now form independent desktop columns: attention stays first; learning and requests share one stack, capability and permitted quick actions share the other. Narrow layouts stack those same groups in DOM order. No placeholder/fake card fills the height difference, and unauthorized cards remain absent.
