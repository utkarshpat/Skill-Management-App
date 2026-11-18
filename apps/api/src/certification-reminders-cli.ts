import { SqlCertificationReminders } from './modules/skills/certification-reminders.js';
import { SqlAnnouncementRetention } from './modules/announcements/announcement-retention.js';
import { closeRuntimeDatabase } from './shared/database.js';
try {
  const account = process.env.ACCESS_ACCOUNT_ID;
  if (!account) throw Error('Scheduled account configuration is required.');
  const jobs = [
    {
      event: 'certification.reminders.completed',
      run: () => new SqlCertificationReminders(account).run(),
    },
    {
      event: 'announcements.retention.completed',
      run: () => new SqlAnnouncementRetention(account).run(true),
    },
  ];
  const results = await Promise.allSettled(jobs.map(job => job.run()));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled')
      console.info(JSON.stringify({ event: jobs[index].event, ...result.value }));
    else {
      console.error(JSON.stringify({ event: jobs[index].event.replace('.completed', '.failed') }));
      process.exitCode = 1;
    }
  });
} catch {
  console.error('Scheduled job failed. Check scheduler, account and database configuration.');
  process.exitCode = 1;
} finally {
  await closeRuntimeDatabase();
}
