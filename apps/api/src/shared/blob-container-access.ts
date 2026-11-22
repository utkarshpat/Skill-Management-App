import type { ContainerClient } from '@azure/storage-blob';
import { AccessError } from './errors.js';

const checksInFlight = new WeakMap<ContainerClient, Promise<void>>();

export function ensurePrivateBlobContainer(container: ContainerClient): Promise<void> {
  const pending = checksInFlight.get(container);
  if (pending) return pending;
  const check = container
    .getProperties()
    .then(properties => {
      if (properties.blobPublicAccess) throw new AccessError(503, 'Private file storage required.');
    })
    .finally(() => checksInFlight.delete(container));
  checksInFlight.set(container, check);
  return check;
}
