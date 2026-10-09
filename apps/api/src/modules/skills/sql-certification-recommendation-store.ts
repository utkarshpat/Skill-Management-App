import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import type {
  CertificationRecommendationInput,
  CertificationRecommendationResponse,
  CertificationRecommendationStore,
} from './certification-recommendations.js';

export class SqlCertificationRecommendationStore implements CertificationRecommendationStore {
  constructor(private accountId: string) {}

  private async run(actor: string, action: string, payload: object = {}) {
    try {
      return await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('action', sql.VarChar(20), action)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.CertificationRecommendations'),
      );
    } catch (error) {
      const number = (error as { number?: number }).number;
      if (number === 2812 || number === 208)
        throw new AccessError(
          503,
          'Certification recommendation storage is unavailable. Apply migration 058 first.',
        );
      if (number === 51003)
        throw new AccessError(
          403,
          'Current access or direct reporting relationship does not allow this action.',
        );
      if (number === 51004)
        throw new AccessError(404, 'This recommendation or recipient is unavailable.');
      if (number === 51009 || number === 2627 || number === 2601)
        throw new AccessError(
          409,
          'This recommendation changed or was already saved. Refresh and retry.',
        );
      if (number === 51000)
        throw new AccessError(400, 'Check the certification recommendation and response.');
      throw error;
    }
  }

  async read(actor: string, view: 'received' | 'sent', page: number, search: string, id?: string) {
    const result = await this.run(actor, 'LIST', { view, page, search, id }),
      sets = result.recordsets as unknown as sql.IRecordSet<Record<string, unknown>>[];
    return {
      ...sets[0][0],
      page,
      pageSize: 20,
      items: sets[1].map(row => ({
        ...row,
        id: String(row.id).toLowerCase(),
        personId: String(row.personId).toLowerCase(),
        senderId: String(row.senderId).toLowerCase(),
      })),
    };
  }

  async people(actor: string, search: string) {
    const result = await this.run(actor, 'OPTIONS', { search });
    return { people: result.recordset.map(row => ({ ...row, id: String(row.id).toLowerCase() })) };
  }

  async send(actor: string, input: CertificationRecommendationInput) {
    await this.run(actor, 'SEND', input);
    return { saved: true, id: input.id };
  }

  async respond(actor: string, input: CertificationRecommendationResponse) {
    await this.run(actor, input.action, input);
    return { saved: true };
  }

  async analytics(actor: string) {
    let result: sql.IProcedureResult<Record<string, unknown>>;
    try {
      result = await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .execute('dbo.CertificationReviewAnalytics'),
      );
    } catch (error) {
      const number = (error as { number?: number }).number;
      if (number === 2812 || number === 208)
        throw new AccessError(
          503,
          'Certification review analytics are unavailable. Apply migration 058 first.',
        );
      if (number === 51003)
        throw new AccessError(403, 'Current certification review access does not allow analytics.');
      throw error;
    }
    const sets = result.recordsets as unknown as sql.IRecordSet<Record<string, unknown>>[];
    return { ...sets[0][0], categories: sets[1] };
  }

  async notifications(actor: string) {
    const result = await this.run(actor, 'NOTIFICATIONS');
    return result.recordset.map(row => ({
      id: String(row.id),
      at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
      title: String(row.title),
      body: String(row.body),
      href: String(row.href),
    }));
  }
}
