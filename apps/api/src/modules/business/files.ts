import { AccessError } from '../../shared/errors.js';
import { identifier, type BusinessFiles, type BusinessFile } from './business.js';
export async function readBusinessFile(
  read: () => Promise<BusinessFiles>,
  download: (item: BusinessFile) => Promise<Buffer>,
  fileId: string,
) {
  const before = await read();
  const item = before.items.find(i => i.id === identifier(fileId));
  if (!item || item.bytes < 1 || item.bytes > 5 * 1024 * 1024)
    throw new AccessError(404, 'File unavailable.');
  const data = await download(item);
  const after = await read();
  if (
    before.workspaceRevision !== after.workspaceRevision ||
    before.revision !== after.revision ||
    !after.items.some(
      i => i.id === item.id && i.blobName === item.blobName && i.bytes === item.bytes,
    )
  )
    throw new AccessError(409, 'Record or access changed during download. Reopen the viewer.');
  if (data.length !== item.bytes) throw new AccessError(503, 'Complete file unavailable.');
  return { item, data };
}
