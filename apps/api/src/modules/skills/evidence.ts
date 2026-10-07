import sql from 'mssql';
import sharp from 'sharp';
import { BlobServiceClient } from '@azure/storage-blob';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
export interface EvidenceItem {
  id: string;
  blobName: string;
  bytes: number;
  width: number;
  height: number;
}
export interface EvidenceState {
  revision: number;
  canUpload: boolean;
  items: EvidenceItem[];
}
export interface EvidenceStore {
  read(actor: string, claim: string): Promise<EvidenceState>;
  upload(actor: string, claim: string, revision: number, data: Buffer): Promise<EvidenceState>;
  image(actor: string, claim: string, id: string): Promise<Buffer>;
}
export async function compressEvidence(data: Buffer) {
  if (!data.length || data.length > 1048576)
    throw new AccessError(413, 'Compressed image must be under 1 MB.');
  try {
    const image = sharp(data, { limitInputPixels: 16000000, animated: false, failOn: 'warning' }),
      metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
      throw Error();
    const result = await image
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > 1048576) throw Error();
    return { data: result.data, width: result.info.width, height: result.info.height };
  } catch {
    throw new AccessError(400, 'Choose a valid, single-frame JPEG, PNG or WebP image.');
  }
}
export class SqlBlobEvidenceStore implements EvidenceStore {
  private container;
  constructor(
    private account: string,
    connection: string,
    container: string,
  ) {
    this.container =
      BlobServiceClient.fromConnectionString(connection).getContainerClient(container);
  }
  private async run(
    actor: string,
    claim: string,
    operation = 'READ',
    revision?: number,
    item?: EvidenceItem,
  ): Promise<EvidenceState> {
    try {
      return await withRuntimeDatabase(async pool => {
        const result = await pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor)
          .input('claim_id', sql.UniqueIdentifier, claim)
          .input('operation', sql.VarChar(8), operation)
          .input('expected_revision', sql.Int, revision ?? null)
          .input('evidence_id', sql.UniqueIdentifier, item?.id ?? null)
          .input('blob_name', sql.VarChar(160), item?.blobName ?? null)
          .input('bytes', sql.Int, item?.bytes ?? null)
          .input('width', sql.Int, item?.width ?? null)
          .input('height', sql.Int, item?.height ?? null)
          .execute('dbo.SkillEvidence');
        const sets = result.recordsets as unknown as [
          sql.IRecordSet<{ revision: number; canUpload: boolean }>,
          sql.IRecordSet<EvidenceItem>,
        ];
        return { ...sets[0][0], items: sets[1].map(i => ({ ...i, id: i.id.toLowerCase() })) };
      });
    } catch (e) {
      const number = (e as { number?: number }).number;
      if (number === 51003) throw new AccessError(403, 'Evidence access is unavailable.');
      if (number === 51009) throw new AccessError(409, 'Claim changed. Refresh before uploading.');
      if (number === 51004) throw new AccessError(404, 'Evidence unavailable.');
      if (number === 51000 || number === 547)
        throw new AccessError(400, 'Image limit reached or invalid evidence.');
      throw e;
    }
  }
  read(actor: string, claim: string) {
    return this.run(actor, claim);
  }
  async upload(actor: string, claim: string, revision: number, data: Buffer) {
    await this.run(actor, claim, 'CHECK', revision);
    const image = await compressEvidence(data);
    const id = crypto.randomUUID(),
      blobName = `${this.account.toLowerCase()}/${claim.toLowerCase()}/${id}.webp`,
      blob = this.container.getBlockBlobClient(blobName);
    const properties = await this.container.getProperties();
    if (properties.blobPublicAccess)
      throw new AccessError(503, 'Evidence storage must be private.');
    await blob.uploadData(image.data, {
      blobHTTPHeaders: { blobContentType: 'image/webp', blobCacheControl: 'private, no-store' },
      conditions: { ifNoneMatch: '*' },
    });
    try {
      return await this.run(actor, claim, 'ADD', revision, {
        id,
        blobName,
        bytes: image.data.length,
        width: image.width,
        height: image.height,
      });
    } catch (e) {
      await blob.deleteIfExists().catch(() => undefined);
      throw e;
    }
  }
  async image(actor: string, claim: string, id: string) {
    const state = await this.read(actor, claim),
      item = state.items.find(i => i.id === id.toLowerCase());
    if (!item) throw new AccessError(404, 'Evidence unavailable.');
    const buffer = await this.container
      .getBlockBlobClient(item.blobName)
      .downloadToBuffer(0, item.bytes);
    const current = await this.read(actor, claim);
    if (!current.items.some(i => i.id === item.id && i.blobName === item.blobName))
      throw new AccessError(404, 'Evidence unavailable.');
    return buffer;
  }
}
export function configuredEvidence(env: NodeJS.ProcessEnv) {
  return env.ACCESS_ACCOUNT_ID &&
    env.EVIDENCE_STORAGE_CONNECTION_STRING &&
    env.EVIDENCE_STORAGE_CONTAINER
    ? new SqlBlobEvidenceStore(
        env.ACCESS_ACCOUNT_ID,
        env.EVIDENCE_STORAGE_CONNECTION_STRING,
        env.EVIDENCE_STORAGE_CONTAINER,
      )
    : undefined;
}
