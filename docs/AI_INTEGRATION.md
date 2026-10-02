# AI integration design

Status: architecture requirement; no model, AI endpoint or provider billing is enabled yet.

## Intended features

Build AI into the same workflows, rather than adding a separate privileged assistant. First candidates are skill-claim drafting, evidence summaries with references, learning-plan drafts, and scoped skill search. Later demand matching must explain its inputs and distinguish verified skills from claims and inference. AI must never convert a claim, course completion or generated answer into a verified skill.

## Trust and execution boundaries

1. The API verifies the human identity and resolves the active workspace from SQL.
2. An internal Tool Registry lists typed tools, their permission, resource scope and read/write classification. No MCP integration and no arbitrary SQL or HTTP tool.
3. A Policy Gateway resolves every target from current trusted data and runs the same authorization used by normal APIs. The model cannot supply roles, authorize itself, select another tenant or bypass explicit DENY.
4. Read tools return the minimum permitted context with source identifiers. Retrieval, search indexes and caches must preserve account isolation and current permission checks. Uploaded evidence and retrieved text are untrusted content, never tool instructions.
5. A write tool creates a proposal containing exact validated arguments, target, expected record version, expiry and payload hash. The UI displays the actual change and asks the human to approve it.
6. Execution rechecks identity, policy, permission expiry, resource state, N+1 assignment and concurrency. Approval binds to the exact proposal; changed arguments require new approval. A transactional idempotency key prevents duplicate changes.
7. Store an audit event for proposal, approval, rejection and execution, linking human actor, tool, target and outcome. Do not put access tokens or unnecessary evidence contents into model traces or logs.

AI-generated text cannot grant access, approve the actor's own claim or change reporting relationships. Verification always follows the assigned human review workflow.

## Delivery gates

Choose provider, deployment region, retention and data-handling terms before sending employee information to a model. Configure provider credentials on the server through secret management. Establish per-user budgets, request limits, timeouts, cancellation and a useful manual fallback.

Before enabling writes, test forged tool arguments, cross-account targets, unauthorized retrieval, hostile evidence instructions, expired or revoked permissions, changed manager assignments, altered approved payloads, concurrent edits and retried execution. Evaluate reference accuracy and unsupported claims separately from authorization tests. Model quality never substitutes for deterministic permission checks.

## Integration sequence

Complete authenticated profile and skill-claim/evidence/review first. Add read-only, referenced assistance next, then drafts. Enable approved writes only after the proposal executor, audit and denial tests exist. AI UI will follow the laptop-first design and remain usable on phones.
