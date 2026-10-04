# Security and architecture audit — 5 October 2026

Scope: repository review plus isolated local reproductions using an in-memory access store and a stub AI provider. No production writes, PIN guessing, real model calls or database migrations. This is a bounded audit, not a security certification. Demo-login findings remain deferred by user instruction. Shared AI budgets and access-read optimizations were subsequently deployed in commit `6a7803f` after migrations 039/040; see REGRESSION_OPTIMIZATION_2026-10-05.md for validation and rollout dependencies. Earlier frontend fixes are separate.

## P1 — Hosted demo PIN has no application attempt limit

Evidence: `apps/api/src/modules/identity/routes.ts:21-37` calls `authorizeCode` directly on both roster and login endpoints. Configuration accepts four-character codes. Origin/Host checks do not stop a non-browser client from supplying those headers. Twenty-five consecutive incorrect local attempts returned 403 without throttling, followed by a successful valid attempt.

Impact: guessing the shared code permits selecting any active non-Entra-linked person exposed by the demo roster, including privileged demo people if configured. Microsoft-linked identities remain excluded. This is an app-layer finding; live external firewall configuration was not inspected.

Remediation: shared, atomic attempt throttling across instances for both endpoints; bounded backoff and monitoring; separate demo-only identities/data and stronger demo credentials. Keep legitimate demo access available as requested; do not silently change production credentials or permissions.

## P1 — Hosted logout does not revoke the signed session

Evidence: `apps/api/src/modules/identity/development-login.ts:64` deletes from an in-memory Map. Hosted sessions are issued and validated as signed tokens without entries in that Map. A captured test token remained accepted after revoke, on both the same and a second instance.

Impact: someone already holding a cookie can replay it for its remaining fixed 30-minute lifetime after logout or account switching. This does not demonstrate a way to steal that cookie. Expiry, active-person and current-permission checks still apply.

Remediation: store hashed session identifiers durably with expiry and revocation; validate on each authenticated request. Logout must revoke the exact session across instances. Preserve actor/current-access checks and secure cookie flags.

## P2 — AI concurrency and spend limits are per instance

Evidence: `apps/api/src/modules/ai/assistant.ts:31` stores active actors, minute counters and the daily counter in instance memory. Ten requests exhausted instance A's actor quota; an eleventh request was accepted by instance B using the same actor and store. No real model was called.

Impact: horizontal scaling or restarts reset/split quotas. The nominal daily 500-request budget and single active reply rule are not account-wide guarantees. Multiple instances can incur concurrent AI spend; conversation revision checks do not prevent the preceding model calls.

Remediation: shared atomic actor/account budgets and expiring concurrency leases, acquired before model work and released safely; keep request deadlines and context/output bounds. Define request versus model-call/token budgets explicitly.

## P2 — Permission hot path loads unbounded workspace audit history

Evidence: `apps/api/src/modules/access/sql-access-store.ts:25-39` invokes `ReadAccessWorkspace`, maps every person and parses every audit JSON record. The latest definition in `database/migrations/033_reporting_scope_integrity.sql:58` selects all account audit rows without pagination. Even `person(id)` uses this full snapshot. Dashboard card gates and AI authorization rechecks repeat snapshot reads.

Impact: routine login/dashboard/AI authorization cost grows with people and all historical audit events. This is a confirmed unbounded query/design issue; its contribution to current production latency has not been measured. This finding does not imply workspace data is returned to unauthorized browsers.

Remediation: separate actor/resource authorization context from administrative snapshots and paginated audit feeds. Load only required grants, relationships and resource state. Preserve execution-time SQL checks and permission-revocation correctness; do not fix this with an unrestricted long-lived authorization cache.

## Verification

Run `node --import tsx apps/api/test/security-audit.repro.ts` from the repository root for the first three characterization reproductions. It deliberately confirms existing vulnerable behavior and is not included in the normal test glob. Replace these observations with rejection regression tests when remediating.

Thirty selected authentication, effective-access, assistant, recommendation and workflow tests passed. They cover forged actors/tools, scoped denies, reporting constraints and current permissions. Live SQL integration and production firewall inspection were not run; passing unit tests do not prove all authorization paths safe.

Suggested order: shared demo attempt protection and revocable sessions, shared AI quotas, then bounded authorization queries with before/after performance measurements.

## Subsequent remediation status

The original evidence above records the pre-fix characterization. Production now uses shared SQL request quotas/leases rather than the local MemoryAiBudget fallback. Routine authorization reads omit audit and notification audit is addressed-person filtered. Administrative audit and workspace-wide authorization records remain unbounded and need a separate paginated/actor-context design. Runtime SQL and production browser verification are recorded in REGRESSION_OPTIMIZATION_2026-10-05.md. Demo-login findings are intentionally deferred.
