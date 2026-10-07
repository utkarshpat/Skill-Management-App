import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore, can } from '../src/modules/access/local-access-store.js';
import { developmentLoginEnabled } from '../src/modules/identity/development-login.js';

test('direct login is opt-in and refuses every non-development environment', () => {
  assert.equal(developmentLoginEnabled({ NODE_ENV: 'development' }), false);
  assert.equal(
    developmentLoginEnabled({ NODE_ENV: 'production', DEV_DIRECT_LOGIN: 'false' }),
    false,
  );
  assert.equal(
    developmentLoginEnabled({ NODE_ENV: 'development', DEV_DIRECT_LOGIN: 'true' }),
    true,
  );
  for (const NODE_ENV of ['production', 'test', undefined])
    assert.throws(() => developmentLoginEnabled({ NODE_ENV, DEV_DIRECT_LOGIN: 'true' }));
});

test('custom roles, individual overrides, expiry, revision conflicts and administrator retention', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skill-access-'));
  try {
    const path = join(directory, 'access.json');
    const store = await LocalAccessStore.open(path);
    const admin = store.snapshot().people[0];
    let state = await store.save(admin.id, {
      revision: 1,
      kind: 'role',
      name: 'Any company-defined name',
      permissions: [{ permission: 'profile.view', effect: 'ALLOW', scope: 'OWN' }],
    });
    const role = state.roles.find(role => role.name === 'Any company-defined name')!;
    state = await store.save(admin.id, {
      revision: state.revision,
      kind: 'person',
      displayName: 'Test Person',
      employeeCode: 'TEST-01',
      active: true,
      roleIds: [role.id],
      overrides: [],
    });
    const user = state.people.find(person => person.employeeCode === 'TEST-01')!;
    assert.ok(can(state, user, 'profile.view', true));
    assert.equal(can(state, user, 'permissions.manage'), false);
    await assert.rejects(
      store.save(user.id, {
        revision: state.revision,
        kind: 'role',
        name: 'Escalation',
        permissions: [],
      }),
      error => (error as { status: number }).status === 403,
    );
    await assert.rejects(
      store.save(admin.id, { revision: 1, kind: 'role', name: 'Stale', permissions: [] }),
      error => (error as { status: number }).status === 409,
    );
    state = await store.save(admin.id, {
      ...user,
      revision: state.revision,
      kind: 'person',
      overrides: [
        {
          permission: 'profile.view',
          effect: 'DENY',
          scope: 'OWN',
          reason: 'Temporary test block',
          validUntil: '2099-01-01T00:00:00Z',
        },
      ],
    });
    assert.equal(
      can(
        state,
        state.people.find(person => person.id === user.id)!,
        'profile.view',
        true,
      ),
      false,
    );
    const historical = structuredClone(state);
    historical.people.find(person => person.id === user.id)!.overrides[0].validUntil =
      '2021-01-01T00:00:00Z';
    assert.ok(
      can(
        historical,
        historical.people.find(person => person.id === user.id)!,
        'profile.view',
        true,
      ),
    );
    state = await store.save(admin.id, {
      ...user,
      revision: state.revision,
      kind: 'person',
      overrides: [],
    });
    state = await store.save(admin.id, {
      ...user,
      revision: state.revision,
      kind: 'person',
      active: false,
    });
    assert.equal(store.person(user.id), undefined);
    const adminRole = state.roles.find(role => admin.roleIds.includes(role.id))!;
    state = await store.save(admin.id, {
      ...adminRole,
      revision: state.revision,
      kind: 'role',
      name: 'Renamed without losing permissions',
    });
    assert.ok(can(state, admin, 'permissions.manage'));
    await assert.rejects(
      store.save(admin.id, {
        ...adminRole,
        revision: state.revision,
        kind: 'role',
        permissions: [],
      }),
      /at least one active/,
    );
    await assert.rejects(
      store.save(admin.id, {
        revision: state.revision,
        kind: 'role',
        name: 'Bad permission',
        permissions: [{ permission: 'unknown', scope: 'OWN', effect: 'ALLOW' }],
      }),
      /Unknown permission/,
    );
    const reloaded = await LocalAccessStore.open(path);
    assert.deepEqual(reloaded.snapshot(), store.snapshot());
    assert.equal(state.audit.length, 6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('local direct sessions enforce origin, opaque identity, live revocation and administration permission', async () => {
  const store = await LocalAccessStore.open();
  const admin = store.snapshot().people[0];
  let state = await store.save(admin.id, {
    revision: 1,
    kind: 'person',
    displayName: 'Ordinary test user',
    employeeCode: 'TEST',
    active: true,
    roleIds: [],
    overrides: [
      {
        permission: 'profile.view',
        scope: 'OWN',
        effect: 'ALLOW',
        reason: 'Temporary test access',
        validUntil: '2099-01-01T00:00:00Z',
      },
    ],
  });
  const person = state.people.find(person => person.employeeCode === 'TEST')!;
  const server = createApp(undefined, { developmentStore: store }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const login = (id: string, origin = base) =>
    fetch(base + '/api/dev-login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: id, role: 'SUPER_ADMIN' }),
    });
  try {
    assert.equal((await login(admin.id, 'https://evil.example')).status, 403);
    assert.equal((await login('unknown')).status, 400);
    const response = await login(person.id);
    assert.equal(response.status, 200);
    const header = response.headers.get('set-cookie')!;
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    const cookie = header.split(';')[0];
    const headers = { Cookie: cookie };
    const me = await fetch(base + '/api/me?role=SUPER_ADMIN', { headers });
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).profile.roles, []);
    assert.equal((await fetch(base + '/api/dev-access', { headers })).status, 403);
    state = await store.save(admin.id, {
      ...person,
      revision: state.revision,
      kind: 'person',
      overrides: [],
    });
    assert.equal((await fetch(base + '/api/me', { headers })).status, 403);
    const logout = await fetch(base + '/api/dev-login', {
      method: 'DELETE',
      headers: { ...headers, Origin: base },
    });
    assert.equal(logout.status, 204);
    assert.equal((await fetch(base + '/api/me', { headers })).status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('disabled direct login and access management endpoints are absent', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    for (const path of ['/api/dev-login', '/api/dev-access'])
      assert.equal((await fetch(`http://127.0.0.1:${address.port}${path}`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
