import {
  AccessError,
  type AccessStore,
  type CustomRole,
  type LocalAccessState,
  type LocalPerson,
} from './local-access-store.js';

export interface DirectoryQuery {
  kind: 'people' | 'templates' | 'nodes';
  search: string;
  page: number;
  nodeKind?: 'DELIVERY_UNIT' | 'PORTFOLIO' | 'DEPARTMENT' | 'TEAM';
  parentId?: string;
}
export interface DirectoryItem {
  id: string;
  name: string;
  employeeCode?: string;
  active?: boolean;
  permissions?: CustomRole['permissions'];
  parentId?: string | null;
  kind?: string;
}
export interface DirectoryPage {
  revision: number;
  items: DirectoryItem[];
  total: number;
  page: number;
  pageSize: number;
}
export interface PersonAdministration {
  revision: number;
  person: LocalPerson;
  roles: CustomRole[];
  organization: {
    nodes: { id: string; kind: string; name: string; parentId: string | null; active: boolean }[];
    assignments: {
      personId: string;
      departmentId: string | null;
      teamId: string | null;
      managerId: string | null;
    }[];
    people: { id: string; displayName: string; employeeCode: string; active: boolean }[];
  };
}
export function administrationId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new AccessError(400, 'Choose a valid person or organization record.');
  return value.toLowerCase();
}
export function directoryQuery(input: Record<string, unknown>): DirectoryQuery {
  if (
    Object.keys(input).some(k => !['kind', 'search', 'page', 'nodeKind', 'parentId'].includes(k)) ||
    typeof input.kind !== 'string' ||
    !['people', 'templates', 'nodes'].includes(input.kind) ||
    (input.search !== undefined &&
      (typeof input.search !== 'string' || input.search.length > 100)) ||
    (input.page !== undefined &&
      (typeof input.page !== 'string' ||
        !/^\d{1,5}$/.test(input.page) ||
        Number(input.page) < 1 ||
        Number(input.page) > 10000))
  )
    throw new AccessError(400, 'Choose a valid directory search.');
  const kind = input.kind as DirectoryQuery['kind'];
  if (
    kind === 'nodes' &&
    (typeof input.nodeKind !== 'string' ||
      !['DELIVERY_UNIT', 'PORTFOLIO', 'DEPARTMENT', 'TEAM'].includes(input.nodeKind))
  )
    throw new AccessError(400, 'Choose an organization level.');
  if (kind !== 'nodes' && (input.nodeKind !== undefined || input.parentId !== undefined))
    throw new AccessError(400, 'Unexpected organization filter.');
  if (
    kind === 'nodes' &&
    ((input.nodeKind === 'DELIVERY_UNIT' && input.parentId !== undefined) ||
      (input.nodeKind !== 'DELIVERY_UNIT' && input.parentId === undefined))
  )
    throw new AccessError(400, 'Choose the preceding organization level.');
  return {
    kind,
    search: String(input.search ?? '').trim(),
    page: Number(input.page ?? 1),
    ...(kind === 'nodes' ? { nodeKind: input.nodeKind as DirectoryQuery['nodeKind'] } : {}),
    ...(input.parentId !== undefined ? { parentId: administrationId(input.parentId) } : {}),
  };
}
export async function readDirectory(
  store: AccessStore,
  actorId: string,
  query: DirectoryQuery,
): Promise<DirectoryPage> {
  if (store.directory) return store.directory(actorId, query);
  if (store.storage === 'azure-sql')
    throw new AccessError(503, 'Install the current search-based administration migration.');
  const state = await store.snapshot({ includeAudit: false });
  const rows: DirectoryItem[] =
    query.kind === 'people'
      ? state.people.map(p => ({
          id: p.id,
          name: p.displayName,
          employeeCode: p.employeeCode,
          active: p.active,
        }))
      : query.kind === 'templates'
        ? state.roles.map(r => ({ id: r.id, name: r.name, permissions: r.permissions }))
        : [];
  const q = query.search.toLocaleLowerCase();
  const matched =
    query.kind === 'people' && q.length < 2
      ? []
      : rows
          .filter(r => (r.name + ' ' + (r.employeeCode ?? '')).toLocaleLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    revision: state.revision,
    items: matched.slice((query.page - 1) * 10, query.page * 10),
    total: matched.length,
    page: query.page,
    pageSize: 10,
  };
}
export async function readPersonAdministration(
  store: AccessStore,
  actorId: string,
  id: string,
): Promise<PersonAdministration> {
  if (store.personAdministration) return store.personAdministration(actorId, id);
  if (store.storage === 'azure-sql')
    throw new AccessError(503, 'Install the current search-based administration migration.');
  const state: LocalAccessState = await store.snapshot({ includeAudit: false }),
    person = state.people.find(p => p.id === id);
  if (!person) throw new AccessError(404, 'This person is unavailable.');
  return {
    revision: state.revision,
    person,
    roles: state.roles.filter(r => person.roleIds.includes(r.id)),
    organization: { nodes: [], assignments: [], people: [] },
  };
}
