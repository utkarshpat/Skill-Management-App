# Scheduled certification expiry reminders

The employee and their current direct manager (N+1) get in-app reminders at 14, 10, 7, 5, 3 and 0 days before expiry. Manager delivery is evaluated when the feed loads, requires an active reporting relationship and current review permissions, and shows the employee name and expiry date. The alert grants no certificate or evidence access. A valid submitted renewal suppresses reminders, and an approved renewal replaces the old certificate in the current portfolio.

## Company deployment

1. Apply the release package's 06_093_scheduled_certification_reminders.sql after 092 is recorded. Migration 093 preserves the employee's existing milestone feed and adds persisted reminders for the scheduler to generate.
2. Deploy the matching App Service ZIP and let the API build finish.
3. Configure a daily company scheduler at 06:00 UTC to run `npm run reminders:run -w apps/api` from the deployed app root. The process needs ACCESS_ACCOUNT_ID and the existing restricted SQL runtime identity. Run the command once in the App Service SSH console to verify that the deployed command can use that identity. A scheduler outside App Service needs its own approved SQL identity and runtime account mapping.
4. Confirm that the job logs certification.reminders.completed and check both recipients' notification feeds with an eligible certificate. A zero created count can be expected if nothing is due or the job already ran. Check that unrelated managers and former managers cannot see the alert.

The SQL job is idempotent. The feed retains due reminders for up to 90 days, bounded by the existing feed limit. There is no email sender or public HTTP job endpoint.
