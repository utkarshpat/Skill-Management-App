# Hosting decision — 11 October 2026

User decision: Vercel is temporary hosting. The intended permanent deployment is on organization-managed servers/infrastructure. The final operating system, scheduler, ingress, secret manager and identity/runtime topology are not yet selected.

## Implementation rules

- Keep core workflows, SQL, private attachments and AI providers independent of Vercel APIs.
- Vercel adapters are temporary deployment details, not business logic or mandatory dependencies.
- Background work must support the organization's scheduler through a portable CLI or authenticated machine endpoint. Do not depend on in-process timers in a web server or browser polling for durable scheduled work.
- Inject database/runtime identity, private storage, AI provider and job secrets through server configuration. Never embed credentials in frontend builds or documentation.
- Preserve the approved account-bound access model and execution-time permission/resource checks when changing hosts. A hosting move must not widen people or data access.
- Do not advertise jobs as live merely because code or a migration exists.

## Credential reminder rollout

The portable reminder implementation is prepared in migration 065, the CLI and the optional machine endpoint. Daily scheduler activation is deliberately deferred. No Vercel cron configuration or new scheduler secret is being installed now. Migration 065 has been tested using rollback-only SQL fixtures; the verified development database remains at migration 064.

The organization deployment must install the reviewed migration, configure a daily job, verify successful execution and retries, and perform hosted owner/renewal checks. See [the scheduler runbook](CERTIFICATION_REMINDER_SCHEDULER.md).

Existing same-day notification reads remain the current hosted behavior until that activation is completed. Email reminders remain a separate, unimplemented delivery feature.
