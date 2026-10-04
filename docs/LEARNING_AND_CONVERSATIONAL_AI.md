# Learning and conversational AI requirements

Status: employee learning plans, calendar, backlog, completion logging and streaks are implemented. Advanced learning tests and AI write proposals remain planned. See the implementation and production QA sections below. Updated 3 October 2026.

## Sources and precedence

The user explicitly requested calendar, streaks, backlog management, tracking, logging and tests on 3 October. BUILD_PLAN.md preserves the earlier learning sequence. The shared planning URL was reopened in the browser today: initial discussion, permission design, requests/incidents and final handover summary were readable, but several middle message bodies, including the calendar discussion, were absent even though their navigation labels were visible. This is not a complete reread of all original messages or downloadable attachments.

Later user decisions take precedence over the shared chat: roles are editable permission sets, reporting relationships are separate, Vimmi heads the HR team, Anupriya reports to Mukesh, department is NHS SBS and delivery unit is UK. No MCP; frontend separate from the modular monolith API.

## Workspace navigation recommendation

Personal and administration navigation now derive from effective permissions. My Skills is shown in the personal workspace, with current own-profile/skill access; the API returns only the caller's drafts. Administrator access does not automatically grant personal claiming rights.

Recommended UX: Administration contains organization, catalogue, people, roles, assignments and audit. Personal workspace contains own skills and learning. A person with both sets of permissions can switch context using the same Microsoft identity. Derive visible navigation from effective permissions, not role names; do not automatically give an administrator personal claim rights. This separation is implemented.

## Conversational skill entry recommendation

1. Start from a description of work or selected evidence. Ask only for missing information: contribution, dates/experience, project context and evidence references.
2. Match against published catalogue definitions. Show possible matches and full proficiency criteria; distinguish the person's self-assessment from AI inference. Unknown skills can become a separate catalogue proposal for an authorized maintainer.
3. Build an editable review card containing exact proposed skills, proficiency, experience, project links and evidence references. Reuse already entered facts. Multiple skill drafts may be reviewed together.
4. Require explicit approval of the displayed change or batch, rather than confirmation for every field. Persist only supported fields through existing application services; projects, evidence and submission require their own services before enabling those tools.
5. Save as unverified drafts. Submission to the assigned reviewer is a separate action. AI, training completion and test scores never automatically verify a skill.

Initial tool candidates: search published catalogue, read own draft, propose own skill draft, propose own draft edit. Later: attach permitted evidence, link project, propose claim submission, draft learning plan and propose task rescheduling. Published catalogue search and eligible own-claim choice/criteria tools are now registered. Durable proposal and approved-write tools remain planned; see AI_TOOL_CATALOGUE.md.

## Identity and write execution

Reuse Microsoft SSO. The API verifies each request, binds the actor and account from trusted identity/mapping, and resolves targets server-side. The model receives neither login tokens nor database/provider credentials. There is no independent AI super-user identity.

Each execution uses the caller's current effective permission and resource scope; explicit DENY, expiry and revocation apply. Read scope, draft ownership and reviewer authority are independent checks. The model cannot choose a person/account or grant itself access.

Writes use a persisted proposal with validated arguments, target, expected versions, expiry and payload hash. Approval binds to that exact proposal. Recheck identity, permission and versions at execution; altered payloads require a new review. Persist the change and audit atomically with idempotency protection. Human approval of a draft is not managerial verification.

Uploaded text is untrusted evidence, not instructions. Private evidence storage, scanning, access checks, retention and provider data handling must exist before extraction is enabled. Cross-account conversation/checkpoint access must fail closed.

## Framework recommendation

The current AssistantService and typed ToolRegistry provide bounded read-only orchestration. Gemini is live. Migration 009 now provides durable, actor-bound history for two recent chats, with bounded model context and resume/delete UI; see AI_INTEGRATION.md. Durable proposals and approved writes remain pending.

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
- Tests: preserve the planned optional configurable assessment, results and attempt history. Assessment quality, scoring and retake rules need definition. A passing test does not verify a workplace skill.
- Progress: show goal completion, pending work and assessment results separately from claimed/verified skill status.

## Delivery order

1. Permission-derived personal/admin navigation.
2. Connect and evaluate the selected Azure model; persist conversation/proposal state and implement the approved draft executor.
3. Deliver conversational add/edit for own skill drafts with authorization, altered-approval, concurrency and retry tests.
4. Add private evidence/project references and assigned-manager submission/review.
5. Build the learning calendar, tracking, streak, backlog/recovery and assessments as one usable workflow.

Requests/incidents remain a separate planned module documented in REQUESTS_AND_INCIDENTS.md: visible recipient, configured routing, approval, need-more-information, assignment, resolution, comments, timelines and real event notifications.

