import { createHash } from 'node:crypto';
import sql from 'mssql';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { withRuntimeDatabase } from './database.js';
import { AccessError } from './errors.js';
import { assembleBlobUpload } from './blob-upload.js';

export interface PrivateStorageConfig {
  provider: 'sql' | 'azure-blob';
  connection?: string;
  container?: string;
}
export interface FileAccess {
  actor: string;
  context: 'skill' | 'certification' | 'intake' | 'submission' | 'business-skill' | 'business-cert';
  record: string;
  submission?: string;
}
export interface StoredUpload {
  id: string;
  revision: number;
  data: Buffer;
  mimeType: string;
  fileName: string;
  width?: number | null;
  height?: number | null;
}
export type StorageOptions = PrivateStorageConfig | { connection: string; container: string };
export function privateStorageConfig(env: NodeJS.ProcessEnv): PrivateStorageConfig | undefined {
  const sqlFlag = env.STORAGE_IS_SQL;
  if (sqlFlag !== undefined && sqlFlag !== 'true' && sqlFlag !== 'false')
    throw new Error('STORAGE_IS_SQL must be true or false.');
  const provider =
    sqlFlag === undefined
      ? env.EVIDENCE_STORAGE_PROVIDER
      : sqlFlag === 'true'
        ? 'sql'
        : 'azure-blob';
  if (
    sqlFlag !== undefined &&
    env.EVIDENCE_STORAGE_PROVIDER &&
    env.EVIDENCE_STORAGE_PROVIDER !== provider
  )
    throw new Error('Conflicting storage settings. Use only STORAGE_IS_SQL.');
  if (provider && !['sql', 'azure-blob'].includes(provider))
    throw new Error('EVIDENCE_STORAGE_PROVIDER must be sql or azure-blob.');
  if (!provider && !(env.EVIDENCE_STORAGE_CONNECTION_STRING && env.EVIDENCE_STORAGE_CONTAINER))
    return;
  const selected = (provider || 'azure-blob') as PrivateStorageConfig['provider'];
  if (
    selected === 'azure-blob' &&
    !(env.EVIDENCE_STORAGE_CONNECTION_STRING && env.EVIDENCE_STORAGE_CONTAINER)
  )
    throw new Error('Azure Blob storage configuration is incomplete.');
  return {
    provider: selected,
    connection: env.EVIDENCE_STORAGE_CONNECTION_STRING,
    container: env.EVIDENCE_STORAGE_CONTAINER,
  };
}
export function contentDigest(data: Buffer) {
  return createHash('sha256').update(data).digest();
}
export function verifyFileContent(data: Buffer, bytes: number, digest?: Buffer | null) {
  if (data.length !== bytes || (digest && !contentDigest(data).equals(digest)))
    throw new AccessError(503, 'Complete verified file content is unavailable.');
  return data;
}
export class PrivateFileStorage {
  private blob?: ContainerClient;
  readonly provider: PrivateStorageConfig['provider'];
  constructor(
    private account: string,
    options: StorageOptions,
  ) {
    this.provider = 'provider' in options ? options.provider : 'azure-blob';
    if (options.connection && options.container)
      this.blob = BlobServiceClient.fromConnectionString(options.connection).getContainerClient(
        options.container,
      );
  }
  private async container() {
    if (!this.blob) throw new AccessError(503, 'This file requires the Azure Blob connection.');
    if ((await this.blob.getProperties()).blobPublicAccess)
      throw new AccessError(503, 'Private file storage required.');
    return this.blob;
  }
  private async execute<T>(
    procedure: string,
    access: FileAccess,
    configure?: (request: sql.Request) => sql.Request,
  ) {
    try {
      return await withRuntimeDatabase(async pool => {
        let request = pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, access.actor);
        if (configure) request = configure(request);
        const result = await request.execute(procedure);
        return (result.recordsets as unknown as T[][]).at(-1) ?? [];
      });
    } catch (e) {
      const n = (e as { number?: number }).number;
      if (n === 51003) throw new AccessError(403, 'File access denied.');
      if (n === 51004) throw new AccessError(404, 'File unavailable.');
      if ([51009, 51010, 2601, 2627].includes(n ?? 0))
        throw new AccessError(409, 'File or access changed. Reload before retrying.');
      if ([51000, 547].includes(n ?? 0)) throw new AccessError(400, 'Invalid file upload.');
      if ([2812, 208, 207, 8144, 201].includes(n ?? 0))
        throw new AccessError(503, 'Private file storage migration is pending.');
      throw e;
    }
  }
  async save(access: FileAccess, file: StoredUpload) {
    const extension = file.mimeType === 'application/pdf' ? 'pdf' : 'webp';
    const key =
      `${this.account}/${access.context === 'skill' ? '' : 'certifications/'}${access.record}/${file.id}${access.context === 'skill' ? '.' + extension : ''}`.toLowerCase();
    if (this.provider === 'azure-blob') {
      const container = await this.container();
      await container.getBlockBlobClient(key).uploadData(file.data, {
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: {
          blobContentType: file.mimeType,
          blobCacheControl: 'private, no-store',
        },
      });
    }
    // Content and attachment metadata commit together in SQL; uncertain Blob outcomes are retained.
    return this.execute('dbo.SavePrivateFile', access, r =>
      r
        .input('context', sql.VarChar(20), access.context)
        .input('record_id', sql.UniqueIdentifier, access.record)
        .input('submission_id', sql.UniqueIdentifier, access.submission ?? null)
        .input('expected_revision', sql.Int, file.revision)
        .input('file_id', sql.UniqueIdentifier, file.id)
        .input('provider', sql.VarChar(12), this.provider)
        .input('bytes', sql.Int, file.data.length)
        .input('sha256', sql.VarBinary(32), contentDigest(file.data))
        .input('mime_type', sql.VarChar(100), file.mimeType)
        .input('original_name', sql.NVarChar(255), file.fileName)
        .input('content', sql.VarBinary(sql.MAX), this.provider === 'sql' ? file.data : null)
        .input('width', sql.Int, file.width ?? null)
        .input('height', sql.Int, file.height ?? null),
    );
  }
  async read(access: FileAccess, id: string) {
    const rows = await this.execute<{
      provider: string;
      objectKey: string;
      bytes: number;
      sha256: Buffer | null;
      content: Buffer | null;
    }>('dbo.ReadPrivateFile', access, r =>
      r
        .input('context', sql.VarChar(20), access.context)
        .input('record_id', sql.UniqueIdentifier, access.record)
        .input('submission_id', sql.UniqueIdentifier, access.submission ?? null)
        .input('file_id', sql.UniqueIdentifier, id),
    );
    const item = rows[0];
    if (!item || !Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > 10 * 1024 * 1024)
      throw new AccessError(404, 'File unavailable.');
    const data =
      item.provider === 'sql'
        ? item.content
        : item.provider === 'azure-blob'
          ? await (
              await this.container()
            )
              .getBlockBlobClient(item.objectKey)
              .downloadToBuffer(0, item.bytes)
          : undefined;
    if (!Buffer.isBuffer(data)) throw new AccessError(503, 'File content unavailable.');
    return verifyFileContent(data, item.bytes, item.sha256);
  }
  async assemble(
    actor: string,
    target: string,
    revision: number,
    part: { id: string; index: number; count: number; bytes: number },
    data: Buffer,
    mime: string,
    name: string,
    maxBytes: number,
  ) {
    if (this.provider === 'azure-blob') {
      if (!this.blob) throw new AccessError(503, 'Azure Blob upload staging is unavailable.');
      return assembleBlobUpload(
        this.blob,
        this.account,
        actor,
        target,
        revision,
        part,
        data,
        mime,
        name,
        maxBytes,
      );
    }
    const size = 3 * 1024 * 1024;
    if (
      part.bytes > maxBytes ||
      part.bytes < 1 ||
      part.count !== Math.ceil(part.bytes / size) ||
      !Number.isInteger(part.index) ||
      part.index < 0 ||
      part.index >= part.count ||
      data.length !== Math.min(size, part.bytes - part.index * size)
    )
      throw new AccessError(400, 'Invalid upload part.');
    const binding = contentDigest(
      Buffer.from(
        JSON.stringify([actor, target, revision, part.id, part.count, part.bytes, mime, name]),
      ),
    );
    // Durable actor-bound staging works without Blob and survives process restarts.
    const rows = await this.execute<{ content: Buffer; sha256: Buffer }>(
      'dbo.StagePrivateUpload',
      { actor, context: 'intake', record: actor },
      r =>
        r
          .input('binding', sql.VarBinary(32), binding)
          .input('part_index', sql.Int, part.index)
          .input('part_count', sql.Int, part.count)
          .input('total_bytes', sql.Int, part.bytes)
          .input('content', sql.VarBinary(sql.MAX), data),
    );
    if (part.index !== part.count - 1) return;
    if (rows.length !== part.count)
      throw new AccessError(409, 'Upload incomplete. Retry missing parts.');
    return verifyFileContent(
      Buffer.concat(rows.map(r => verifyFileContent(r.content, r.content.length, r.sha256))),
      part.bytes,
    );
  }
}
