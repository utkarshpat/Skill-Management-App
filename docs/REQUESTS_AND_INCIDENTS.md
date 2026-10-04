# Requests and incidents: preserved workflow requirements

Status: creation, recipient name search, own/received lists, comments, cancellation, start work, reassignment, resolution, durable timeline and in-app notifications implemented. AI drafts open explicit review forms; autonomous writes, approval, reopening and attachments remain pending. My Skills does not implicitly create these records.

## Separate responsibilities

Requests represent a routed business action needing a recipient or approval: for example an access grant/revoke or another configured workflow request. Incidents represent an IT/service issue needing triage, assignment and resolution. Each needs its own state transitions, ownership, comments and timeline; a skill self-assessment is not an incident.

The requester chooses an explicit named recipient: line manager, system administrator or a person in another department, as clarified by the user. Bounded name search exposes active eligible recipients' names and IDs, at most 20 matches. The current direct reporting manager is marked. Submission rechecks the recipient transactionally. Future automatic reporting-chain routing must derive current relationships and block broken/circular chains. Administrator-defined role labels do not confer authority.

## Implementation requirements

Use existing `request.create/view/assign/approve/resolve` and `incident.create/view/assign/resolve` codes. OWN view applies only when the verified actor is requester or explicitly selected recipient. SQL checks that exact participant relationship; an ORGANIZATION grant alone does not expose unrelated records. Creation and commenting require corresponding create/view permissions. Cancellation additionally requires requester ownership and SUBMITTED status. Receiving needs view permission, not assignment authority. Reassignment, approval and resolution will require independent policy. Never widen unsupported narrow scopes to ORGANIZATION.

Migrations 019/020 store account, requester, recipient, type, revision and events. `WorkflowWorkspace` rechecks runtime account binding, active membership and current permissions in a transaction locked on the workspace. Record, timeline event, revision and redacted audit commit together. Restricted runtime can execute the procedure but cannot directly select/change tables. Notifications are read from durable committed events, rechecked against current participant access, excluding the actor's own events. Bell read receipts remain device-local. External delivery needs an outbox and durable receipts in a later phase.

An approved access request does not itself authorize an arbitrary role or permission change. Execution must recheck the actual grant authority, permitted scopes, target membership and the exact approved payload. Block self-approval and stale approval execution; use idempotency to prevent duplicate grants. Sensitive approval outcomes remain human decisions.

## AI integration boundary

Typed AI tools read a person's permitted requests/incidents and eligible recipients. Structured request/report drafts open the existing composer for explicit review and submission. AI cannot invent recipients, expand scope, silently change access, resolve an incident or approve a request. Future direct action tools require an expiring, version-bound proposal displayed for human approval, followed by a fresh policy check and transactional execution/audit.

Keep assignment and approval separate from read-only chat. Workflow reads and draft review are available; autonomous workflow writes are not exposed.

## First-slice API, UX and limits

- `/requests`: My requests and Assigned to me, paginated at 10 records. The `record` query parameter opens independently authorized detail. Failed deep links never substitute another person's record.
- Desktop popup: Details → Recipient → Review → explicit Submit. Mobile retains the shared scrollable dialog. Timeline pages contain four events.
- GET `/api/workflows/options?q=…`, GET `/api/workflows?page=…&inbox=…`, GET `/api/workflows/:id`, POST `/api/workflows`.
- Only CREATE, COMMENT and CANCEL accepted. Client actor/owner/status/timestamps/approval/execution fields are rejected. Text limits: subject 160, description 2000, comment/reason 1000; SQL JSON checks repeat validation.
- Request/event UUIDs make retries idempotent; changed replays fail. Comments/cancellation require current optimistic revision. Permissions are checked on each read/write and notification retrieval.
- First-release statuses: SUBMITTED/CANCELLED; maximum 100 submitted records per requester, 101 events per record. No uploads, SLAs, escalation, auto-routing or automated access changes.
- Migration 019 initially required assignment authority for receipt; 020 introduces explicit participant OWN access and name search after the user's clarification. Setup changes no people's permissions.

## Verification

`npm run test:workflows -w apps/api` exercises the restricted SQL runtime. Synthetic records and temporary grants are inside rolled-back transactions. Checks cover owner/recipient isolation, ordinary OWN recipients without assignment authority, name search, incident separation, idempotent creation/comments/cancellation, stale revisions, changed replays, recipient revocation, notification filtering and denied direct table access. HTTP/unit tests verify actor binding and forged-field rejection.

Local Chrome QA uses clearly labelled synthetic records. Search finds Hemant and marks the current reporting manager; explicit submission opens saved detail. All three desktop popup pages measured equal client/scroll heights. Phone visual acceptance remains pending.
Chrome acceptance also verified the recipient inbox, committed creation/reply notifications, reply persistence, dark theme, owner-only cancellation and denial of the same deep link to an unrelated employee. The labelled QA request was cancelled after testing; its three-event timeline remains available.

## Interactive request workbench (migrations 021/022)

Each record has a durable numeric reference (`REQ-…` or `INC-…`) and one of six topic categories. Existing records become OTHER; categories classify work and do not grant permissions or automatically select a recipient. Identity references may have gaps after rolled-back transactions.