## Implemented employee learning workspace (2026-10-03)

`/learning` now provides Today, a month calendar with date selection, Backlog and Plans. Navigation requires current `learning.view` for the signed-in person; edits independently require `learning.manage`. Role names grant no additional access. Both Microsoft and the approved production demo session use the same actor-bound API.

A three-step modal creates a personal goal with daily available minutes and 1–60 ordered tasks, one task per calendar day, in the browser's IANA timezone. Target date is derived from the last task. This initial scheduler includes weekends; configurable rest days and multiple tasks per day in the creation UI are future work. Missing tasks remain in backlog until explicitly completed or rescheduled. Rescheduling checks the plan's daily remaining capacity and target date. Plans support Pause, Resume and irreversible Archive with a review dialog; archived logs stay readable.

Log completion stores actual minutes (1–480), optional notes (2,000 characters), and a server-owned UTC completion timestamp. A task can be logged once. Streaks use distinct actual completion days in the viewer's browser timezone, continuing through today or yesterday; opening a task, AI output or future scheduling never counts. Days without completion break the streak. Completion is self-reported learning activity and does not verify skills.

Persistence: `learning` module, `GET/POST /api/learning`, migrations 014–015. Plans are restricted to account and authenticated owner; runtime has procedure execution permission, no table access. Current permissions and workspace status are checked again inside a transaction. Record revisions reject stale/double writes; audit and workspace revision changes commit with the record. Audit contains plan ID/status/revision, not private goals or notes. Each person is capped at 50 retained plans, 60 tasks per plan; bounded payload capacity allows all valid completion notes. Creation request is still capped at 64 KiB. There is no delete or automatic history cleanup.

AI `my_learning` is a read-only tool: at most five recent plans and five pending tasks per plan; no actor parameter, raw notes, SQL or write tool. Authority is rechecked before and after retrieval. Permission-specific guides describe the actual UI. AI planner output can prefill the existing plan wizard; the person must review and explicitly create it. There is no AI learning write tool.

Not implemented: stored quiz/attempt history, weekly calendar, plan-specific timezone selector, rest days, file evidence uploads, automatic recovery/rebalancing, reminder notifications, AI learning write proposals, learning analytics across teams. Requests & Incidents remains a separate planned module; no inactive navigation item is exposed.

Validation: HTTP/unit tests cover forged completion/owner fields, invalid dates, daily capacity and live permission revocation. Calendar tests cover duplicate completion days, gaps, leap/month/year boundaries and timezone conversion. `test/learning.integration.ts` checks live Azure SQL runtime ownership, CAS, transitions, double completion, server timestamps and direct-table denial using rollback-only fixtures.

Production QA (Chrome): a clearly labelled synthetic Khushi plan was created, a task logged with 20 actual minutes (streak updated), another task explicitly rescheduled, and the stored state survived a direct `/learning` refresh. Desktop modal fit was 618 px within a 695 px viewport with no modal scroll. Light/dark appearance was inspected. A missing Vercel deep-link rewrite was fixed. AI learning destinations now use the same exact allowlist as other pages; response formatting failures are contained by a local boundary so the workspace stays mounted. Mobile visual QA is still pending.

## Learning overview and skill mapping (2026-10-04)

My learning combines four real-data summaries, current focus, week-wise personalized plans, a paginated queue, goals, recent completions, monthly progress, task deadlines and skill-linked learning completion. Learning paths, Goals and Recommendations provide focused views; Today, Calendar and Backlog retain scheduling and logging. Start/Continue opens task details and never marks a task complete. Purple accents are reserved for AI recommendations/planning; other learning actions use the shared teal theme.

Monthly completion uses tasks scheduled in the selected month. Logged hours use actual completion timestamps converted to the plan timezone, so completing an overdue task can contribute logged hours without changing that month's scheduled-task percentage. Week previews derive from real task dates; full plans provide week selection and task pagination. No fictitious courses, tests, assignments or assessment improvement populate empty states.

Migration 016 supports an optional focus and published skill mapping at creation. The API validates focus and UUID; SQL independently checks catalogue permission and the same-account published skill, derives the skill name server-side and rejects client-supplied names. Existing unmapped plans remain valid. Mapping cannot currently be edited after creation. Skill development measures learning completion, not verified proficiency.

Recommendations and AI planner call the authenticated assistant on demand using permission-filtered own-learning/skill tools. Compact learning context includes a bounded goal excerpt and mapped skill. Suggestions are labelled AI; no saved course enrolments are implied. A structured task draft opens the human-review plan wizard with editable tasks; explicit Create plan is required. Generated output is transient in this view; assistant conversation retention remains two recent conversations. Quiz/assignment storage and notifications remain future work.

