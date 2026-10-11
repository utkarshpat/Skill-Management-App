# Scheduled credential expiry reminders

Migration 065 and the daily job persist in-app notifications independently of browser activity. Activation requires both the SQL migration and production scheduler configuration; source code alone does not mean the hosted schedule is active. Email delivery is not included.

## Behavior

- Owner reminders at 14, 10, 7, 5, 3 and 0 days before the UTC expiry date.
- Organization-managed daily job; recommended time 06:00 UTC (11:30 IST). Milestones are UTC calendar-day based. Vercel is temporary hosting and no Vercel cron is activated.
- Unique account + credential + expiry date + milestone key prevents duplicates. Account workspace locking serializes overlapping jobs with credential/renewal/access writes.
- Missed due dates are caught up from the migration activation date, bounded to 90 days. Migration does not backfill old milestones preceding activation.
- Notifications remain readable for up to 90 days, subject to the existing 30-item feed limit. Text reflects current expiry rather than incorrectly saying “in 14 days” when read later.
- A renewal draft does not stop reminders. Submitted or approved renewal suppresses both future generation and existing reminder delivery. Returned/rejected renewal allows reminders again. No renewal is automatically approved.
- Reads recheck active account/person, personal permissions, current credential state and expiry, and renewal status. No manager or business scope is added.
- Same-day reminders remain available through the existing notification feed even before the first scheduled run. Persistent reminders need a successful job.
- Job completion updates only scheduler state, never the global access revision or employee claim history.

## Activation

1. Verify the intended SQL database and install reviewed migration 065 through the existing migration CLI.
2. Configure the organization's scheduler (for example a server scheduled task, cron or infrastructure job) to run the built CLI: `node dist/certification-reminders-cli.js` from `apps/api`. Supply the existing restricted runtime database configuration and account from the organization's secret manager. For local verification, `npm run reminders:run -w apps/api` uses the normal ignored API env file.
3. The CLI logs only the event and created count, returns a nonzero exit code on failure, and closes database resources. Configure failed-job alerts and retry with the same account. No web browser, AI provider or extra HTTP secret is needed for CLI execution.
4. If infrastructure can only call HTTP, set a strong server-only `CERTIFICATION_REMINDER_SECRET` and invoke `GET /api/jobs/certification-expiry` with the matching bearer header. Never put it in Git, browser configuration or a `VITE_*` variable. Success returns HTTP 200 with `{ok:true, created:N}`; missing configuration returns 503, missing/wrong bearer returns 401, and SQL failure returns 503 without private diagnostics.
5. Verify the production account's `CertificationReminderSchedule.last_completed_at` and owner notification feed. Do not claim live automation until these checks pass.

No caller-supplied account/person/date is used. The account is the server-configured `ACCESS_ACCOUNT_ID`, and SQL also restricts it to the runtime identity's bound account. Jobs must not expose their secret in request logs or diagnostics.

## Verification

- API route tests cover unauthenticated/wrong/same-length-wrong bearer, ordinary cookie refusal, caller scope injection, unavailable configuration, success and private diagnostic withholding.
- Real SQL rollback fixture covers all six milestones, off-days, retry deduplication, missed-run catch-up, unchanged access revision and draft/submitted/rejected renewal behavior.
- Run fixture: `node --env-file-if-exists=.env --import tsx test/certification-reminders.integration.ts` from `apps/api`. Synthetic records and migration DDL roll back.
- API typecheck/build and architecture boundaries also verified.

Persisted reminder rows have no automatic physical cleanup yet; the user feed is bounded to 90 days. Monitor job failures and the last-completed timestamp. A scheduler outage can delay delivery; catching up records does not reconstruct notifications before migration activation.

## Current rollout status

Prepared and verified locally, including real SQL rollback fixtures. Migration 065 is not installed persistently; the verified development database is at 064. No daily job or machine secret is activated on temporary Vercel hosting. Deployment activation is deferred until organization infrastructure is selected. See [the hosting decision](HOSTING_DECISION.md).
