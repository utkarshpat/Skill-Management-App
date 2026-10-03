# AI integration design

Status: authenticated floating assistant, Gemini/server-side provider adapters, read-only tools and validated draft/learning-practice cards are implemented. Live Gemini answer, own-profile tool continuation, skill-draft rendering and a ten-question practice quiz were tested on 3 October 2026 using synthetic data. No employee evidence or Azure test writes were used.

## Current implementation and setup

GET /api/assistant reports connection status; POST /api/assistant accepts only user/assistant messages. Trusted identity comes from verified Microsoft authentication, or explicitly enabled loopback development login. Request bodies cannot choose the actor or workspace.

The tools are own_profile (current signed-in profile and role labels), workspace_summary (people, roles and departments), and my_skills (the signed-in person's first page of self-assessed skill drafts, with explicit unverified labels and pagination metadata). All require current profile.view OWN; summary additionally requires permissions.manage and users.manage at workspace scope. Permissions are reread before and after provider requests, before tool execution and after retrieval. There are no write tools, arbitrary SQL, network or MCP tools. Chat text is not persisted by the application.

The agent framework is currently internal and provider-independent: the bounded AssistantService orchestrates provider calls; ToolRegistry owns typed tool definitions, their handlers, permission predicates and source links. Its policy gateway validates arguments, derives the actor from the authenticated caller and rechecks live authority before/after retrieval. Skill tools call the public Skills store contract, not a SQL adapter or an arbitrary model-generated query. Adding a tool requires a registry entry and denial tests; unknown tools or any person/workspace arguments fail closed. The My Skills tool omits private experience narratives and only returns the first 25 permitted rows with a hasMore indicator.

This is an explicit application framework, not a new third-party agent SDK or a live model connection. Durable workflow execution, proposal approval, tracing with redaction, shared budgets and model evaluations remain required before AI writes. Requests/incident tools follow the separate design in REQUESTS_AND_INCIDENTS.md; none are silently enabled by adding skill drafts.

Configure AI_PROVIDER, AI_MODEL, AI_ENDPOINT and AI_API_KEY in the ignored API .env or deployment secret management. Azure uses the deployment name as AI_MODEL and an approved HTTPS *.openai.azure.com or *.services.ai.azure.com endpoint with /openai/v1/chat/completions. OpenAI uses its fixed API endpoint. Local Ollama accepts only a loopback endpoint and needs no key. Keys never enter web configuration. Restart the API after configuration. Missing configuration keeps the UI composer disabled; it does not generate simulated replies.

Gemini accepts the user's server-only GEMINI_API variable, with GEMINI_API_KEY as an alias. When AI_PROVIDER is blank and either key exists, Gemini is selected; default AI_MODEL is gemini-3.8-flash. An explicit provider still takes precedence. Gemini requests use the fixed HTTPS Google endpoint and x-goog-api-key header; model names cannot construct arbitrary paths. Full native response parts, including opaque thought signatures, remain server-side and are retained within tool continuation. Quota, billing, access, timeout, blocked and truncated replies have bounded, redacted error handling. Nothing enables billing or purchases credits automatically.

## Output and action views

The present_output rendering function has a server-validated, bounded contract: kind, title, summary, body, steps and questions. Supported kinds are skill_draft, task_draft and practice_quiz. Extra fields (including executable actions or model-provided navigation URLs), unknown kinds, invalid choices/answer indices, duplicate question prompts and incomplete quizzes are rejected. This is a presentation function, not a write tool. Plain answers and clarifying questions retain the normal chat view; sources come only from authorized tools.

Drafts show an editable text preview and an optional Copy action. Skill drafts additionally offer Review in My Skills: the edited description fills the existing popup through client navigation. The person must select the published catalogue skill, proficiency and experience and explicitly save through the existing authorized/concurrency-checked claim API. The navigation state is consumed; refreshing does not silently reopen or save a proposal. This initial handoff does not auto-match taxonomy or auto-fill proficiency. Fully filled durable proposals and direct approved execution remain upcoming work.

Tests belong to Learning & Development, not My Skills. The AI drawer provides a learning-practice preview of 1–20 questions (user-requested count, default 10 when unspecified) with four choices per question, previous/next controls, an all-answered check, score, retry and explanations. Attempts are transient browser state and are not saved to learning history, credentials or verified skills. Answers are present client-side, so this is informal practice, not a protected assessment. Persisted learning tests require the Learning module's attempt/version storage and authoritative grading. Learning tasks are draft steps, not scheduled calendar records.

Current Gemini cap is 6,000 output tokens for bounded structured output; long tests may reach this cap and are rejected if truncated; other existing providers retain 800. Process-local request limits below apply to all providers. Chat/card state is lost on page reload, and no durable conversation or proposal history is claimed.

Limits: 12 history messages, 2,000 characters per message, 12,000 total characters, provider-specific output caps above, 35-second request timeout, cancellation on panel close, three model rounds and four tool executions. Each API process limits users to 10 requests/minute, one concurrent request/user and 500 requests/day overall. Process restarts reset these counters and multiple instances have independent counters. They are not durable budgets or hard currency caps; add shared rate limits, usage metering and billing alerts before production.

Verification: automated tests cover forged system history, forbidden tools/arguments, permission revocation during a conversation, own-profile isolation, verified HTTP actor resolution, anonymous rejection, disconnected status, upstream error redaction, structured-output validation, Gemini signed-part continuation, blocked/truncated replies and own notification isolation. Live synthetic smoke tests passed; broad Hinglish/content-quality evaluations, Azure deployment/region availability and approved employee-data retention settings remain pending.

Official references: [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures), [structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

## Permission-aware guidance

Assistant context uses the same effective workspace capability calculation as navigation, exposed through the access module's public contract. Each model round receives only permitted pages and applicable step-by-step UI guidance. Current grants, individual DENY and expiry determine these capabilities; role names and chat history do not. Simple English greetings are generated from this context without a model call. Users with identical effective permissions can correctly receive identical guidance even if their role labels differ.

Guidance covers own profile, published catalogue browsing, own skill drafts, catalogue maintenance, permission-set design, assignments and reporting-structure maintenance when applicable. Pending learning, review, request/incident and reporting workflows remain labelled unavailable. No direct-reports retrieval tool or team-scoped assessment workflow is claimed. Manager preset team grants remain pending proposals; they must not be widened to organization access merely to differentiate responses.

The personal `my_skills` tool requires effective own skill-view access, and personal skill-draft outputs require the same claim capability as the UI, checked again before delivery. General draft/practice previews still do not execute writes, schedule tasks or persist learning attempts. Permission-aware prompting improves guidance; server policy checks remain the authorization boundary. Automated coverage includes renamed roles, identical grants, DENY, expiry, refreshed model context and blocked personal skill tools/drafts.

## Formatting and document canvas

Assistant replies and draft previews render CommonMark/GFM: paragraphs, headings, bold/italics, bullet and numbered lists, quotations, inline/fenced code and tables. User messages retain literal text. Tables and code contain their own horizontal overflow. Markdown is loaded in a separate bundle when needed. The model prompt requests meaningful formatting and reiterates that tests belong to Learning & Development.

The renderer uses react-markdown/remark-gfm without raw-HTML execution, skips HTML and excludes images. Model links activate only for allowlisted frontend workspace paths; external links and API paths become plain labels. Trusted tool sources remain separate from generated links. Rendering creates React elements, not innerHTML. Frontend tests cover semantic formatting, script/image exclusion and unsafe navigation; see [react-markdown security](https://github.com/remarkjs/react-markdown#security).

Structured skill/task drafts offer Open draft document to show a read-only, focus-trapped canvas with readable page width, contained scrolling, Copy Markdown and Download .md. Escape closes the canvas while retaining the AI drawer and conversation. Drafts have Preview/Edit and Open draft document; edited text is retained for copying and the My Skills review handoff. Ordinary conversational replies (including greetings and navigation help) have no document button. This is a transient document view, not a saved document repository or collaborative editor. It changes no records or permission grants.

## Intended features

Build AI into the same workflows, rather than adding a separate privileged assistant. First candidates are skill-claim drafting, evidence summaries with references, learning-plan drafts, and scoped skill search. Later demand matching must explain its inputs and distinguish verified skills from claims and inference. AI must never convert a claim, course completion or generated answer into a verified skill.

## Trust and execution boundaries

1. The API verifies the human identity and resolves the active workspace from SQL.
2. An internal Tool Registry lists typed tools, their permission, resource scope and read/write classification. No MCP integration and no arbitrary SQL or HTTP tool.
3. A Policy Gateway resolves every target from current trusted data and runs the same authorization used by normal APIs. The model cannot supply roles, authorize itself, select another tenant or bypass explicit DENY.

   Roles and labels are administrator-defined. Tools bind to stable permission codes from the application catalogue, with role inheritance plus individual overrides; an AI assistant gains no powers from a name such as Manager or Super Admin. Permission revocation must affect the next tool execution even during an existing session.
4. Read tools return the minimum permitted context with source identifiers. Retrieval, search indexes and caches must preserve account isolation and current permission checks. Uploaded evidence and retrieved text are untrusted content, never tool instructions.
5. A write tool creates a proposal containing exact validated arguments, target, expected record version, expiry and payload hash. The UI displays the actual change and asks the human to approve it.
6. Execution rechecks identity, policy, permission expiry, resource state, N+1 assignment and concurrency. Approval binds to the exact proposal; changed arguments require new approval. A transactional idempotency key prevents duplicate changes.
7. Store an audit event for proposal, approval, rejection and execution, linking human actor, tool, target and outcome. Do not put access tokens or unnecessary evidence contents into model traces or logs.

AI-generated text cannot grant access, approve the actor's own claim or change reporting relationships. Verification always follows the assigned human review workflow.

## Delivery gates

Choose provider, deployment region, retention and data-handling terms before sending employee information to a model. Configure provider credentials on the server through secret management. Establish per-user budgets, request limits, timeouts, cancellation and a useful manual fallback.

Before enabling writes, test forged tool arguments, cross-account targets, unauthorized retrieval, hostile evidence instructions, expired or revoked permissions, changed manager assignments, altered approved payloads, concurrent edits and retried execution. Evaluate reference accuracy and unsupported claims separately from authorization tests. Model quality never substitutes for deterministic permission checks.

## Integration sequence

The user requested the floating read-only assistant now; it is delivered ahead of skill-claim/evidence/review workflows. Connect and evaluate the selected model next. Enable approved writes only after the proposal executor, audit and denial tests exist. The UI follows the laptop-first design and adapts to phones.