Validation includes monthly timezone boundaries, dated roadmap grouping, optional mapping validation, runtime SQL-derived skill-name provenance and missing/forged skill rejection with rollback-only fixtures. Build, typecheck, module boundaries and existing ownership/CAS/completion checks remain required.
Creation now uses four compact steps (Goal & time, Skill focus, Daily tasks, Review) to keep desktop forms within the dialog. The review names the selected focus and skill before explicit save.

Production acceptance (user Chrome, 2026-10-04): mapped synthetic Azure plan persisted after refresh; Start opened detail without changing completion. Real Gemini planner returned three tasks and Review plan draft prefilled the editable four-step wizard. All four steps had body clientHeight=scrollHeight=392 px in a 606 px desktop dialog. The generated QA draft was closed without saving. Existing completed count remained one. Mobile visual verification is still pending.

## Task-linked study sessions and practice (local implementation, 2026-10-04)

Start/Continue now opens Session, Resources, Practice and History. Session saves independent study notes (2,000 characters), draft actual minutes (0–480) and up to five named HTTPS resource links. Resources are user supplied, opened with noopener/noreferrer, never fetched by the backend or invented by AI. Saving a session does not log completion. Log completion first saves the session, then opens the existing explicit completion-review dialog. Session revision/CAS prevents stale overwrites.

Practice generation requests 1–20 questions (five initially selected) for the server-resolved own task and bounded goal context. The existing provider gateway supplies rate limits, cancellation, permission rechecks and token usage. Structured output is validated before persistence; question prompts/explanations are capped at 240 characters and options at 80 for compact desktop presentation. Practice generation bypasses conversation retention, preventing answer keys from appearing as saved assistant chat messages.

GET /api/learning/practice exposes questions/options and attempt summaries, never answer keys. POST /api/learning/practice/attempt accepts a request UUID, quiz ID and answer indices only; SQL grades against its stored key and assigns the submission timestamp. Matching retries are idempotent; altered retries fail. Explanations are retrieved for one own submitted attempt at a time through GET /api/learning/practice/review, keeping history responses compact. Results are informal AI practice, never manager verification, formal certification, or a task-completion signal. Retakes retain earlier attempts. Clients cannot supply owner, score, key or timestamp.

Migration 017 adds LearningSession, LearningQuiz, LearningAttempt and OwnLearningPractice. Runtime can execute the guarded procedure and cannot read tables. Each operation rechecks current account, active workspace, person, own task and learning permissions inside a transaction. Reads work for paused/archived plans; writes require an active plan and learning.manage. Limits: 100 quizzes per person, 30 per task, 10 attempts per quiz; no automatic deletion. Audit stores an action/target/saved marker without notes, links or answer contents. Schema 017 is applied to the configured development Azure SQL database; application code remains local and unpushed at the user's request.

The earlier production sections describe the deployed baseline. Stored task-linked practice is available in this local implementation; quizzes rendered solely inside chat remain unsaved previews. Reminder notifications, scheduled/formal assessments, calendar rebalancing, attachments and team learning analytics remain pending.

Checks: domain/HTTP tests cover untrusted fields, safe resource URLs, key redaction, independent write permissions, malformed model output and permission changes during generation. Rollback-only runtime SQL fixtures cover own-task isolation, server scoring/timestamps, idempotent retries, stale session revisions, invalid scores/answers and table denial. Build/typecheck and module boundaries pass.

Local acceptance in the user's Chrome: a real Gemini three-question Azure practice quiz was submitted with one correct answer; History displayed the persisted 1/3 result and per-question explanations after a fresh page load and demo login. Saved notes, 15 draft minutes and the Microsoft Learn resource link also survived reopening. The overview retained one completed item; saving drafts and submitting practice did not complete the selected task. Resource list, resource entry, quiz and answer review fit the desktop modal without internal scrolling. All 110 architecture/API/web tests pass. Phone visual acceptance remains pending.

## Guided AI learning planner (local implementation, 2026-10-04)

AI planner is a page action and is also available in Recommendations. A compact modal collects a goal (300 characters), daily minutes (5–480), a 1–12 day learning cycle, start date and optional current experience/preferences (500 characters). The existing output contract supports twelve tasks, so this creates a short cycle rather than promising mastery of a broad goal. It schedules one activity per day, including weekends. Missing experience explicitly defaults to an introductory starting point.

