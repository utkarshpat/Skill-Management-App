import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import type { LocalAccessState, Assignment } from '../src/modules/access/local-access-store.js';
import type { CertificationRecommendationStore } from '../src/modules/skills/certification-recommendations.js';
const manager = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employee = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('credential recommendation HTTP checks active manager relationships, bounded filters and post-read revocation', async t => {
  const permissions: Assignment[] = [
    { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'learning.manage', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'learning.recommend', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
  ];
  const state: LocalAccessState = {
    revision: 4,
    audit: [],
    roles: [{ id, name: 'Delivery Workspace', permissions }],
    people: [
      {
        id: manager,
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
    reporting: [{ personId: employee, managerId: manager }],
  };
  let effect = () => {},
    backendEnabled = true;
  const calls: string[] = [];
  const backend: CertificationRecommendationStore = {
    read: async (actor, view, page, search, record) => {
      assert.equal(actor, manager);
      calls.push('read');
      effect();
      return { items: [{ id, personId: employee }], total: 1, page, pageSize: 20 };
    },
    people: async actor => {
      assert.equal(actor, manager);
      calls.push('people');
      effect();
      return { people: [{ id: employee, name: 'Aditi Menon' }] };
    },
    analytics: async () => {
      calls.push('analytics');
      effect();
      return { pending: 1, categories: [] };
    },
    send: async (actor, input) => {
      assert.equal(actor, manager);
      assert.equal(input.personId, employee);
      calls.push('send');
      return { saved: true, id };
    },
    respond: async actor => {
      assert.equal(actor, manager);
      calls.push('respond');
      return { saved: true };
    },
    notifications: async () => [],
  };
  const deps = {
    verify: async (h: string | undefined) => {
      if (h !== 'Bearer manager') throw Error();
      return { tenantId: id, objectId: manager };
    },
    resolveAccess: async () => manager,
    profile: async () => undefined,
    access: {
      snapshot: () => structuredClone(state),
      person: (who: string) => state.people.find(p => p.id === who),
      save: async () => state,
    },
    get certificationRecommendations() {
      return backendEnabled ? backend : undefined;
    },
  };
  const server = createApp(deps).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = `http://127.0.0.1:${address.port}/api/certification-recommendations`,
    headers = { Authorization: 'Bearer manager', 'Content-Type': 'application/json' },
    get = (path = '') => fetch(root + path, { headers }),
    post = (path: string, body: unknown) =>
      fetch(root + path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(root)).status, 401);
  for (const path of [
    '',
    '?view=sent&page=2&search=Oracle&id=' + id,
    '/people?search=Aditi',
    '/analytics',
  ])
    assert.equal((await get(path)).status, 200, path);
  for (const query of [
    '?view=foreign',
    '?view[]=sent',
    '?page=0',
    '?page=1001',
    '?page=1.5',
    '?page=NaN',
    '?search[]=' + employee,
    '?search=' + 'x'.repeat(101),
    '?id=invalid',
    '?id[]=' + id,
    '?actorId=' + employee,
    '/people?personId=' + employee,
    '/people?search=' + 'x'.repeat(101),
    '/people?search[]=Aditi',
    '/analytics?page=1',
  ])
    assert.equal((await get(query)).status, 400, query);
  const send = {
    id,
    personId: employee,
    certificationName: 'Oracle SQL',
    provider: 'Oracle',
    category: 'Databases',
    reason: 'Supports customer reporting delivery',
    credentialUrl: 'https://education.oracle.com/',
  };
  assert.equal((await post('/send', send)).status, 200);
  assert.equal((await post('/send', { ...send, actorId: employee })).status, 400);
  assert.equal((await post('/send', { ...send, personId: manager })).status, 403);
  state.reporting = [];
  assert.equal((await post('/send', send)).status, 403);
  state.reporting = [{ personId: employee, managerId: manager }];
  assert.equal(
    (
      await post('/respond', {
        id,
        revision: 1,
        action: 'DISCUSS',
        message: 'Please confirm the workshop schedule.',
      })
    ).status,
    200,
  );
  assert.equal((await post('/respond', { id, revision: 0, action: 'ACCEPT' })).status, 400);
  for (const permission of ['learning.manage', 'learning.view'] as const) {
    state.people[0].overrides = [{ permission, scope: 'OWN', effect: 'DENY' }];
    assert.equal((await post('/respond', { id, revision: 1, action: 'ACCEPT' })).status, 403);
  }
  state.people[0].overrides = [];
  state.people[0].overrides = [
    { permission: 'learning.recommend', scope: 'ORGANIZATION', effect: 'DENY' },
  ];
  assert.equal((await get('?view=sent')).status, 403);
  assert.equal((await get('/people')).status, 403);
  state.people[0].overrides = [];
  state.people[0].overrides = [
    { permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'DENY' },
  ];
  assert.equal((await get('/analytics')).status, 403);
  state.people[0].overrides = [];
  effect = () => {
    state.revision++;
  };
  assert.equal((await get()).status, 409);
  effect = () => {
    state.people[0].active = false;
  };
  assert.equal((await get()).status, 403);
  state.people[0].active = true;
  effect = () => {
    state.people[0].overrides.push({ permission: 'learning.view', scope: 'OWN', effect: 'DENY' });
  };
  assert.equal((await get()).status, 403);
  state.people[0].overrides = [];
  for (const [path, permission] of [
    ['/analytics', 'skill.verify'],
    ['/people', 'learning.recommend'],
    ['?view=sent', 'learning.recommend'],
  ] as const) {
    effect = () => {
      state.people[0].overrides.push({ permission, scope: 'ORGANIZATION', effect: 'DENY' });
    };
    assert.equal((await get(path)).status, 403);
    state.people[0].overrides = [];
  }
  effect = () => {};
  backendEnabled = false;
  assert.equal((await get()).status, 503);
  backendEnabled = true;
  state.people[0].active = false;
  assert.equal((await get()).status, 403);
  assert.ok(calls.includes('send') && calls.includes('respond') && calls.includes('analytics'));
});
