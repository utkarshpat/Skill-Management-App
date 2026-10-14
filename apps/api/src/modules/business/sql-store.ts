import { readSqlJson } from '../../shared/sql-json.js';
import sql from 'mssql';
import { readBusinessFile } from './files.js';
import { BlobServiceClient } from '@azure/storage-blob';
import type { BusinessFiles } from './business.js';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import type { PeopleSearchQuery, PeopleSearchResult } from './people-search.js';
import {
  identifier,
  normalizeBusinessAdministration,
  normalizeBusinessCollections,
  type BusinessStore,
  type BusinessContext,
  type BusinessDashboard,
  type BusinessQuery,
  type BusinessChange,
} from './business.js';
export function assertBusinessScope(
  before: BusinessContext,
  after: BusinessContext,
  exporting = false,
) {
  const scopes = (context: BusinessContext) =>
    JSON.stringify([...context.scopes].sort((a, b) => a.id.localeCompare(b.id)));
  if (!after.canView || (exporting && !after.canExport))
    throw new AccessError(403, 'Business access changed. Reload your workspace.');
  if (before.revision !== after.revision || scopes(before) !== scopes(after))
    throw new AccessError(409, 'Scope changed during this read. Refresh before continuing.');
}
export class SqlBusinessStore implements BusinessStore {
  constructor(
    private accountId: string,
    private storage?: { connection: string; container: string },
  ) {
    identifier(accountId);
  }
  async recordFiles(actor: string, kind: string, id: string): Promise<BusinessFiles> {
    if (!['skills', 'certifications'].includes(kind))
      throw new AccessError(400, 'Choose a skill or certification.');
    const result = await this.execute<BusinessFiles>(
      actor,
      'dbo.BusinessRecordFiles',
      undefined,
      request =>
        request
          .input('kind', sql.VarChar(20), kind)
          .input('id', sql.UniqueIdentifier, identifier(id)),
    );
    const current = await this.context(actor);
    if (!current.canView || current.revision !== result.workspaceRevision)
      throw new AccessError(409, 'File access changed. Reopen the viewer.');
    return normalizeBusinessCollections(result, ['items']);
  }
  async file(actor: string, kind: string, id: string, fileId: string) {
    if (!this.storage) throw new AccessError(503, 'Private file storage is not configured.');
    return readBusinessFile(
      () => this.recordFiles(actor, kind, id),
      async item => {
        const container = BlobServiceClient.fromConnectionString(
          this.storage!.connection,
        ).getContainerClient(this.storage!.container);
        if ((await container.getProperties()).blobPublicAccess)
          throw new AccessError(503, 'File storage must be private.');
        return container.getBlockBlobClient(item.blobName).downloadToBuffer(0, item.bytes);
      },
      fileId,
    );
  }
  private async execute<T>(
    actor: string,
    procedure: string,
    payload?: object,
    extra?: (request: sql.Request) => sql.Request,
  ): Promise<T> {
    identifier(actor);
    try {
      return await withRuntimeDatabase(async pool => {
        let request = pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor);
        if (payload)
          request = request.input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload));
        if (extra) request = extra(request);
        const result = await request.execute(procedure);
        if (!result.recordset?.[0]?.json)
          throw new AccessError(503, 'Business Operations storage is unavailable.');
        return readSqlJson<T>(result.recordset[0].json);
      });
    } catch (error) {
      return this.failure(error);
    }
  }
  private failure(error: unknown): never {
    const number = (error as { number?: number }).number;
    if (number === 51003)
      throw new AccessError(403, 'Current access does not allow this operation.');
    if (number === 51009) throw new AccessError(409, 'Data changed. Reload and preview again.');
    if (number === 51010) throw new AccessError(409, (error as Error).message);
    if (number === 51004) throw new AccessError(404, 'This record is unavailable.');
    if (number === 51000) throw new AccessError(400, (error as Error).message);
    if ([2601, 2627].includes(number ?? 0))
      throw new AccessError(409, 'This entry already exists. Reload before retrying.');
    if (number === 547) throw new AccessError(400, 'Choose records from the current account.');
    if ([2812, 208, 207].includes(number ?? 0))
      throw new AccessError(503, 'Business Operations database migration is pending.');
    throw error;
  }
  async context(actor: string) {
    return normalizeBusinessCollections(
      await this.execute<BusinessContext>(actor, 'dbo.BusinessContext'),
      ['scopes'],
    );
  }
  async administration(actor: string) {
    const result = await this.execute<Record<string, unknown>>(actor, 'dbo.BusinessAdministration');
    const fresh = await this.context(actor);
    if (!fresh.canManage) throw new AccessError(403, 'Administration access changed.');
    if (result.revision !== fresh.revision)
      throw new AccessError(409, 'Configuration changed during retrieval.');
    return normalizeBusinessAdministration(result);
  }
  async dashboard(actor: string, query: BusinessQuery, exporting = false) {
    const result = await this.execute<BusinessDashboard>(
      actor,
      'dbo.BusinessDashboard',
      query,
      request => request.input('export', sql.Bit, exporting),
    );
    result.context = normalizeBusinessCollections(result.context, ['scopes']);
    assertBusinessScope(result.context, await this.context(actor), exporting);
    return normalizeBusinessCollections(result, [
      'coverage',
      'credentialCoverage',
      'uncataloguedCredentials',
      'distribution',
      'categories',
      'comparisons',
      'expiry',
      'activity',
      'rows',
    ]);
  }
  async peopleSearch(actor: string, query: PeopleSearchQuery, exporting = false) {
    const result = await this.execute<PeopleSearchResult>(
      actor,
      'dbo.BusinessPeopleSearch',
      query,
      request => request.input('export', sql.Bit, exporting),
    );
    result.context = normalizeBusinessCollections(result.context, ['scopes']);
    const fresh = await this.context(actor);
    assertBusinessScope(result.context, fresh, exporting);
    if (!fresh.canMatch) throw new AccessError(403, 'Matching access changed.');
    result.query = query;
    result.rows ??= [];
    result.requirements ??= [];
    return result;
  }
  async change(actor: string, change: BusinessChange) {
    identifier(actor);
    try {
      await withRuntimeDatabase(pool =>
        pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.accountId)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('expected_revision', sql.Int, change.revision)
          .input('kind', sql.VarChar(30), change.kind)
          .input('id', sql.UniqueIdentifier, change.id)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(change.payload))
          .execute('dbo.SaveBusinessChange'),
      );
    } catch (error) {
      this.failure(error);
    }
  }
  async recoverWorkflow(actor: string, operation: string, payload: Record<string, unknown>) {
    const before = await this.context(actor);
    const result = await this.execute<Record<string, unknown> | null>(
      actor,
      'dbo.BusinessWorkflowRecovery',
      payload,
      request => request.input('operation', sql.VarChar(30), operation),
    );
    const after = await this.context(actor);
    if (
      JSON.stringify({ ...before, asOf: undefined }) !==
      JSON.stringify({ ...after, asOf: undefined })
    )
      throw new AccessError(409, 'Access changed during recovery. Reload before continuing.');
    return result;
  }
  async notifications(actor: string) {
    const before = await this.context(actor);
    const result = await this.execute<
      { id: string; at: string; title: string; body: string; href: string }[]
    >(actor, 'dbo.BusinessAmendmentNotifications');
    const after = await this.context(actor);
    if (
      JSON.stringify({ ...before, asOf: undefined }) !==
      JSON.stringify({ ...after, asOf: undefined })
    )
      throw new AccessError(409, 'Access changed during notification retrieval.');
    return result;
  }
  async workflow(actor: string, operation: string, payload: Record<string, unknown>) {
    const reading = ['MASTERS', 'AMENDMENTS', 'AMENDMENT', 'DEMANDS', 'MATCHES'].includes(
      operation,
    );
    const before = reading ? await this.context(actor) : undefined;
    const result = await this.execute<Record<string, unknown>>(
      actor,
      'dbo.BusinessWorkflow',
      payload,
      request => request.input('operation', sql.VarChar(30), operation),
    );
    if (before) {
      const after = await this.context(actor);
      if (
        JSON.stringify({ ...before, asOf: undefined }) !==
        JSON.stringify({ ...after, asOf: undefined })
      )
        throw new AccessError(409, 'Access changed during retrieval. Reload before continuing.');
      if (['DEMANDS', 'MATCHES'].includes(operation)) assertBusinessScope(before, after);
    }
    if (operation === 'MASTERS')
      return normalizeBusinessCollections(result, ['providers', 'certifications', 'skills']);
    if (['AMENDMENTS', 'DEMANDS', 'MATCHES'].includes(operation))
      return normalizeBusinessCollections(result, ['rows']);
    return result;
  }
}
