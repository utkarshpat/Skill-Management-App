import sql from 'mssql';
import { logEvent } from '../../shared/logger.js';
import { withRuntimeDatabase } from '../../shared/database.js';

interface Batch {
  eligible: number;
  deletedAnnouncements: number;
  deletedResponses: number;
  hasMore: boolean;
}
export class SqlAnnouncementRetention {
  constructor(
    private account: string,
    private database: typeof withRuntimeDatabase = withRuntimeDatabase,
  ) {}
  async run(execute = false) {
    const totals = { eligible: 0, deletedAnnouncements: 0, deletedResponses: 0 };
    for (;;) {
      const result = await this.database(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('execute', sql.Bit, execute)
          .execute<Batch>('dbo.PurgeExpiredAnnouncements'),
      );
      const batch = result.recordset?.[0];
      if (
        !batch ||
        ![batch.eligible, batch.deletedAnnouncements, batch.deletedResponses].every(
          n => Number.isSafeInteger(n) && n >= 0,
        )
      )
        throw Error('Invalid retention result.');
      if (execute && batch.deletedAnnouncements)
        logEvent('info', 'announcements.retention.batch_completed', {
          deletedAnnouncements: batch.deletedAnnouncements,
          deletedResponses: batch.deletedResponses,
        });
      totals.eligible += batch.eligible;
      totals.deletedAnnouncements += batch.deletedAnnouncements;
      totals.deletedResponses += batch.deletedResponses;
      if (!execute || !batch.hasMore) return totals;
      if (!batch.deletedAnnouncements) throw Error('Retention batch made no progress.');
    }
  }
}
