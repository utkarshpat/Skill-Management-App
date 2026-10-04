# Bug fixes and runtime optimization — 5 October 2026

Migrations 039/040 applied to the configured hosted database on 5 October 2026. Restricted runtime access reads and shared AI budget acquire/release passed. Application rollout and production browser verification are recorded below when complete. Demo login hardening is explicitly deferred.

## Implemented

- Dashboard retains loaded cards during same-revision refresh and transient errors, with refresh/error indicators. Authentication/permission errors clear the affected data. Overlapping manifest refresh requests are coalesced.
- Workspace transient refresh failures retain the mounted page and unsaved state with a retry notice. Authentication/authorization failures still remove the workspace.
- Notification sources load independently; unavailable sources produce an explicit partial-feed message. Permission failures fail closed. Malformed external-normalizing notification URLs are rejected.
- Assistant history fetches are cancelled on close, new conversation and unmount; stale results cannot replace a fresh chat. Collapse preserves the existing conversation and draft.
- Learning tabs persist in the URL; tab switches remove stale focused-resource parameters. Exact recommendation fetches always use page one.
- Learning skill mapping uses debounced server-side search and pagination. Selection survives result changes. No 20-page download/cutoff.
- Assistant legacy and durable requests both recheck the full capability/tool policy before returning generated output. Unauthorized or malformed requests are rejected before reserving budget.
- Hosted composition injects a shared SQL AI request budget: 10 requests per actor per UTC minute, 500 per account per UTC day, and one expiring actor lease. Releases match the exact lease, so an old request cannot release a newer one. SQL failures fail closed. These are request budgets, not exact token-cost caps.
- Authorization call sites skip audit payloads. The access read procedure uses shared serializable locks instead of update locks. Assignment hydration uses indexed Maps rather than repeated per-person array filtering. Notification audit reads are restricted to addressed person-update events.

## Rollout dependency

Apply migration 039 before deploying the new `SqlAccessStore` signature, then migration 040 before deploying shared AI budgets. Both are additive/backward-compatible with the old application. The new application deliberately has no fail-open fallback if migrations are missing.

The administrative access snapshot still includes full audit history, and non-audit snapshots still include workspace-wide people/roles/reporting. A future dedicated actor/resource context and paginated administrative audit API can reduce this further. Do not substitute a long-lived permission cache that hides revocations. No production latency percentage is claimed.

## Verification

- Full automated suite: 202 passed (5 architecture, 145 API, 52 web), including new partial-notification, budget, permission-revocation and navigation regressions.
- Workspace typechecking, production builds and architecture boundary checks.
- `apps/api/test/runtime-optimization.integration.ts` applies the SQL definitions inside rollback-only transactions against the configured development database. It verifies unchanged authorization recordsets, omitted audit data, actor concurrency, request quota and lease ownership; all temporary schema changes and budget test records roll back. The harness also supports rerunning after migrations are installed.
- User Chrome against the built frontend served by `apps/api/test/ui-regression-server.ts` on loopback, using only synthetic data: dashboard refresh retains content; partial notifications remain actionable; delayed old history cannot overwrite a fresh chat; collapse preserves drafts; Today tab survives reload; search reaches skill 503 and preserves selection into review; workspace refresh failure preserves an unsaved plan and retry clears the warning.

The UI fixture intentionally has no persistent mutations or real model. This is not a claim that every production user journey has been exercised. Login findings remain deferred in the security audit.
