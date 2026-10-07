import { AccessError } from '../../shared/errors.js';
import { can, type AccessStore, type LocalAccessState } from './local-access-store.js';
import { readActorAccess } from './actor-context.js';
export interface AuditQuery {
  before?: number;
  personId?: string;
  query: string;
  pageSize: number;
  details: boolean;
}
export interface AuditItem {
  actorId: string;
  action: string;
  targetId: string;
  at: string;
  revision: number;
  actorName?: string;
  targetName?: string;
  before?: unknown;
  after?: unknown;
}
export interface AuditPage {
  items: AuditItem[];
  nextCursor: number | null;
  hasMore: boolean;
  revision: number;
}
export function auditQuery(input: Record<string, unknown>): AuditQuery {
  if (Object.keys(input).some(k => !['before', 'personId', 'q', 'pageSize', 'details'].includes(k)))
    throw new AccessError(400, 'Invalid activity filters.');
  const integer = (value: unknown, max: number) => {
    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1 ||
      Number(value) > max
    )
      throw new AccessError(400, 'Invalid activity page.');
    return Number(value);
  };
  const query = input.q ?? '';
  if (typeof query !== 'string' || query.length > 100)
    throw new AccessError(400, 'Search activity with up to 100 characters.');
  if (
    input.personId !== undefined &&
    (typeof input.personId !== 'string' ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.personId))
  )
    throw new AccessError(400, 'Invalid activity person.');
  if (
    input.details !== undefined &&
    (typeof input.details !== 'string' || !['true', 'false'].includes(input.details))
  )
    throw new AccessError(400, 'Invalid activity details.');
  return {
    query: query.trim(),
    pageSize: input.pageSize === undefined ? 25 : integer(input.pageSize, 50),
    details: input.details === 'true',
    ...(input.before !== undefined ? { before: integer(input.before, 2147483647) } : {}),
    ...(input.personId !== undefined ? { personId: String(input.personId).toLowerCase() } : {}),
  };
}
export function localAuditPage(
  state: LocalAccessState,
  actorId: string,
  query: AuditQuery,
): AuditPage {
  const person = state.people.find(p => p.id === actorId);
  if (!person || !can(state, person, 'audit.view'))
    throw new AccessError(403, 'Activity viewing is not assigned.');
  const matching = state.audit
    .filter(
      e =>
        (!query.before || e.revision < query.before) &&
        (!query.personId || e.targetId === query.personId),
    )
    .map(e => ({
      ...e,
      actorName: state.people.find(p => p.id === e.actorId)?.displayName,
      targetName:
        state.people.find(p => p.id === e.targetId)?.displayName ??
        state.roles.find(r => r.id === e.targetId)?.name,
    }))
    .filter(e =>
      [e.action, e.actorName, e.targetName, e.targetId, e.actorId]
        .join(' ')
        .toLowerCase()
        .includes(query.query.toLowerCase()),
    )
    .sort((a, b) => b.revision - a.revision);
  const hasMore = matching.length > query.pageSize,
    items = matching.slice(0, query.pageSize).map(e => {
      const { before, after, ...summary } = e;
      return { ...summary, ...(query.details ? { before, after } : {}) };
    });
  return {
    items,
    hasMore,
    nextCursor: hasMore ? items.at(-1)!.revision : null,
    revision: state.revision,
  };
}
export async function readAuditPage(
  store: AccessStore,
  actorId: string,
  query: AuditQuery,
): Promise<AuditPage> {
  const data = store.auditPage
    ? await store.auditPage(actorId, query)
    : localAuditPage(await store.snapshot(), actorId, query);
  const current = await readActorAccess(store, actorId),
    person = current.people.find(p => p.id === actorId);
  if (!person || !can(current, person, 'audit.view'))
    throw new AccessError(403, 'Activity access changed. Refresh your workspace.');
  return data;
}
