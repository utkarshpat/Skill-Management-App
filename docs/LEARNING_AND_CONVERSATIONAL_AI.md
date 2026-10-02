# Learning and conversational AI requirements

Status: requirements and proposed design, not delivered functionality. Updated 3 October 2026.

## Sources and precedence

The user explicitly requested calendar, streaks, backlog management, tracking, logging and tests on 3 October. BUILD_PLAN.md preserves the earlier learning sequence. The shared planning URL was reopened in the browser today: initial discussion, permission design, requests/incidents and final handover summary were readable, but several middle message bodies, including the calendar discussion, were absent even though their navigation labels were visible. This is not a complete reread of all original messages or downloadable attachments.

Later user decisions take precedence over the shared chat: roles are editable permission sets, reporting relationships are separate, Vimmi heads the HR team, Anupriya reports to Mukesh, department is NHS SBS and delivery unit is UK. No MCP; frontend separate from the modular monolith API.

## Workspace navigation recommendation

My Skills is currently an unconditional navigation entry in AccessAdmin. Its API still checks own-profile/claim authority and returns only the caller's drafts. Showing it there does not imply administrator access to everyone's personal skills.

Recommended UX: Administration contains organization, catalogue, people, roles, assignments and audit. Personal workspace contains own skills and learning. A person with both sets of permissions can switch context using the same Microsoft identity. Derive visible navigation from effective permissions, not role names; do not automatically give an administrator personal claim rights. This separation has not been implemented yet.

## Conversational skill entry recommendation

1. Start from a description of work or selected evidence. Ask only for missing information: contribution, dates/experience, project context and evidence references.
2. Match against published catalogue definitions. Show possible matches and full proficiency criteria; distinguish the person's self-assessment from AI inference. Unknown skills can become a separate catalogue proposal for an authorized maintainer.
3. Build an editable review card containing exact proposed skills, proficiency, experience, project links and evidence references. Reuse already entered facts. Multiple skill drafts may be reviewed together.
4. Require explicit approval of the displayed change or batch, rather than confirmation for every field. Persist only supported fields through existing application services; projects, evidence and submission require their own services before enabling those tools.
5. Save as unverified drafts. Submission to the assigned reviewer is a separate action. AI, training completion and test scores never automatically verify a skill.

Initial tool candidates: search published catalogue, read own draft, propose own skill draft, propose own draft edit. Later: attach permitted evidence, link project, propose claim submission, draft learning plan and propose task rescheduling. Names describe proposed capabilities, not currently registered tools.

## Identity and write execution

Reuse Microsoft SSO. The API verifies each request, binds the actor and account from trusted identity/mapping, and resolves targets server-side. The model receives neither login tokens nor database/provider credentials. There is no independent AI super-user identity.

Each execution uses the caller's current effective permission and resource scope; explicit DENY, expiry and revocation apply. Read scope, draft ownership and reviewer authority are independent checks. The model cannot choose a person/account or grant itself access.

Writes use a persisted proposal with validated arguments, target, expected versions, expiry and payload hash. Approval binds to that exact proposal. Recheck identity, permission and versions at execution; altered payloads require a new review. Persist the change and audit atomically with idempotency protection. Human approval of a draft is not managerial verification.

Uploaded text is untrusted evidence, not instructions. Private evidence storage, scanning, access checks, retention and provider data handling must exist before extraction is enabled. Cross-account conversation/checkpoint access must fail closed.

## Framework recommendation

The current AssistantService and typed ToolRegistry provide bounded read-only orchestration. Live provider configuration, durable conversations and approved writes remain pending.

Evaluate LangGraph JavaScript for multi-turn state and pause/resume at review cards, keeping the existing authorization gateway and module services authoritative. Its documented interrupts and persistence support these interaction patterns. Use a durable store in production; an in-memory checkpointer is insufficient. Azure SQL checkpoint integration is an implementation task, not an assumed built-in adapter. Introducing the library does not itself implement approval security or transactional idempotency.

Official references: https://docs.langchain.com/oss/javascript/langgraph/interrupts and https://docs.langchain.com/oss/javascript/langgraph/persistence.

## Learning slice

The following includes explicit requested features and proposed behavior to make them concrete:

- Goal intake: target skill, present level, available time and target date; AI drafts a plan for editing and confirmation.
- Calendar: daily/weekly/monthly tasks and progress; deterministic scheduling respects timezone and available capacity. External calendar synchronization is a separate optional integration.
- Tracking and logging: planned versus completed work, actual time, notes, linked evidence and completion history. Do not equate opening a task with completing it.
- Streak: derive from recorded eligible learning activity using the person's timezone. Exact qualifying activity, rest days and correction rules remain to be agreed.
- Backlog: retain missed work visibly. Offer a recovery proposal with its effect on future workload; apply rescheduling only after consent.
- Management: pause, resume, edit or retire plans with history; manager visibility depends on effective scoped permissions.
- Tests: preserve the planned optional ten-question assessment, results and attempt history. Assessment quality, scoring and retake rules need definition. A passing test does not verify a workplace skill.
- Progress: show goal completion, pending work and assessment results separately from claimed/verified skill status.

## Delivery order

1. Permission-derived personal/admin navigation.
2. Connect and evaluate the selected Azure model; persist conversation/proposal state and implement the approved draft executor.
3. Deliver conversational add/edit for own skill drafts with authorization, altered-approval, concurrency and retry tests.
4. Add private evidence/project references and assigned-manager submission/review.
5. Build the learning calendar, tracking, streak, backlog/recovery and assessments as one usable workflow.

Requests/incidents remain a separate planned module documented in REQUESTS_AND_INCIDENTS.md: visible recipient, configured routing, approval, need-more-information, assignment, resolution, comments, timelines and real event notifications.
