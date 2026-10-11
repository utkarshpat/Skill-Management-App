import { SqlCertificationReminders } from './modules/skills/certification-reminders.js';
import { closeRuntimeDatabase } from './shared/database.js';
try {
  const account = process.env.ACCESS_ACCOUNT_ID;
  if (!account) throw Error('Reminder account configuration is required.');
  const result = await new SqlCertificationReminders(account).run();
  console.info(JSON.stringify({ event: 'certification.reminders.completed', ...result }));
} catch {
  console.error('Credential reminder job failed. Check scheduler and database configuration.');
  process.exitCode = 1;
} finally {
  await closeRuntimeDatabase();
}
