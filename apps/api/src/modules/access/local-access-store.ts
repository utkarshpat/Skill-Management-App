import { AccessError } from '../../shared/errors.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { authorize, type Grant } from './domain/authorization.js';
import { permissionCatalogue, type PermissionCode } from './access-catalogue.js';

export interface Assignment { permission: PermissionCode; scope: 'OWN' | 'ORGANIZATION'; effect: 'ALLOW' | 'DENY'; validUntil?: string }
export interface CustomRole { id: string; name: string; permissions: Assignment[] }
export interface LocalPerson { id: string; displayName: string; employeeCode: string; active: boolean; hasDirectReports?:boolean; entraObjectId?:string; roleIds: string[]; overrides: Assignment[] }
export interface LocalAccessState { revision: number; roles: CustomRole[]; people: LocalPerson[]; audit: { actorId: string; action: string; targetId: string; at: string; revision: number; before?: CustomRole | LocalPerson; after?: CustomRole | LocalPerson }[] }
export { AccessError } from '../../shared/errors.js';
export interface AccessStore {
  readonly storage?: 'azure-sql' | 'local-file';
  snapshot(): LocalAccessState | Promise<LocalAccessState>;
  person(id: string): LocalPerson | undefined | Promise<LocalPerson | undefined>;
  save(actorId: string,input: unknown): Promise<LocalAccessState>;
}
const accountId = 'local-demo-workspace';
const codes = new Set<string>(permissionCatalogue.map(item => item[0]));
const bootstrapId = '00000000-0000-4000-8000-000000000001';
function bootstrap(): LocalAccessState {
  const roleId = randomUUID();
  return { revision: 1, roles: [{ id: roleId, name: 'Super Admin', permissions: [
    { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
    ...(['permissions.manage','users.manage','users.view','audit.view'] as const).map(permission => ({ permission, scope: 'ORGANIZATION' as const, effect: 'ALLOW' as const })),
  ] }], people: [{ id: bootstrapId, displayName: 'Development Super Admin', employeeCode: 'DEV-ADMIN', active: true, roleIds: [roleId], overrides: [] }], audit: [] };
}
export function grantsFor(state: LocalAccessState, person: LocalPerson): Grant[] {
  const wrap = (items: Assignment[], source: Grant['source']): Grant[] => items.map(item => ({ accountId, userId: person.id, permission: item.permission, effect: item.effect, source, scope: { kind: item.scope }, validFrom: '2020-01-01T00:00:00Z', validUntil: item.validUntil }));
  return [...state.roles.filter(role => person.roleIds.includes(role.id)).flatMap(role => wrap(role.permissions, 'ROLE')), ...wrap(person.overrides, 'USER')];
}
export function can(state: LocalAccessState, person: LocalPerson, permission: string, own = false) {
  return authorize({ id: person.id, accountId, active: person.active }, permission,
    { id: own ? person.id : accountId, type: own ? 'profile' : 'workspace', accountId, ownerUserId: own ? person.id : undefined }, grantsFor(state, person), new Date()).allowed;
}
// Capability discovery only. Claim assignment, ownership and reporting scope are
// enforced again by the review procedures before any records are exposed or changed.
export function canReviewAssigned(state:LocalAccessState,person:LocalPerson){
  if(!person.active||person.hasDirectReports===false)return false;
  const now=Date.now(),grants=grantsFor(state,person).filter(grant=>grant.permission==='skill.verify'&&grant.scope.kind==='ORGANIZATION'&&(!grant.validUntil||now<Date.parse(grant.validUntil)));
  return (person.hasDirectReports===true||grants.some(grant=>grant.effect==='ALLOW'))&&!grants.some(grant=>grant.effect==='DENY');
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AccessError(400,'A required text field is invalid.');
  return value.trim();
}
function assignments(value: unknown): Assignment[] {
  if (!Array.isArray(value) || value.length > 100) throw new AccessError(400,'Invalid permission assignments.');
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || !codes.has(item.permission) || !['OWN','ORGANIZATION'].includes(item.scope) || !['ALLOW','DENY'].includes(item.effect)) throw new AccessError(400,'Unknown permission, scope or effect.');
    const key = `${item.permission}:${item.scope}`;
    if (seen.has(key)) throw new AccessError(400,'Duplicate permission scope.'); seen.add(key);
    if (item.validUntil !== undefined && (typeof item.validUntil !== 'string' || !Number.isFinite(Date.parse(item.validUntil)))) throw new AccessError(400,'Invalid permission expiry.');
    return { permission: item.permission, scope: item.scope, effect: item.effect, ...(item.validUntil ? {validUntil:item.validUntil} : {}) };
  });
}
export class LocalAccessStore {
  private state: LocalAccessState;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private path: string | undefined, state: LocalAccessState) { this.state = state; }
  static fromState(state: LocalAccessState) { return new LocalAccessStore(undefined,structuredClone(state)); }
  static async open(path?: string) {
    let state = bootstrap();
    if (path) {
      try {
        state = JSON.parse(await readFile(path, 'utf8'));
        if (!Number.isInteger(state.revision) || !Array.isArray(state.roles) || !Array.isArray(state.people) || !Array.isArray(state.audit)) throw new Error('Invalid local access file.');
        for (const role of state.roles) { text(role.name,100); assignments(role.permissions); }
        for (const person of state.people) { text(person.displayName,100); text(person.employeeCode,40); assignments(person.overrides); if (!Array.isArray(person.roleIds) || person.roleIds.some(id => !state.roles.some(role => role.id === id))) throw new Error('Invalid local role references.'); }
      } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw new Error('Local access configuration could not be loaded.'); }
    }
    const store = new LocalAccessStore(path,state); if (path) await store.persist(state); return store;
  }
  private async persist(state: LocalAccessState) {
    if (!this.path) return;
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(state,null,2), { encoding:'utf8', mode:0o600 }); await rename(temporary,this.path); }
    finally { await rm(temporary,{force:true}); }
  }
  snapshot() { return structuredClone(this.state); }
  person(id: string) { return this.snapshot().people.find(person => person.id === id && person.active); }
  async save(actorId: string, input: unknown) {
    const operation = async () => {
      const state = this.snapshot(); const actor = state.people.find(person => person.id === actorId);
      if (!actor || !can(state,actor,'permissions.manage')) throw new AccessError(403,'Permission administration is not allowed.');
      if (!input || typeof input !== 'object') throw new AccessError(400,'Invalid change.');
      const body = input as Record<string,unknown>;
      if (body.revision !== state.revision) throw new AccessError(409,'Configuration changed. Reload and try again.');
      const id = body.id === undefined ? randomUUID() : text(body.id,100);
      const before = body.kind === 'role' ? state.roles.find(role => role.id === id) : state.people.find(person => person.id === id);
      if (body.kind === 'role') {
        const previous = state.roles.find(role => role.id === id);
        if (body.id !== undefined && !previous) throw new AccessError(404,'Role not found.');
        const role: CustomRole = { id, name: text(body.name,100), permissions: assignments(body.permissions) };
        if (state.roles.some(item => item.id !== id && item.name.toLowerCase() === role.name.toLowerCase())) throw new AccessError(400,'Role name already exists.');
        if (!previous && state.roles.length >= 100) throw new AccessError(400,'Local role limit reached.');
        state.roles = [...state.roles.filter(role => role.id !== id),role];
      } else if (body.kind === 'person') {
        if (!can(state,actor,'users.manage')) throw new AccessError(403,'User administration is not allowed.');
        const previous = state.people.find(person => person.id === id);
        if (body.id !== undefined && !previous) throw new AccessError(404,'Person not found.');
        if (typeof body.active !== 'boolean' || !Array.isArray(body.roleIds) || body.roleIds.length > 100 || body.roleIds.some(roleId => typeof roleId !== 'string' || !state.roles.some(role => role.id === roleId))) throw new AccessError(400,'Invalid status or roles.');
        const person: LocalPerson = { id, displayName:text(body.displayName,100), employeeCode:text(body.employeeCode,40), active:body.active, ...(previous?.entraObjectId?{entraObjectId:previous.entraObjectId}:{}), roleIds:[...new Set(body.roleIds as string[])], overrides:assignments(body.overrides) };
        if (state.people.some(item => item.id !== id && item.employeeCode.toLowerCase() === person.employeeCode.toLowerCase())) throw new AccessError(400,'Person ID already exists.');
        if (!previous && state.people.length >= 200) throw new AccessError(400,'Local people limit reached.');
        state.people = [...state.people.filter(person => person.id !== id),person];
      } else throw new AccessError(400,'Unknown change type.');
      if (!state.people.some(person => can(state,person,'permissions.manage') && can(state,person,'users.manage'))) throw new AccessError(400,'Keep at least one active access administrator.');
      const after = body.kind === 'role' ? state.roles.find(role => role.id === id) : state.people.find(person => person.id === id);
      state.revision++; state.audit.push({ actorId, action: `${body.kind}.${body.id ? 'updated' : 'created'}`, targetId:id, at:new Date().toISOString(), revision:state.revision, ...(before ? {before} : {}), ...(after ? {after} : {}) });
      await this.persist(state); this.state = state; return this.snapshot();
    };
    const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result;
  }
}
