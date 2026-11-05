import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { rolePresets } from '../src/modules/access/role-presets.js';
import type { AccessStore, LocalAccessState } from '../src/modules/access/index.js';

test('local fixture sessions cannot perform cross-origin workflow writes or survive deactivation', async t => {
  const manager = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    employee = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const state: LocalAccessState = {
    revision: 1,
    audit: [],
    roles: [
      {
        id: 'delivery-support',
        name: 'Explicit development fixture grants',
        permissions: rolePresets.flatMap(role => role.permissions),
      },
    ],
    people: [
      {
        id: manager,
        displayName: 'Rohan Mehta',
        employeeCode: 'EMP-1007',
        active: true,
        roleIds: ['delivery-support'],
        overrides: [],
      },
      {
        id: employee,
        displayName: 'Aditi Menon',
        employeeCode: 'EMP-1042',
        active: true,
        roleIds: ['delivery-support'],
        overrides: [],
      },
    ],
    reporting: [{ personId: employee, managerId: manager }],
  };
  const store: AccessStore = {
    snapshot: () => structuredClone(state),
    person: who => structuredClone(state.people.find(p => p.id === who && p.active)),
    save: async () => {
      throw Error('No development fixture writes are permitted by this test');
    },
  };
  // The production composition root never supplies this store. Here it enables
  // an isolated in-memory session so the legacy CSRF defenses stay exercised.
  const server = createApp(undefined, { developmentStore: store }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(base + '/api/dev-login', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ personId: manager }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const reads = [
    '/api/my-skills',
    '/api/skill-reviews',
    '/api/learning',
    '/api/certifications',
    '/api/recommendations',
    '/api/certification-recommendations',
    '/api/workflows',
    '/api/business/context',
  ];
  for (const path of reads) {
    const result = await fetch(base + path, { headers: { Cookie: cookie } });
    assert.equal(result.status, 503, path);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + path)).status, 401, path);
  }
  const writes = [
    '/api/my-skills',
    '/api/skill-reviews/decision',
    '/api/learning',
    '/api/certifications',
    '/api/recommendations',
    '/api/certification-recommendations/send',
    '/api/workflows',
    '/api/business/administration',
    '/api/dev-access/preview',
  ];
  for (const path of writes) {
    for (const origin of [undefined, 'https://outside.invalid']) {
      const headers: Record<string, string> = {
        Cookie: cookie,
        'Content-Type': 'application/json',
      };
      if (origin) headers.Origin = origin;
      assert.equal(
        (await fetch(base + path, { method: 'POST', headers, body: '{}' })).status,
        403,
        path + ' ' + origin,
      );
    }
  }
  const dashboard = await fetch(base + '/api/dashboard', { headers: { Cookie: cookie } });
  assert.equal(dashboard.status, 200);
  const manifest = (await dashboard.json()) as { cards: unknown[] };
  assert.deepEqual(
    manifest.cards,
    [],
    'A session and role labels do not fabricate missing data sources.',
  );
  assert.equal(
    (await fetch(base + '/api/dashboard/foreign', { headers: { Cookie: cookie } })).status,
    404,
  );
  state.people[0].active = false;
  for (const path of [...reads, '/api/dashboard'])
    assert.equal((await fetch(base + path, { headers: { Cookie: cookie } })).status, 403, path);
});
