import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';

export class SqlCertificationReminders {
  constructor(
    private account: string,
    private database: typeof withRuntimeDatabase = withRuntimeDatabase,
  ) {}
  async run() {
    const result = await this.database(pool =>
      pool
        .request()
        .input('account_id', sql.UniqueIdentifier, this.account)
        .execute('dbo.GenerateCertificationExpiryReminders'),
    );
    return { created: Number(result.recordset[0].created) };
  }
}
