import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { AccessError } from '../src/shared/errors.js';
import type { LocalAccessState, Assignment } from '../src/modules/access/local-access-store.js';
import type { RecommendationStore } from '../src/modules/recommendations/recommendations.js';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employee = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('learning recommendations bind current direct reports, own learning response and post-read revision', async t => {
  const permissions: Assignment[] = [
    ...(['profile.view', 'learning.view', 'learning.manage'] as const).map(permission => ({
      permission,
      scope: 'OWN' as const,
      effect: 'ALLOW' as const,
    })),
    { permission: 'learning.recommend', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
  ];
  const state: LocalAccessState = {
    revision: 1,
    audit: [],
    roles: [{ id, name: 'Delivery learning support', permissions }],
    people: [
      {
        id: actor,
        displayName: 'Rohan Mehta',
        employeeCode: 'EMP-1007',
        active: true,
        roleIds: [id],
        overrides: [],
      },
      {
        id: employee,
        displayName: 'Aditi Menon',
        employeeCode: 'EMP-1042',
        active: true,
        roleIds: [id],
        overrides: [],
      },
    ],
    reporting: [{ personId: employee, managerId: actor }],
  };
  let effect = () => {},
    enabled = true,
    failure: AccessError | undefined;
  const writes: unknown[] = [];
  const read = () => {
    if (failure) throw failure;
    effect();
    return { items: [], total: 0 };
  };
  const backend: RecommendationStore = {
    read: async who => {
      assert.equal(who, actor);
      return read();
    },
    options: async who => {
      assert.equal(who, actor);
      return read();
    },
    send: async (who, input) => {
      assert.equal(who, actor);
      writes.push(input);
      return { saved: true };
    },
    respond: async (who, input) => {
      assert.equal(who, actor);
      writes.push(input);
      return { saved: true };
    },
    notifications: async () => [],
  };
  const server = createApp({
    verify: async h => {
      if (h !== 'Bearer reviewer') throw Error();
      return { tenantId: id, objectId: actor };
    },
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access: {
      snapshot: () => structuredClone(state),
      person: who => state.people.find(p => p.id === who),
      save: async () => state,
    },
    get recommendations() {
      return enabled ? backend : undefined;
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = `http://127.0.0.1:${address.port}/api/recommendations`,
    headers = { Authorization: 'Bearer reviewer', 'Content-Type': 'application/json' },
    get = (q = '') => fetch(root + q, { headers }),
    post = (q: string, body: unknown) =>
      fetch(root + q, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(root)).status, 401);
  for (const q of ['', '?view=sent&page=2&id=' + id, '/people?search=Aditi'])
    assert.equal((await get(q)).status, 200, q);
  for (const q of [
    '?view=foreign',
    '?view[]=sent',
    '?page=0',
    '?page=1001',
    '?page=1.5',
    '?id=invalid',
    '?id[]=' + id,
    '?personId=' + employee,
    '/people?personId=' + employee,
    '/people?search[]=' + employee,
    '/people?search=' + 'x'.repeat(101),
  ])
    assert.equal((await get(q)).status, 400, q);
  const send = {
    id,
    personId: employee,
    skillId: id,
    rank: 2,
    reason: 'Customer SQL reporting delivery',
    resource: 'https://learn.microsoft.com/training/',
  };
  assert.equal((await post('', send)).status, 200);
  assert.equal((await post('', { ...send, actorId: employee })).status, 400);
  assert.equal((await post('', { ...send, personId: actor })).status, 403);
  state.reporting = [];
  assert.equal((await post('', send)).status, 403);
  state.reporting = [{ personId: employee, managerId: actor }];
  state.people[1].overrides = [{ permission: 'learning.view', scope: 'OWN', effect: 'DENY' }];
  assert.equal((await post('', send)).status, 403);
  state.people[1].overrides = [];
  for (const action of ['DECLINE', 'DISCUSS'])
    assert.equal(
      (
        await post('/respond', {
          id,
          revision: 1,
          action,
          message: 'Please confirm the delivery schedule',
        })
      ).status,
      200,
    );
  assert.equal((await post('/respond', { id, revision: 0, action: 'DECLINE' })).status, 400);
  assert.equal((await post('/respond', { id, revision: 1, action: 'ACCEPT' })).status, 400);
  for (const permission of ['learning.view', 'learning.manage'] as const) {
    state.people[0].overrides = [{ permission, scope: 'OWN', effect: 'DENY' }];
    assert.equal((await post('/respond', { id, revision: 1, action: 'DECLINE' })).status, 403);
  }
  state.people[0].overrides = [];
  state.people[0].overrides = [{ permission: 'learning.view', scope: 'OWN', effect: 'DENY' }];
  assert.equal((await get()).status, 403);
  state.people[0].overrides = [
    { permission: 'learning.recommend', scope: 'ORGANIZATION', effect: 'DENY' },
  ];
  assert.equal((await get('?view=sent')).status, 403);
  assert.equal((await get('/people')).status, 403);
  assert.equal((await post('', send)).status, 403);
  state.people[0].overrides = [];
  for (const q of ['', '/people']) {
    effect = () => {
      state.revision++;
    };
    assert.equal((await get(q)).status, 409, q);
  }
  effect = () => {
    state.people[0].active = false;
  };
  assert.equal((await get()).status, 403);
  state.people[0].active = true;
  effect = () => {};
  failure = new AccessError(503, 'Learning store unavailable');
  assert.equal((await get()).status, 503);
  failure = undefined;
  enabled = false;
  assert.equal((await get()).status, 503);
  enabled = true;
  state.people[0].active = false;
  assert.equal((await get()).status, 403);
  assert.equal(writes.length, 3);
});
