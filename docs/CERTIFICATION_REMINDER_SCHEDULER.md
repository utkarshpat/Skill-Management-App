# Scheduled certification expiry reminders

The employee and their current direct manager (N+1) get in-app reminders at 14, 10, 7, 5, 3 and 0 days before expiry. Manager delivery is evaluated when the feed loads, requires an active reporting relationship and current review permissions, and shows the employee name and expiry date. The alert grants no certificate or evidence access. A valid submitted renewal suppresses reminders, and an approved renewal replaces the old certificate in the current portfolio.

## Company deployment

1. Apply the release package's 06_093_scheduled_certification_reminders.sql after 092 is recorded. Migration 093 preserves the employee's existing milestone feed and adds persisted reminders for the scheduler to generate.
2. Apply `07_094_read_only_notification_projections.sql` after 093, `08_095_paginate_expiry_reminders.sql` after 094, `09_096_analytics_credential_coverage.sql` after 095 and `10_097_direct_report_expiry_reminder_link.sql` after 096. Only then deploy the matching App Service ZIP and let the API build finish. Migration 094 removes unnecessary workspace write-lock contention from notification reads without widening access. Migration 095 is required because the API passes the reminder page parameter. Migration 097 sends a manager's direct-report expiry reminder to that employee in Team analytics; it grants no certificate or evidence access.
3. The App Service ZIP includes the triggered `certification-reminders` WebJob under `App_Data/jobs/triggered`. Use this exact casing on Linux. Its `settings.job` schedules a daily run at 06:00 UTC on the default UTC configuration. Keep WebJobs runtime and Always On enabled for scheduled runs. The job uses `ACCESS_ACCOUNT_ID` and the existing restricted SQL runtime identity. Use either this WebJob or an external scheduler for the same app.
4. Confirm that the job logs certification.reminders.completed and check both recipients' notification feeds with an eligible certificate. A zero created count can be expected if nothing is due or the job already ran. Check that unrelated managers and former managers cannot see the alert.

The SQL job is idempotent. The feed retains due reminders for up to 90 days, bounded by the existing feed limit. There is no email sender or public HTTP job endpoint.
