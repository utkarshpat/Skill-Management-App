import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import type {
  CertificationChange,
  CertificationQuery,
  CertificationStore,
} from './certifications.js';

export class SqlCertificationStore implements CertificationStore {
  constructor(private accountId: string) {}
  private async run(actor: string, action: string, payload: object) {
    try {
      return await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('action', sql.VarChar(20), action)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute<Record<string, unknown>>('dbo.Certifications'),
      );
    } catch (error) {
      const n = (error as { number?: number }).number;
      if (n === 51003)
        throw new AccessError(
          403,
          'Current certification access or reviewer relationship does not allow this action.',
        );
      if (n === 51004) throw new AccessError(404, 'This certification is unavailable.');
      if ([51009, 2627, 2601].includes(n ?? 0))
        throw new AccessError(
          409,
          'The certification or reporting relationship changed. Refresh before retrying.',
        );
      if ([51000, 547].includes(n ?? 0))
        throw new AccessError(
          400,
          'Check the certification fields, issuer link, dates and current state.',
        );
      throw error;
    }
  }
  async read(actor: string, query: CertificationQuery, exporting = false) {
    const result = await this.run(actor, exporting ? 'EXPORT' : 'LIST', query);
    const sets = result.recordsets;
    if (!Array.isArray(sets) || sets.length !== 2 || sets[0].length !== 1)
      throw new Error('Certification storage returned incomplete results.');
    return {
      ...sets[0][0],
      page: query.page,
      pageSize: exporting ? 5000 : 20,
      items: sets[1].map(row => {
        if (
          typeof row.id !== 'string' ||
          typeof row.personId !== 'string' ||
          !(row.reviewerId === null || typeof row.reviewerId === 'string') ||
          typeof row.history !== 'string'
        )
          throw new Error('Certification storage returned an incomplete record.');
        const history: unknown = JSON.parse(row.history);
        if (!Array.isArray(history))
          throw new Error('Certification storage returned invalid history.');
        return {
          ...row,
          id: row.id.toLowerCase(),
          personId: row.personId.toLowerCase(),
          reviewerId: row.reviewerId?.toLowerCase() ?? null,
          history,
        };
      }),
    };
  }
  async change(actor: string, input: CertificationChange) {
    await this.run(actor, input.action, input);
    return { saved: true as const, id: input.id };
  }
}
