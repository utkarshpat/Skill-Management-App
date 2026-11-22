import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';

export class SqlCertificationReminders {
  constructor(
    private account: string,
    private database: typeof withRuntimeDatabase = withRuntimeDatabase,
  ) {}
  async run() {
    return this.generate('dbo.GenerateCertificationExpiryReminders');
  }
  async runSkillStaleness() {
    return this.generate('dbo.GenerateSkillStalenessReminders');
  }
  private async generate(procedure: string) {
    const result = await this.database(pool =>
      pool.request().input('account_id', sql.UniqueIdentifier, this.account).execute(procedure),
    );
    return { created: Number(result.recordset[0].created) };
  }
}
