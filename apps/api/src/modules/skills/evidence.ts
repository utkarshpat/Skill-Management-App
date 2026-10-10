import sql from 'mssql';
import sharp from 'sharp';
import { validateCertificateDocument } from './certificate-document.js';
import { BlobServiceClient } from '@azure/storage-blob';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
export interface EvidenceItem {
  id: string;
  blobName: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  mimeType?: string;
  fileName?: string;
}
export interface EvidenceState {
  revision: number;
  canUpload: boolean;
  items: EvidenceItem[];
}
export interface EvidenceStore {
  read(actor: string, claim: string): Promise<EvidenceState>;
  upload(
    actor: string,
    claim: string,
    revision: number,
    data: Buffer,
    file?: { mimeType: string; fileName: string },
  ): Promise<EvidenceState>;
  image(actor: string, claim: string, id: string): Promise<Buffer>;
  remove?(actor: string, claim: string, revision: number): Promise<EvidenceState>;
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

const certificateTypes: Record<string, { extension: string; image: boolean }> = {
  'image/jpeg': { extension: 'jpg', image: true },
  'image/png': { extension: 'png', image: true },
  'image/webp': { extension: 'webp', image: true },
  'application/pdf': { extension: 'pdf', image: false },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extension: 'docx',
    image: false,
  },
  'text/plain': { extension: 'txt', image: false },
};

function safeCertificateName(value: string, extension: string) {
  const clean = value
    .normalize('NFKC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .trim()
    .slice(0, 240);
  const stem = clean.replace(/\.[^.]*$/, '').trim() || 'certificate';
  return `${stem}.${extension}`;
}

export async function prepareCertificateFile(source: Buffer, mimeType: string, fileName: string) {
  const kind = certificateTypes[mimeType];
  if (!kind || !source.length || source.length > 5 * 1024 * 1024)
    throw new AccessError(400, 'Choose a supported certificate file up to 5 MB.');
  let data = source,
    storedType = mimeType,
    storedName = safeCertificateName(fileName, kind.extension),
    width: number | null = null,
    height: number | null = null;
  if (kind.image) {
    try {
      const image = sharp(source, {
          limitInputPixels: 16000000,
          animated: false,
          failOn: 'warning',
        }),
        metadata = await image.metadata();
      if (
        metadata.format !== (mimeType === 'image/jpeg' ? 'jpeg' : mimeType.slice(6)) ||
        (metadata.pages ?? 1) > 1
      )
        throw Error();
      const result = await image
        .rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      if (result.data.length > 1048576) throw Error();
      data = result.data;
      storedType = 'image/webp';
      storedName = safeCertificateName(fileName, 'webp');
      width = result.info.width;
      height = result.info.height;
    } catch {
      throw new AccessError(400, 'Choose a valid, single-frame JPEG, PNG or WebP image.');
    }
  } else if (mimeType === 'application/pdf') {
    try {
      await validateCertificateDocument(source, mimeType);
    } catch {
      throw new AccessError(400, 'This file is not a valid, readable PDF.');
    }
  } else if (mimeType === 'text/plain') {
    try {
      if (source.includes(0)) throw Error();
      new TextDecoder('utf-8', { fatal: true }).decode(source);
    } catch {
      throw new AccessError(400, 'Text certificates must be valid UTF-8.');
    }
  } else {
    try {
      await validateCertificateDocument(source, mimeType);
    } catch {
      throw new AccessError(400, 'This file is not a valid DOCX document.');
    }
  }
  return { data, mimeType: storedType, fileName: storedName, width, height };
}
export class SqlBlobEvidenceStore implements EvidenceStore {
  private container;
  constructor(
    private account: string,
    connection: string,
    container: string,
    private kind: 'skill' | 'certification' = 'skill',
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
        const request = pool
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
          .input('height', sql.Int, item?.height ?? null);
        if (this.kind === 'certification')
          request
            .input('mime_type', sql.VarChar(100), item?.mimeType ?? null)
            .input('file_name', sql.NVarChar(255), item?.fileName ?? null);
        const result = await request.execute(
          this.kind === 'certification' ? 'dbo.CertificationImage' : 'dbo.SkillEvidence',
        );
        const sets = result.recordsets as unknown as [
          sql.IRecordSet<{ revision: number; canUpload: boolean }>,
          sql.IRecordSet<EvidenceItem>,
        ];
        return { ...sets[0][0], items: sets[1].map(i => ({ ...i, id: i.id.toLowerCase() })) };
      });
    } catch (e) {
      const number = (e as { number?: number }).number;
      if (number === 2812 || number === 208)
        throw new AccessError(
          503,
          'Image storage schema is unavailable. Apply the required migration.',
        );
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
  async upload(
    actor: string,
    claim: string,
    revision: number,
    data: Buffer,
    file?: { mimeType: string; fileName: string },
  ) {
    await this.run(actor, claim, 'CHECK', revision);
    const attachment =
      this.kind === 'certification'
        ? await prepareCertificateFile(data, file?.mimeType ?? '', file?.fileName ?? 'certificate')
        : {
            ...(await compressEvidence(data)),
            mimeType: 'image/webp',
            fileName: 'evidence.webp',
          };
    const id = crypto.randomUUID(),
      extension = this.kind === 'certification' ? '' : '.webp',
      blobName = `${this.account.toLowerCase()}/${this.kind === 'certification' ? 'certifications/' : ''}${claim.toLowerCase()}/${id}${extension}`,
      blob = this.container.getBlockBlobClient(blobName);
    const properties = await this.container.getProperties();
    if (properties.blobPublicAccess)
      throw new AccessError(503, 'Evidence storage must be private.');
    await blob.uploadData(attachment.data, {
      blobHTTPHeaders: {
        blobContentType: this.kind === 'certification' ? attachment.mimeType : 'image/webp',
        blobCacheControl: 'private, no-store',
      },
      conditions: { ifNoneMatch: '*' },
    });
    try {
      return await this.run(actor, claim, 'ADD', revision, {
        id,
        blobName,
        bytes: attachment.data.length,
        width: attachment.width,
        height: attachment.height,
        ...(this.kind === 'certification'
          ? { mimeType: attachment.mimeType, fileName: attachment.fileName }
          : {}),
      });
    } catch (e) {
      // SQL rejection is definite; a transport failure may arrive after commit.
      if (e instanceof AccessError && [400, 403, 404, 409].includes(e.status)) {
        await blob.deleteIfExists().catch(() => undefined);
      } else {
        const current = await this.read(actor, claim).catch(() => undefined);
        if (current?.items.some(item => item.id === id && item.blobName === blobName))
          return current;
        // Retain the private object when the outcome cannot be established.
      }
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
  remove(actor: string, claim: string, revision: number) {
    if (this.kind !== 'certification') throw new AccessError(400, 'Removal unavailable.');
    return this.run(actor, claim, 'REMOVE', revision);
  }
}
export function configuredEvidence(
  env: NodeJS.ProcessEnv,
  kind: 'skill' | 'certification' = 'skill',
) {
  return env.ACCESS_ACCOUNT_ID &&
    env.EVIDENCE_STORAGE_CONNECTION_STRING &&
    env.EVIDENCE_STORAGE_CONTAINER
    ? new SqlBlobEvidenceStore(
        env.ACCESS_ACCOUNT_ID,
        env.EVIDENCE_STORAGE_CONNECTION_STRING,
        env.EVIDENCE_STORAGE_CONTAINER,
        kind,
      )
    : undefined;
}
