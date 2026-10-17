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
export { assembleBlobUpload as assembleUpload } from '../../shared/blob-upload.js';
