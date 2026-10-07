import type { AccessStore, LocalAccessState } from './local-access-store.js';
// Fresh, server-selected actor context, never a cache or reusable authorization token.
// Exact claim decisions and administration keep the full relationship snapshot.
export function readActorAccess(
  store: AccessStore,
  actorId: string,
  options?: { includeAudit?: boolean },
): Promise<LocalAccessState>;
export function readActorAccess(
  store: AccessStore | undefined,
  actorId: string | undefined,
  options?: { includeAudit?: boolean },
): Promise<LocalAccessState | undefined>;
export async function readActorAccess(
  store: AccessStore | undefined,
  actorId: string | undefined,
  options: { includeAudit?: boolean } = {},
) {
  if (!store || !actorId) return undefined;
  return store.actorSnapshot
    ? store.actorSnapshot(actorId, options)
    : store.snapshot({
        includeAudit: options.includeAudit ?? false,
        ...(options.includeAudit ? { auditPersonId: actorId } : {}),
      });
}
