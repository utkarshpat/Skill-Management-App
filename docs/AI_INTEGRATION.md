# AI integration design

Status: authenticated floating assistant, server-side provider adapters and read-only tools are implemented. No live model, credentials or provider billing have been enabled or tested yet.

## Current implementation and setup

GET /api/assistant reports connection status; POST /api/assistant accepts only user/assistant messages. Trusted identity comes from verified Microsoft authentication, or explicitly enabled loopback development login. Request bodies cannot choose the actor or workspace.

The tools are own_profile (current signed-in profile and role labels) and workspace_summary (people, roles and departments). Both require current profile.view OWN; summary additionally requires permissions.manage and users.manage at workspace scope. Permissions are reread before and after provider requests and before tool execution. There are no write tools, arbitrary SQL, network or MCP tools. Chat text is not persisted by the application.

Configure AI_PROVIDER, AI_MODEL, AI_ENDPOINT and AI_API_KEY in the ignored API .env or deployment secret management. Azure uses the deployment name as AI_MODEL and an approved HTTPS *.openai.azure.com or *.services.ai.azure.com endpoint with /openai/v1/chat/completions. OpenAI uses its fixed API endpoint. Local Ollama accepts only a loopback endpoint and needs no key. Keys never enter web configuration. Restart the API after configuration. Missing configuration keeps the UI composer disabled; it does not generate simulated replies.

Limits: 12 history messages, 2,000 characters per message, 12,000 total characters, 800 output-token cap per provider call, 35-second request timeout, cancellation on panel close, three model rounds and four tool executions. Each API process limits users to 10 requests/minute, one concurrent request/user and 500 requests/day overall. Process restarts reset these counters and multiple instances have independent counters. They are not durable budgets or hard currency caps; add shared rate limits, usage metering and billing alerts before production.

Verification: automated tests cover forged system history, forbidden tools/arguments, permission revocation during a conversation, own-profile isolation, verified HTTP actor resolution, anonymous rejection, disconnected status and upstream error redaction. Live model quality, Azure deployment/region availability and provider retention settings still require verification after provider selection. No employee context is sent to a provider while disconnected.

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
