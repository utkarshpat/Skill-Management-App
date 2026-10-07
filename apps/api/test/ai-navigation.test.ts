import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { rolePresets } from '../src/modules/access/role-presets.js';
test('learning creation discovery is actor-bound and requires effective manage plus view access', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  access.snapshot = () => structuredClone(state);
  const service = new AssistantService(access, undefined, undefined);
  const allowed = await service.navigation(actor);
  assert.ok('canManageLearning' in allowed);
  assert.equal(allowed.actorId, actor);
  assert.equal(allowed.canManageLearning, true);
  state.people[0].overrides.push({ permission: 'learning.manage', scope: 'OWN', effect: 'DENY' });
  const viewOnly = await service.navigation(actor);
  assert.ok('canManageLearning' in viewOnly);
  assert.equal(viewOnly.canManageLearning, false);
  assert.ok(viewOnly.pages?.some(page => page.url === '/learning'));
  state.people[0].overrides = [];
  state.people[0].overrides.push({ permission: 'learning.view', scope: 'OWN', effect: 'DENY' });
  const hidden = await service.navigation(actor);
  assert.ok('canManageLearning' in hidden);
  assert.equal(hidden.canManageLearning, false);
});
test('assistant navigation follows current permissions and forbids actor selectors, altered URLs and revoked actions', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  state.roles[0].name = 'Super Admin';
  access.snapshot = () => structuredClone(state);
  const service = new AssistantService(access, undefined, undefined);
  const available = await service.navigation(actor);
  assert.ok('pages' in available);
  assert.ok('status' in available);
  assert.equal(available.status?.configured, false);
  assert.ok(available.pages?.some(page => page.url === '/my-skills'));
  assert.ok(!available.pages?.some(page => page.url.startsWith('/access')));
  await service.navigation(actor, { destination: '/my-skills', action: 'review_own_skill' });
  for (const destination of [
    '/access?view=people',
    '/my-skills?personId=other',
    'https://evil.invalid',
    '/my-skills#other',
  ])
    await assert.rejects(service.navigation(actor, { destination, action: 'open_page' }));
  await assert.rejects(
    service.navigation(actor, { destination: '/my-skills', action: 'open_page', actorId: 'other' }),
  );
  state.people[0].overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
  await assert.rejects(
    service.navigation(actor, { destination: '/my-skills', action: 'review_own_skill' }),
    /permissions/,
  );
  await service.navigation(actor, { destination: '/my-skills', action: 'open_page' });
  state.people[0].overrides.push({ permission: 'skill.view', scope: 'OWN', effect: 'DENY' });
  await assert.rejects(
    service.navigation(actor, { destination: '/my-skills', action: 'open_page' }),
    /permissions/,
  );
  state.people[0].active = false;
  await assert.rejects(service.navigation(actor), /not assigned/);
});

test('navigation HTTP binds verified identity and rechecks permissions at the explicit click boundary', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  access.snapshot = () => structuredClone(state);
  const service = new AssistantService(access, undefined, undefined);
  const server = createApp({
    verify: async header => {
      if (header !== 'Bearer test') throw Error();
      return { tenantId: 'test', objectId: 'test' };
    },
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access,
    assistant: service,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/assistant/navigation`;
  const headers = { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    post = (body: object) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers })).status, 200);
    const opened = await post({ destination: '/my-skills', action: 'open_page' });
    assert.equal(opened.status, 200);
    assert.equal((await opened.json()).destination, '/my-skills');
    assert.equal(
      (await post({ destination: '/my-skills', action: 'open_page', actorId: 'foreign' })).status,
      400,
    );
    assert.equal(
      (await post({ destination: '/access?view=people', action: 'open_page' })).status,
      403,
    );
    state.people[0].overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
    assert.equal(
      (await post({ destination: '/my-skills', action: 'review_own_skill' })).status,
      403,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
