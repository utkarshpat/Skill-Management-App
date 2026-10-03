import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore, type LocalAccessState } from '../src/modules/access/local-access-store.js';
import { workspaceFor } from '../src/modules/identity/workspace.js';
import { rolePresets } from '../src/modules/access/role-presets.js';

test('workspace capabilities use permissions, never role names; every preset gets only supported workflows', () => {
  for (const preset of rolePresets) {
    const state: LocalAccessState = { revision: 1, audit: [], roles: [{ id: 'role', name: preset.name, permissions: structuredClone(preset.permissions) }], people: [{ id: 'person', displayName: 'A person', employeeCode: 'EMP', active: true, roleIds: ['role'], overrides: [] }] };
    const workspace = workspaceFor(state, state.people[0]);
    assert.equal(workspace.capabilities.ownSkills, true, preset.name);
    assert.equal(workspace.capabilities.claimSkills, true, preset.name);
    assert.equal(workspace.capabilities.administration, false, preset.name);
    assert.ok(workspace.upcoming.some(item => item.id === 'learning' && !item.implemented));
    // Proposed TEAM/DEPARTMENT/CAPABILITY scopes must never become org-wide grants.
    assert.ok(!workspace.upcoming.some(item => item.id === 'assessment'));
    state.roles[0].name = 'Super Admin';
    assert.equal(workspaceFor(state, state.people[0]).capabilities.administration, false);
    state.people[0].overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
    assert.equal(workspaceFor(state, state.people[0]).capabilities.claimSkills, false);
    state.roles[0].permissions.forEach(grant => { grant.validUntil = '2020-01-01T00:00:00Z'; });
    assert.equal(workspaceFor(state, state.people[0]).capabilities.ownSkills, false);
  }
});

test('admin does not receive personal skill authority; explicit self-service assignment enables it', async () => {
  const store = await LocalAccessStore.open(), state = store.snapshot(), person = state.people[0];
  assert.equal(workspaceFor(state, person).capabilities.administration, true);
  assert.equal(workspaceFor(state, person).capabilities.ownSkills, false);
  person.overrides.push({ permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' }, { permission: 'skill.claim', scope: 'OWN', effect: 'ALLOW' });
  assert.equal(workspaceFor(state, person).capabilities.claimSkills, true);
  person.overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
  assert.equal(workspaceFor(state, person).capabilities.ownSkills, false);
});

test('workspace HTTP binds verified identity, ignores forged person/role and rechecks deactivation', async () => {
  const store = await LocalAccessStore.open(), state = store.snapshot();
  const actor = state.people[0].id;
  state.people.push({ id: 'other', displayName: 'Hidden other person', employeeCode: 'PRIVATE', active: true, roleIds: [], overrides: [] });
  store.snapshot = () => structuredClone(state);
  const server = createApp({ verify: async header => { if (header !== 'Bearer human') throw new Error(); return { tenantId: 'trusted', objectId: 'human' }; }, resolveAccess: async identity => { assert.equal(identity.objectId, 'human'); return actor; }, profile: async () => undefined, access: store }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/workspace?personId=other&role=CHRO`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: 'Bearer human' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json(); assert.equal(result.person.id, actor);
    assert.doesNotMatch(JSON.stringify(result), /Hidden other person|PRIVATE|entraObjectId|overrides/);
    state.people[0].active = false;
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer human' } })).status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('development workspace respects the selected person and revocation; linked owner cannot use direct login', async () => {
  const store = await LocalAccessStore.open(), state = store.snapshot();
  state.people[0].entraObjectId = 'linked-owner';
  state.roles.push({ id: 'employee', name: 'Editable employee set', permissions: structuredClone(rolePresets[0].permissions) });
  state.people.push({ id: 'person', displayName: 'Selected person', employeeCode: 'DEV', active: true, roleIds: ['employee'], overrides: [] });
  store.snapshot = () => structuredClone(state); store.person = id => structuredClone(state.people.find(person => person.id === id && person.active));
  const server = createApp(undefined, { developmentStore: store }).listen(0, '127.0.0.1');
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const login = (personId: string) => fetch(base + '/api/dev-login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ personId }) });
  try {
    const people = await (await fetch(base + '/api/dev-login')).json();
    assert.deepEqual(people.people.map((person: { roles: string[] }) => person.roles), [['Editable employee set']]);
    assert.equal((await login(state.people[0].id)).status, 400);
    const response = await login('person'), cookie = response.headers.get('set-cookie')!.split(';')[0];
    const result = await (await fetch(base + '/api/workspace', { headers: { Cookie: cookie } })).json();
    assert.equal(result.person.id, 'person'); assert.equal(result.authentication, 'local-demo'); assert.equal(result.capabilities.claimSkills, true);
    state.people[1].overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
    assert.equal((await (await fetch(base + '/api/workspace', { headers: { Cookie: cookie } })).json()).capabilities.claimSkills, false);
    state.people[1].active = false;
    assert.equal((await fetch(base + '/api/workspace', { headers: { Cookie: cookie } })).status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
