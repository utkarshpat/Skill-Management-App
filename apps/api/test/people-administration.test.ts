import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import {
  directoryQuery,
  readDirectory,
  readPersonAdministration,
} from '../src/modules/access/administration.js';
import {
  type AccessStore,
  type LocalAccessState,
} from '../src/modules/access/local-access-store.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
const actor = '10000000-0000-4000-8000-000000000001',
  employee = '10000000-0000-4000-8000-000000000002',
  role = '10000000-0000-4000-8000-000000000003';
function state(): LocalAccessState {
  return {
    revision: 4,
    roles: [
      {
        id: role,
        name: 'Access administration',
        permissions: [
          { permission: 'permissions.manage', scope: 'ORGANIZATION', effect: 'ALLOW' },
          { permission: 'users.manage', scope: 'ORGANIZATION', effect: 'ALLOW' },
          { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
        ],
      },
    ],
    people: [
      {
        id: actor,
        displayName: 'Neha Rao',
        employeeCode: '710901',
        active: true,
        roleIds: [role],
        overrides: [],
      },
      {
        id: employee,
        displayName: 'Aditi Menon',
        employeeCode: '710902',
        active: false,
        roleIds: [],
        overrides: [],
      },
    ],
    audit: [],
  };
}
test('directory inputs are bounded and reject forged authority, repeated values and incomplete hierarchy filters', () => {
  assert.deepEqual(directoryQuery({ kind: 'people', search: ' Aditi ', page: '2' }), {
    kind: 'people',
    search: 'Aditi',
    page: 2,
  });
  assert.equal(
    directoryQuery({ kind: 'nodes', nodeKind: 'PORTFOLIO', parentId: employee }).parentId,
    employee,
  );
  for (const query of [
    { kind: 'people', actorId: actor },
    { kind: 'people', search: [] },
    { kind: 'people', search: 'a'.repeat(101) },
    { kind: 'people', page: '0' },
    { kind: 'people', page: '1e2' },
    { kind: 'people', page: ['2'] },
    { kind: 'nodes', nodeKind: 'PORTFOLIO' },
    { kind: 'nodes', nodeKind: 'TEAM', parentId: 'forged' },
    { kind: 'nodes', nodeKind: 'DELIVERY_UNIT', parentId: actor },
    { kind: 'templates', nodeKind: 'TEAM' },
    { kind: 'roles' },
  ])
    assert.throws(() => directoryQuery(query));
});
test('compact HTTP bootstrap/search/person reads never fetch the entire SQL workspace and suppress revoked or stale results', async () => {
  let current = state(),
    calls = 0,
    mode = 'normal';
  const store: AccessStore = {
    storage: 'azure-sql',
    snapshot: () => {
      throw Error('Full-directory snapshot was fetched');
    },
    actorSnapshot: async id => ({ ...current, people: current.people.filter(p => p.id === id) }),
    person: async id => current.people.find(p => p.id === id),
    save: async () => {
      throw Error('Unexpected write');
    },
    directory: async (id, q) => {
      assert.equal(id, actor);
      calls++;
      if (mode === 'revoke') current.people[0].active = false;
      if (mode === 'stale') current.revision++;
      return {
        revision: 4,
        items: [{ id: employee, name: 'Aditi Menon', employeeCode: '710902', active: false }],
        total: 1,
        page: q.page,
        pageSize: 10,
      };
    },
    personAdministration: async (id, target) => {
      assert.equal(id, actor);
      assert.equal(target, employee);
      return {
        revision: 4,
        person: current.people[1],
        roles: [],
        organization: { nodes: [], assignments: [], people: [] },
      };
    },
  };
  const server = createApp(undefined, { developmentStore: store }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(base + '/api/dev-login', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: actor }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0],
      headers = { Cookie: cookie, Origin: base };
    const summary = await fetch(base + '/api/dev-access?summary=1', { headers });
    assert.equal(summary.status, 200);
    const value = await summary.json();
    assert.deepEqual(value.people, []);
    assert.deepEqual(value.roles, []);
    assert.equal(value.currentPerson.id, actor);
    assert.equal(calls, 0);
    const search = await fetch(base + '/api/dev-access/directory?kind=people&search=Aditi', {
      headers,
    });
    assert.equal(search.status, 200);
    assert.equal((await search.json()).items[0].id, employee);
    const detail = await fetch(base + '/api/dev-access/people/' + employee, { headers });
    assert.equal(detail.status, 200);
    const selected = await detail.json();
    assert.equal(selected.person.id, employee);
    assert.equal(selected.person.active, false);
    assert.equal(selected.people, undefined);
    assert.equal(
      (await fetch(base + '/api/dev-access/people/' + employee + '?actorId=' + actor, { headers }))
        .status,
      400,
    );
    assert.equal(
      (
        await fetch(base + '/api/dev-access/directory?kind=people&search=Aditi&actorId=' + actor, {
          headers,
        })
      ).status,
      400,
    );
    mode = 'stale';
    assert.equal(
      (await fetch(base + '/api/dev-access/directory?kind=people&search=Aditi', { headers }))
        .status,
      409,
    );
    current = state();
    mode = 'revoke';
    assert.equal(
      (await fetch(base + '/api/dev-access/directory?kind=people&search=Aditi', { headers }))
        .status,
      403,
    );
    current = state();
    current.roles[0].permissions = current.roles[0].permissions.filter(
      p => p.permission !== 'users.manage',
    );
    mode = 'normal';
    const before = calls;
    assert.equal(
      (await fetch(base + '/api/dev-access/directory?kind=people&search=Aditi', { headers }))
        .status,
      403,
    );
    assert.equal(calls, before);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
test('SQL adapter parameterizes selected-person and paged reads, reports pending schema and never uses the legacy workspace procedure', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlAccessStore(actor);
    f.reply('dbo.ReadPeopleAdministration', [
      { json: JSON.stringify({ revision: 4, items: [], total: 0, page: 2, pageSize: 10 }) },
    ]);
    await store.directory(actor, { kind: 'people', search: "O'Brien", page: 2 });
    assert.equal(f.calls.at(-1)?.inputs.query, "O'Brien");
    assert.equal(f.calls.at(-1)?.inputs.page, 2);
    assert.equal(f.calls.at(-1)?.inputs.actor_id, actor);
    f.reply('dbo.ReadPeopleAdministration', [
      { json: JSON.stringify({ revision: 4, person: { id: employee } }) },
    ]);
    assert.equal((await store.personAdministration(actor, employee)).person.id, employee);
    assert.equal(f.calls.at(-1)?.inputs.person_id, employee);
    f.reject('dbo.ReadPeopleAdministration', { number: 2812 });
    await assert.rejects(
      store.directory(actor, { kind: 'people', search: 'Aditi', page: 1 }),
      /migration/,
    );
    assert.ok(f.calls.every(c => c.procedure === 'dbo.ReadPeopleAdministration'));
  } finally {
    await f.finish();
  }
});
test('local-only fallback searches bounded results without exposing roles/overrides in directory cards', async () => {
  const current = state(),
    store = { snapshot: () => current } as AccessStore;
  assert.deepEqual(
    (await readDirectory(store, actor, { kind: 'people', search: '', page: 1 })).items,
    [],
  );
  const page = await readDirectory(store, actor, { kind: 'people', search: 'Aditi', page: 1 });
  assert.equal(page.items.length, 1);
  assert.equal('overrides' in page.items[0], false);
  assert.equal((await readPersonAdministration(store, actor, employee)).roles.length, 0);
  await assert.rejects(
    readDirectory({ ...store, storage: 'azure-sql' }, actor, {
      kind: 'people',
      search: 'Aditi',
      page: 1,
    }),
    /migration/,
  );
});
