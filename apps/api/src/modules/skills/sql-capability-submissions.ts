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
import { assembleUpload, type UploadChunk } from './upload-chunks.js';
import { PrivateFileStorage, type StorageOptions } from '../../shared/private-files.js';
export class SqlCapabilitySubmissionStore implements CapabilitySubmissionStore {
  private storage?: { connection: string; container: string };
  private managed?: PrivateFileStorage;
  async autofillPart(
    actor: string,
    source: Buffer,
    mimeType: string,
    fileName: string,
    part: UploadChunk,
  ) {
    if (this.managed)
      return this.managed.assemble(
        actor,
        'autofill',
        0,
        part,
        source,
        mimeType,
        fileName,
        5 * 1024 * 1024,
      );
    if (!this.storage) throw new AccessError(503, 'Private file storage unavailable.');
    const container = BlobServiceClient.fromConnectionString(
      this.storage.connection,
    ).getContainerClient(this.storage.container);
    return assembleUpload(
      container,
      this.account,
      actor,
      'autofill',
      0,
      part,
      source,
      mimeType,
      fileName,
      5 * 1024 * 1024,
    );
  }
  get storageConfigured() {
    return Boolean(this.storage || this.managed);
  }
  constructor(
    private account: string,
    storage?: StorageOptions,
  ) {
    if (storage && 'provider' in storage) this.managed = new PrivateFileStorage(account, storage);
    else this.storage = storage;
  }
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
    part?: UploadChunk,
  ) {
    if (this.managed) {
      const before = await this.stagedFiles(actor, id, cert);
      if (!before.canUpload) throw new AccessError(403, 'Draft file upload is not assigned.');
      if (before.revision !== revision)
        throw new AccessError(409, 'Draft changed. Reload before uploading.');
      if (part) {
        const full = await this.managed.assemble(
          actor,
          `intake/${id}/${cert}`,
          revision,
          part,
          source,
          mimeType,
          fileName,
          5 * 1024 * 1024,
        );
        if (!full) return { pending: true };
        source = full;
      }
      const prepared = await prepareCertificateFile(source, mimeType, fileName),
        fileId = randomUUID();
      try {
        await this.managed.save(
          {
            actor,
            context: 'intake',
            record: certificationId(cert),
            submission: certificationId(id),
          },
          { ...prepared, id: fileId, revision, fileName },
        );
      } catch (error) {
        const current = await this.stagedFiles(actor, id, cert).catch(() => undefined);
        if (current?.items.some((i: any) => i.id === fileId)) return current;
        throw error;
      }
      return this.stagedFiles(actor, id, cert);
    }
    if (!this.storage) throw new AccessError(503, 'Private file storage unavailable.');
    const before = await this.stagedFiles(actor, id, cert);
    if (!before.canUpload) throw new AccessError(403, 'Draft file upload is not assigned.');
    if (before.revision !== revision)
      throw new AccessError(409, 'Draft changed. Reload before uploading.');
    if (part) {
      const container = BlobServiceClient.fromConnectionString(
        this.storage.connection,
      ).getContainerClient(this.storage.container);
      const assembled = await assembleUpload(
        container,
        this.account,
        actor,
        `intake/${id}/${cert}`,
        revision,
        part,
        source,
        mimeType,
        fileName,
        5 * 1024 * 1024,
      );
      if (!assembled) return { pending: true };
      source = assembled;
      const current = await this.stagedFiles(actor, id, cert);
      if (!current.canUpload || current.revision !== revision)
        throw new AccessError(409, 'Draft changed. Reopen it before uploading.');
    }
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
    if (!this.storage && !this.managed)
      throw new AccessError(503, 'Private file storage unavailable.');
    const before = await this.stagedFiles(actor, id, cert),
      item = before.items.find((i: any) => i.id === certificationId(fileId));
    if (!item || item.bytes < 1 || item.bytes > 5 * 1024 * 1024)
      throw new AccessError(404, 'Draft file unavailable.');
    const data = this.managed
        ? await this.managed.read(
            { actor, context: 'intake', record: cert, submission: id },
            fileId,
          )
        : await this.legacyDownload(item),
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
  private async legacyDownload(item: { blobName: string; bytes: number }) {
    if (!this.storage) throw new AccessError(503, 'Private file storage unavailable.');
    const container = BlobServiceClient.fromConnectionString(
      this.storage.connection,
    ).getContainerClient(this.storage.container);
    if ((await container.getProperties()).blobPublicAccess)
      throw new AccessError(503, 'Private storage required.');
    return container.getBlockBlobClient(item.blobName).downloadToBuffer(0, item.bytes);
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
    if (!this.storage && !this.managed)
      throw new AccessError(503, 'Private file storage unavailable.');
    const before = await this.files(actor, id, record),
      item = before.items.find((i: any) => i.id === certificationId(fileId));
    if (!item || !Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > 10 * 1024 * 1024)
      throw new AccessError(404, 'Submitted file unavailable.');
    const data = this.managed
      ? await this.managed.read({ actor, context: 'submission', record, submission: id }, fileId)
      : await this.legacyDownload(item);
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