POST /api/learning/planner derives the actor from verified identity and requires independent learning.view and learning.manage permissions. The service rechecks management authority before and after generation. The existing Gemini gateway supplies permitted my_learning/my_skills tools, rate limits, cancellation and token metering. Only bounded intake and, for refinement, the bounded prior draft are passed; the planner does not append these requests to durable chat history. User intake and prior model text are untrusted preferences, never tool authority. Invalid counts, oversized tasks, duplicate tasks and non-task artifacts fail without a write.

The roadmap shows one editable daily task at a time, with visible date and feedback refinement. Review & schedule carries the original goal, start date, selected time budget and edited steps into the existing creation wizard. The person chooses optional focus/skill mapping and explicitly selects Create plan. Existing SQL ownership, revision and capacity checks govern the save. Generation/refinement cannot persist a plan, mark completion or change skill proficiency. A cancelled unsaved draft is discarded. Resource links are still added through task sessions; invented course/resource URLs are not generated.

Chrome acceptance: real Gemini generated a three-day, 45-minute Azure roadmap. Feedback replaced Azure resource creation with local conceptual REST exercises and a learning checkpoint. Intake, background and roadmap fit the desktop modal without internal scrolling. A clearly labelled synthetic QA plan was reviewed and saved; its first task appeared in Today, all three dates appeared in Calendar, and completion count remained one. Four new tests cover bounded/forged inputs, actor binding, no persistence, permission revocation, cancellation, malformed model output and HTTP authentication. Automated architecture/API/web total is 114 passing tests. Phone visual acceptance remains pending.

Batch backlog recovery, extension of existing plan target dates, automatic rest-day scheduling and proactive reminders remain separate work. The existing single-task reschedule action still requires explicit approval and capacity checks.

## Confirmed backlog recovery (local implementation, 2026-10-04)

Recover plan appears for active plans with overdue tasks in Backlog and Learning paths. The modal accepts a start date from today through the next year in the plan timezone, and a 5–480 minute daily budget for that plan. Recovery includes every pending task, including future work, in stable old-date order. The backend packs whole tasks into consecutive days within capacity; it never shortens or splits a task. A budget smaller than an existing pending task is rejected with the minimum required minutes. Weekends remain included. This is a per-plan budget; it does not account for workload from other plans.

Preview shows old/new daily budget, old/new target date, total pending minutes and paginated task dates. The target is the last recovered date or a later completed task date, so it may move earlier or later. Completed task dates, duration, notes and server completion timestamps remain unchanged. Cancellation does not persist the preview. Optional Gemini guidance is requested explicitly, uses only a bounded server-computed schedule, renders safe Markdown in compact pages and cannot write, reorder tasks or change dates. No recovery advice is appended to durable chat history.

POST /api/learning/recovery/preview derives the authenticated owner and checks current independent learning.view/learning.manage authority. Confirmation sends the original parameters, expected plan revision and a SHA-256 preview fingerprint; clients cannot submit dates, task edits or owner selectors. Apply recomputes the current preview and compares the fingerprint. The fingerprint detects drift rather than serving as authorization: ownership, permissions and SQL checks are independent. Changed plan revisions, different actors, edited parameters or local day rollover require a fresh review.

Migration 018 adds RecoverOwnLearningPlan and grants runtime procedure execution only. All pending task IDs must be included exactly once, completed IDs cannot be changed, capacity and exact target are checked, and the update/audit/workspace revision commit atomically. Only planned dates, dailyMinutes and targetDate are modified. Stable task IDs preserve LearningSession, LearningQuiz and LearningAttempt references. Current account status, ownership and permissions are checked again inside the SQL transaction. Schema 018 is applied to the development database; code remains local and unpushed.

Validation: six new domain/HTTP tests cover timezone boundaries, packing, extensions, completed-record preservation, untrusted fields, insufficient capacity, inactive/empty plans, stale/altered preview, day rollover, actor binding, revoked permissions and AI no-write behavior. Rollback-only runtime SQL checks verify atomic owner-only recovery, exact pending coverage, capacity, revision checks, completed record equality, unchanged session/quiz/attempt data and direct-table denial. All fixtures roll back. Architecture/API/web total: 120 passing tests; build and typecheck pass.

User Chrome acceptance on the labelled QA learning workflow: a 20-minute budget was rejected without shortening its 30-minute tasks. A 60-minute preview moved the two pending tasks to October 4 and showed target October 5 → October 4. Real Gemini guidance returned suggestions without changing dates. After explicit confirmation, Calendar showed both recovered tasks, Backlog was empty, and completed items/streak remained one. Desktop preview fit without internal scrolling. Phone CSS uses task cards and the shared scrolling mobile dialog; actual phone visual acceptance is still pending. Rest-day preferences, multi-plan capacity, task splitting and proactive reminders remain future work.
