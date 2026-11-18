import { SqlAnnouncementRetention } from './modules/announcements/announcement-retention.js';
import { closeRuntimeDatabase } from './shared/database.js';
try {
  const account = process.env.ACCESS_ACCOUNT_ID;
  if (!account) throw Error('Announcement account configuration is required.');
  const execute = process.argv.includes('--execute');
  if (
    process.argv.slice(2).some(arg => !['--execute', '--preview'].includes(arg)) ||
    (execute && process.argv.includes('--preview'))
  )
    throw Error('Use --preview or --execute.');
  const result = await new SqlAnnouncementRetention(account).run(execute);
  console.info(
    JSON.stringify({
      event: execute ? 'announcements.retention.completed' : 'announcements.retention.preview',
      ...result,
    }),
  );
} catch {
  console.error('Announcement retention failed. Check database configuration and migration 106.');
  process.exitCode = 1;
} finally {
  await closeRuntimeDatabase();
}
