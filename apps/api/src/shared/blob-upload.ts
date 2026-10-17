import { createHash } from 'node:crypto';
import type { ContainerClient } from '@azure/storage-blob';
import { AccessError } from './errors.js';
const uploadChunkBytes = 3 * 1024 * 1024;
interface BlobUploadPart {
  id: string;
  index: number;
  count: number;
  bytes: number;
}
/** Caller rechecks ownership, editable state and revision before every part and final commit. */
export async function assembleBlobUpload(
  container: ContainerClient,
  account: string,
  actor: string,
  target: string,
  revision: number,
  part: BlobUploadPart,
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