The list uses the restricted `ReadWorkflowList` procedure: subject/reference/description search, type, category, status and priority filters; ten-record pagination; server-clamped page numbers; and summary counts across the full currently permitted selected inbox. Tab counts include only the verified person's own/explicitly received records. Filtered totals and unfiltered summary totals intentionally differ. Every summary card applies a filter, and Clear resets the search and filters. Opening detail preserves list state.

New request uses four bounded steps: Topic → Details → Recipient → Review & send. Category radio cards, explicit recipient name search, back/edit controls, input limits and validation all work against actual APIs. Only explicit Submit persists the request. Laptop bodies do not scroll; phone bodies retain shared scroll behavior. Attachments, fake SLA indicators, unsupported resolved/in-progress statuses and placeholder menus are absent.

Additional restricted SQL tests cover categories, real references, filtered totals, summary totals, participant isolation, page clamping, non-overlapping pagination and injection-like search input. All fixture records roll back. Build, typecheck and unit tests pass. Chrome QA verified card filtering/Clear, named manager selection and popup pages; phone visual acceptance remains pending.

Latest local Chrome acceptance: category-required validation, four-step desktop fit, explicit submission of `QA: Learning guidance UI` (REQ-22), saved category/recipient/activity, owner cancellation, working category filter and both themes. The synthetic request is cancelled and its history retained. No push or deployment performed.

Recipient picker refinement: search results are directly selectable radio cards rather than a native dropdown. Desktop shows four people per results page with working previous/next controls, avoiding a scrolling form. Selected person is explicitly shown and retained while refining search; only an explicit person selection changes the recipient. Phone uses a single-column list within the shared scrollable modal. Searching disables stale result selection.

## Permission-aware AI assistance

The AI core no longer labels implemented learning, reviews or requests as pending. Current workspace capabilities define navigation and guides; labels never grant authority. New tools read effective own permissions, supported permission-design options (administrator only), actor-bound request/inbox summaries, individually authorized request details and eligible named recipients. The API rechecks permissions before and after reads; compact projections omit bulk narratives and mark shortened details. Role options are bounded and mark omitted grants/roles.

Request/incident drafts are structured presentation artifacts, never writes. The Review request draft button fetches current workflow options, verifies create/view access and opens the existing four-step composer in place with subject/description prefilled. Category, recipient and final review remain explicit; only Submit uses the normal authorized transactional workflow endpoint. Cancelled modal drafts save nothing. Model-supplied owners, permission mutations and arbitrary URLs are not accepted. AI generation is rechecked against current authority before artifact delivery.

Page-specific assistant shortcuts cover own permissions, request/incident drafting, personal skills, learning planning, role permission design and access-assignment guidance where permitted. Roles, assignments and reporting changes remain human-reviewed existing editor actions; the assistant cannot autonomously grant access, approve reviews, reassign or resolve requests. Planned modules are clearly unavailable. Existing chat storage and bounded memory remain in use.

Local Chrome AI acceptance verified a real generated request draft, in-place review with prefilled details, cancellation without persistence, and actual request counts/statuses matching the workbench. Automated checks cover actor binding, malformed selectors, permission revocation, role labels without authority, draft delivery checks and review-only presentation. Phone visual acceptance remains pending. No push or deployment performed.

## Recipient lifecycle (migration 023)

The current recipient alone can Start work from SUBMITTED using the matching assign permission or Resolve from IN_PROGRESS using resolve permission. Migration 024 permits either requester or current recipient to Reassign an active record using assign permission, following the owner's instruction that any workflow user may assign to a named person. Each action also requires current participant view authority. These actions do not depend on create permission or role labels. The requester can cancel either active status with create/view authority; resolved/cancelled records are terminal and retain history. Resolution is work completion, not authorization to grant access or approve a sensitive request.

Reassignment uses a record-authorized name search, excludes requester/current recipient, checks target active/view access again transactionally, and returns the record to SUBMITTED. Former recipients lose list/detail/notification access immediately; the requester and current recipient retain access. Target ID and source revision are retained on the event; timeline displays the target and reason. Events, status, assignment, revision and audit commit atomically. Same-event retries do not duplicate writes; changed payloads/stale revisions fail. After reassignment the former recipient cannot retry or read the handed-off record; the UI returns to their inbox.

Action dialogs have explicit notes and confirmations. Draft with AI accepts bounded facts, opens an editable preview and requires Use draft followed by the ordinary action confirmation. The dedicated assistant endpoint checks record authority/revision before and after generation, shares chat rate/token limits, accepts no actor/status/recipient mutations, and stores no chat-history entry. Approval and attachments remain unavailable. List cards and filters use actual Submitted/In progress/Resolved counts; cancellation stays available as a filter.

`npm run test:lifecycle -w apps/api` checks both request and incident state transitions, recipient-only authority, duplicate retries, handoff isolation, durable notifications, revoked assign/resolve grants and stale revisions in rolled-back SQL transactions. Migration grants no people new permissions.

Explicit owner-authorized provisioning uses `workflow-permissions-cli.ts --apply` through the validated/audited access store. Existing workflow-view roles gain matching assign/resolve grants at OWN scope. Customized grants/denies and individual overrides remain effective; no organizational record visibility is added. Employee-based presets include these own-workflow capabilities for future provisioning. Neither migrations nor API startup silently grant permissions.
