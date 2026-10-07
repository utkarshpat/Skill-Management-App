import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import type {
  WorkflowStore,
  WorkflowRecord,
  WorkflowEvent,
  WorkflowOptions,
  WorkflowChange,
  WorkflowFilters,
  WorkflowSummary,
} from './workflows.js';
const record = (r: WorkflowRecord & { createdAt: Date; updatedAt: Date }) => ({
  ...r,
  id: r.id.toLowerCase(),
  requesterId: r.requesterId.toLowerCase(),
  recipientId: r.recipientId.toLowerCase(),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
export class SqlWorkflowStore implements WorkflowStore {
  constructor(private accountId: string) {}
  private async run(
    actor: string,
    mode: string,
    id?: string,
    page = 1,
    inbox = false,
    payload?: WorkflowChange,
  ) {
    try {
      return await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('mode', sql.VarChar(20), mode)
          .input('record_id', sql.UniqueIdentifier, id ?? null)
          .input('page', sql.Int, page)
          .input('inbox', sql.Bit, inbox)
          .input('payload', sql.NVarChar(sql.MAX), payload ? JSON.stringify(payload) : null)
          .execute('dbo.WorkflowWorkspace'),
      );
    } catch (error) {
      const n = (error as { number?: number }).number;
      if (n === 51003)
        throw new AccessError(403, 'Your current permissions do not allow this action.');
      if (n === 51004) throw new AccessError(404, 'This record is unavailable.');
      if (n === 51009)
        throw new AccessError(
          409,
          'The record or recipient changed. Reload and review before submitting.',
        );
      if (n === 51011)
        throw new AccessError(
          409,
          'Choose an active recipient with permission to receive this type. Ask your administrator if none are available.',
        );
      if (n === 51000 || n === 547)
        throw new AccessError(400, 'Check the type, recipient and text fields.');
      throw error;
    }
  }
  async options(actor: string, query = ''): Promise<WorkflowOptions> {
    let r;
    try {
      r = await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('mode', sql.VarChar(20), 'OPTIONS')
          .input('query', sql.NVarChar(100), query)
          .execute('dbo.WorkflowWorkspace'),
      );
    } catch (error) {
      if ((error as { number?: number }).number === 51003)
        throw new AccessError(403, 'Workspace access is not assigned.');
      throw error;
    }
    const sets = r.recordsets as unknown as [
      sql.IRecordSet<{ canRequest: boolean; canIncident: boolean }>,
      sql.IRecordSet<WorkflowOptions['recipients'][number]>,
    ];
    return { ...sets[0][0], recipients: sets[1].map(p => ({ ...p, id: p.id.toLowerCase() })) };
  }
  async list(
    actor: string,
    page: number,
    inbox: boolean,
    filters: WorkflowFilters = { query: '', kind: '', status: '', priority: '', category: '' },
  ) {
    try {
      const r = await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('page', sql.Int, page)
          .input('inbox', sql.Bit, inbox)
          .input('query', sql.NVarChar(80), filters.query)
          .input('kind', sql.VarChar(8), filters.kind)
          .input('status', sql.VarChar(20), filters.status)
          .input('priority', sql.VarChar(6), filters.priority)
          .input('category', sql.VarChar(24), filters.category)
          .execute('dbo.ReadWorkflowList'),
      );
      const sets = r.recordsets as unknown as [
        sql.IRecordSet<{ total: number; page: number }>,
        sql.IRecordSet<WorkflowRecord & { createdAt: Date; updatedAt: Date }>,
        sql.IRecordSet<WorkflowSummary>,
      ];
      return { ...sets[0][0], pageSize: 10, items: sets[1].map(record), summary: sets[2][0] };
    } catch (error) {
      const n = (error as { number?: number }).number;
      if (n === 51003)
        throw new AccessError(403, 'Your current permissions do not allow viewing requests.');
      if (n === 51000) throw new AccessError(400, 'Check the list filters.');
      throw error;
    }
  }
  async detail(actor: string, id: string) {
    const r = await this.run(actor, 'DETAIL', id);
    const sets = r.recordsets as unknown as [
      sql.IRecordSet<WorkflowRecord & { createdAt: Date; updatedAt: Date }>,
      sql.IRecordSet<WorkflowEvent & { at: Date }>,
    ];
    return {
      record: record(sets[0][0]),
      events: sets[1].map(e => ({ ...e, at: e.at.toISOString() })),
    };
  }
  async reassignmentOptions(actor: string, id: string, query = '') {
    try {
      const r = await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('mode', sql.VarChar(20), 'REASSIGN_OPTIONS')
          .input('record_id', sql.UniqueIdentifier, id)
          .input('query', sql.NVarChar(100), query)
          .execute('dbo.WorkflowWorkspace'),
      );
      return r.recordset.map((p: WorkflowOptions['recipients'][number]) => ({
        ...p,
        id: p.id.toLowerCase(),
      }));
    } catch (error) {
      const n = (error as { number?: number }).number;
      if (n === 51004) throw new AccessError(404, 'This record is unavailable.');
      if (n === 51003) throw new AccessError(403, 'Reassignment is not permitted.');
      if (n === 51009) throw new AccessError(409, 'This record is no longer active.');
      throw error;
    }
  }
  async change(actor: string, input: WorkflowChange) {
    await this.run(actor, input.action, input.id, 1, false, input);
  }
  async notifications(actor: string) {
    const r = await this.run(actor, 'NOTIFICATIONS');
    return r.recordset.map(
      (e: { id: string; at: Date; title: string; body: string; href: string }) => ({
        ...e,
        at: e.at.toISOString(),
      }),
    );
  }
}
