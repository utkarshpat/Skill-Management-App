import { createHash } from 'node:crypto';
import type { ContainerClient } from '@azure/storage-blob';
import { AccessError } from '../../shared/errors.js';
export const uploadChunkBytes = 3 * 1024 * 1024;
export interface UploadChunk {
  id: string;
  index: number;
  count: number;
  bytes: number;
}
export function uploadChunk(
  headers: Record<string, string | string[] | undefined>,
): UploadChunk | undefined {
  const keys = ['x-upload-id', 'x-upload-index', 'x-upload-count', 'x-upload-bytes'];
  if (keys.every(key => headers[key] === undefined)) return;
  const [id, index, count, bytes] = keys.map(key => headers[key]);
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
    [index, count, bytes].some(v => typeof v !== 'string' || !/^\d+$/.test(v))
  )
    throw new AccessError(400, 'Invalid file upload part.');
  const value = {
    id: id.toLowerCase(),
    index: Number(index),
    count: Number(count),
    bytes: Number(bytes),
  };
  if (
    ![value.index, value.count, value.bytes].every(Number.isSafeInteger) ||
    value.bytes < 1 ||
    value.bytes > 10 * 1024 * 1024 ||
    value.count !== Math.ceil(value.bytes / uploadChunkBytes) ||
    value.index < 0 ||
    value.index >= value.count
  )
    throw new AccessError(400, 'Invalid file upload size or part order.');
  return value;
}
/** Caller rechecks ownership, editable state and revision before every part and final commit. */
export async function assembleUpload(
  container: ContainerClient,
  account: string,
  actor: string,
  target: string,
  revision: number,
  part: UploadChunk,
  data: Buffer,
  mime: string,
  name: string,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (
    part.bytes > maxBytes ||
    data.length !== Math.min(uploadChunkBytes, part.bytes - part.index * uploadChunkBytes)
  )
    throw new AccessError(400, 'Invalid file size or incomplete upload part.');
  if ((await container.getProperties()).blobPublicAccess)
    throw new AccessError(503, 'Private file storage required.');
  const binding = createHash('sha256')
    .update(JSON.stringify([actor, target, revision, part.id, part.count, part.bytes, mime, name]))
    .digest('hex');
  const blob = container.getBlockBlobClient(`${account.toLowerCase()}/upload-parts/${binding}`);
  const blockId = (index: number) => Buffer.from(String(index).padStart(4, '0')).toString('base64');
  await blob.stageBlock(blockId(part.index), data, data.length);
  if (part.index !== part.count - 1) return;
  try {
    await blob.commitBlockList(
      Array.from({ length: part.count }, (_, i) => blockId(i)),
      {
        blobHTTPHeaders: {
          blobContentType: 'application/octet-stream',
          blobCacheControl: 'private, no-store',
        },
      },
    );
  } catch {
    throw new AccessError(
      409,
      'The complete upload was not confirmed. Start the file upload again.',
    );
  }
  const complete = await blob.downloadToBuffer(0, part.bytes);
  if (complete.length !== part.bytes)
    throw new AccessError(503, 'The complete upload is unavailable.');
  // Private staging objects are retained: cleanup remains dry-run only.
  return complete;
}
