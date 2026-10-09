import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import type {
  Certification,
  CertificationChange,
  CertificationQuery,
  CertificationStore,
} from './certifications.js';

export class SqlCertificationStore implements CertificationStore {
  constructor(private account: string) {}
  private async run(actor: string, operation: string, payload: object) {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('operation', sql.VarChar(20), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.CertificationWorkspace');
        return result.recordsets as unknown as sql.IRecordSet<Record<string, unknown>>[];
      });
    } catch (e) {
      const number = (e as { number?: number }).number;
      if (number === 2812 || number === 208)
        throw new AccessError(
          503,
          'Certification storage is unavailable. Apply migration 053 before enabling this feature.',
        );
      if (number === 51003)
        throw new AccessError(403, 'Certification access is no longer available.');
      if (number === 51004) throw new AccessError(404, 'Certification unavailable.');
      if (number === 51009)
        throw new AccessError(409, 'Certification changed. Refresh before saving.');
      if (number === 51010)
        throw new AccessError(409, 'This certification cannot be changed in its current state.');
      if (number === 51011)
        throw new AccessError(
          409,
          'An active current reporting manager with review access is required.',
        );
      if (number === 51012)
        throw new AccessError(400, 'Attach a certificate image before submitting.');
      if (number === 51000 || number === 547)
        throw new AccessError(400, 'Check credential details and review feedback.');
      throw e;
    }
  }
  private records(rows: Record<string, unknown>[]): Certification[] {
    return rows.map(row => ({
      ...row,
      id: String(row.id).toLowerCase(),
      personId: String(row.personId).toLowerCase(),
      reviewerId: row.reviewerId ? String(row.reviewerId).toLowerCase() : undefined,
    })) as Certification[];
  }
  async read(actor: string, query: CertificationQuery) {
    const sets = await this.run(actor, 'LIST', query);
    return { total: Number(sets[0][0].total), records: this.records(sets[1]) };
  }
  async get(actor: string, id: string) {
    const sets = await this.run(actor, 'GET', { id });
    if (!sets[0]?.length) throw new AccessError(404, 'Certification unavailable.');
    return this.records(sets[0])[0];
  }
  async change(actor: string, change: CertificationChange) {
    await this.run(actor, change.action, change);
    if ((change.action === 'SAVE' || change.action === 'SAVE_SUBMIT') && change.renewedFromId) {
      try {
        await withRuntimeDatabase(async pool =>
          pool
            .request()
            .input('account_id', sql.UniqueIdentifier, this.account)
            .input('actor_id', sql.UniqueIdentifier, actor)
            .input('certification_id', sql.UniqueIdentifier, change.id)
            .input('renewed_from_id', sql.UniqueIdentifier, change.renewedFromId)
            .execute('dbo.LinkCertificationRenewal'),
        );
      } catch (e) {
        const number = (e as { number?: number }).number;
        if (number === 51003)
          throw new AccessError(403, 'Only your own manager-reviewed credential can be renewed.');
        if (number === 51004) throw new AccessError(404, 'Credential renewal is unavailable.');
        if (number === 51009)
          throw new AccessError(409, 'This credential changed. Refresh before retrying.');
        if (number === 51010)
          throw new AccessError(409, 'A renewal draft or submitted replacement already exists.');
        throw e;
      }
    }
  }
  async notifications(actor: string) {
    const [sets, expiry] = await Promise.all([
      this.run(actor, 'NOTIFICATIONS', {}),
      withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .execute('dbo.CertificationExpiryNotifications'),
      ),
    ]);
    const regular = sets[0].map(row => ({
      id: String(row.id),
      at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
      title: String(row.title),
      body: String(row.body),
      href: String(row.href),
    }));
    const expiryItems = expiry.recordset.map(row => ({
      id: String(row.id),
      at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
      title: String(row.title),
      body: String(row.body),
      href: String(row.href),
    }));
    return [...regular, ...expiryItems];
  }
}
