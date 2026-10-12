import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { readSqlJson } from '../../shared/sql-json.js';
import { AccessError } from '../../shared/errors.js';
import {
  normalizeCapabilityIds,
  capabilityResult,
  type CapabilitySubmissionStore,
} from './capability-submissions.js';
import { BlobServiceClient } from '@azure/storage-blob';
import { certificationId } from './certifications.js';
import { prepareCertificateFile } from './evidence.js';
import { randomUUID } from 'node:crypto';
export class SqlCapabilitySubmissionStore implements CapabilitySubmissionStore {
  get storageConfigured() {
    return Boolean(this.storage);
  }
  constructor(
    private account: string,
    private storage?: { connection: string; container: string },
  ) {}
  private async intakeFiles(
    actor: string,
    id: string,
    cert: string,
    operation = 'READ',
    payload: object = {},
  ) {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('id', sql.UniqueIdentifier, certificationId(id))
          .input('certification_id', sql.UniqueIdentifier, certificationId(cert))
          .input('operation', sql.VarChar(8), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.CapabilityIntakeFiles');
        const value = normalizeCapabilityIds(readSqlJson<any>(result.recordset[0].json));
        value.items ??= [];
        return value;
      });
    } catch (e) {
      if ((e as any).number === 51003) throw new AccessError(403, 'Own draft file access denied.');
      if ((e as any).number === 51009)
        throw new AccessError(409, 'Draft changed. Reopen it before retrying the file.');
      if ((e as any).number === 51000) throw new AccessError(400, 'Invalid draft file.');
      throw e;
    }
  }
  async stagedFiles(actor: string, id: string, cert: string) {
    return this.intakeFiles(actor, id, cert);
  }
  async stage(
    actor: string,
    id: string,
    cert: string,
    revision: number,
    source: Buffer,
    mimeType: string,
    fileName: string,
  ) {
    if (!this.storage) throw new AccessError(503, 'Private file storage unavailable.');
    const before = await this.stagedFiles(actor, id, cert);
    if (!before.canUpload) throw new AccessError(403, 'Draft file upload is not assigned.');
    if (before.revision !== revision)
      throw new AccessError(409, 'Draft changed. Reload before uploading.');
    const file = await prepareCertificateFile(source, mimeType, fileName),
      fileId = randomUUID();
    const blobName =
      `${this.account}/certifications/${certificationId(cert)}/${fileId}`.toLowerCase();
    const container = BlobServiceClient.fromConnectionString(
      this.storage.connection,
    ).getContainerClient(this.storage.container);
    if ((await container.getProperties()).blobPublicAccess)
      throw new AccessError(503, 'Private storage required.');
    await container.getBlockBlobClient(blobName).uploadData(file.data, {
      conditions: { ifNoneMatch: '*' },
      blobHTTPHeaders: { blobContentType: file.mimeType },
    });
    // Retain an unconfirmed object rather than deleting a possibly committed file.
    return this.intakeFiles(actor, id, cert, 'ADD', {
      id: fileId,
      blobName,
      revision,
      bytes: file.data.length,
      mimeType: file.mimeType,
      fileName: file.fileName,
      width: file.width,
      height: file.height,
    });
  }
  async stagedFile(actor: string, id: string, cert: string, fileId: string) {
    if (!this.storage) throw new AccessError(503, 'Private file storage unavailable.');
    const before = await this.stagedFiles(actor, id, cert),
      item = before.items.find((i: any) => i.id === certificationId(fileId));
    if (!item || item.bytes < 1 || item.bytes > 5 * 1024 * 1024)
      throw new AccessError(404, 'Draft file unavailable.');
    const container = BlobServiceClient.fromConnectionString(
      this.storage.connection,
    ).getContainerClient(this.storage.container);
    if ((await container.getProperties()).blobPublicAccess)
      throw new AccessError(503, 'Private storage required.');
    const data = await container.getBlockBlobClient(item.blobName).downloadToBuffer(0, item.bytes),
      after = await this.stagedFiles(actor, id, cert);
    if (
      !after.items.some(
        (i: any) => i.id === item.id && i.blobName === item.blobName && i.bytes === item.bytes,
      )
    )
      throw new AccessError(409, 'Draft file changed during download.');
    if (data.length !== item.bytes) throw new AccessError(503, 'Complete draft file unavailable.');
    return { data, item };
  }
  async files(actor: string, id: string, record: string) {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('id', sql.UniqueIdentifier, certificationId(id))
          .input('record_id', sql.UniqueIdentifier, certificationId(record))
          .execute('dbo.CapabilitySubmissionFiles');
        const value = normalizeCapabilityIds(
          readSqlJson<any>((result.recordsets as unknown as any[][]).flat().at(-1)?.json ?? '{}'),
        );
        value.items ??= [];
        return value;
      });
    } catch (e) {
      if ((e as any).number === 51003)
        throw new AccessError(403, 'Submitted evidence access denied.');
      if ((e as any).number === 51010)
        throw new AccessError(409, 'Submit the draft before opening its snapshot.');
      throw e;
    }
  }
  async file(actor: string, id: string, record: string, fileId: string) {
    if (!this.storage) throw new AccessError(503, 'Private file storage unavailable.');
    const before = await this.files(actor, id, record),
      item = before.items.find((i: any) => i.id === certificationId(fileId));
    if (!item || !Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > 5 * 1024 * 1024)
      throw new AccessError(404, 'Submitted file unavailable.');
    const container = BlobServiceClient.fromConnectionString(
      this.storage.connection,
    ).getContainerClient(this.storage.container);
    if ((await container.getProperties()).blobPublicAccess)
      throw new AccessError(503, 'Private storage is required.');
    const data = await container.getBlockBlobClient(item.blobName).downloadToBuffer(0, item.bytes);
    const after = await this.files(actor, id, record);
    if (
      after.workspaceRevision !== before.workspaceRevision ||
      after.revision !== before.revision ||
      !after.items.some(
        (i: any) => i.id === item.id && i.blobName === item.blobName && i.bytes === item.bytes,
      )
    )
      throw new AccessError(409, 'Record or access changed during download.');
    if (data.length !== item.bytes) throw new AccessError(503, 'Complete file unavailable.');
    return { data, item };
  }
  async run(actor: string, operation: string, payload: object) {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('operation', sql.VarChar(20), operation)
          .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
          .execute('dbo.CapabilitySubmissionWorkspace');
        return capabilityResult(
          operation,
          readSqlJson<any>((result.recordsets as unknown as any[][]).flat().at(-1)?.json ?? '{}'),
        );
      });
    } catch (error) {
      const number = (error as { number?: number }).number;
      if (number === 51014)
        throw new AccessError(
          409,
          'This certification already exists. Link the existing certificate, continue its draft, or use Renew.',
        );
      if (number === 51003)
        throw new AccessError(403, 'Current access does not allow this submission.');
      if (number === 51004) throw new AccessError(404, 'Submission unavailable.');
      if ([51009, 51010, 2601, 2627].includes(number ?? 0))
        throw new AccessError(
          409,
          'A record changed or is already in a review. Reload the saved submission before retrying.',
        );
      if (number === 51011)
        throw new AccessError(409, 'An active assigned current manager is required.');
      if ([51000, 51012, 547].includes(number ?? 0))
        throw new AccessError(
          400,
          'Complete related skills, credential details and certificate files before submitting.',
        );
      if ([2812, 208, 207].includes(number ?? 0))
        throw new AccessError(503, 'Combined capability storage migration is pending.');
      throw error;
    }
  }
}
