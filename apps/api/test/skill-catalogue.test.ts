import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { catalogueChange, catalogueQuery } from '../src/modules/skills/skill-catalogue.js';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { proficiencyNames } from '../src/modules/skills/proficiency.js';

const input = () => ({
  revision: 1,
  name: '  SQL   Server ',
  category: ' Databases ',
  description: 'Query relational data safely.',
  status: 'PUBLISHED',
  levels: proficiencyNames.map((name, index) => ({
    rank: index + 1,
    name,
    description: 'SQL criteria for ' + name,
  })),
});
test('catalogue validates publication criteria, sequential unique levels, bounded filters and trusted fields', () => {
  const change = catalogueChange({ ...input(), actorId: 'attacker', accountId: 'other' });
  assert.equal(change.payload.name, 'SQL Server');
  assert.equal(change.payload.category, 'Databases');
  assert.equal('actorId' in change, false);
  assert.equal('accountId' in change.payload, false);
  assert.equal(
    catalogueChange({
      ...input(),
      status: 'DRAFT',
      description: '',
      levels: input().levels.map(level => ({ ...level, description: '' })),
    }).payload.description,
    '',
  );
  assert.throws(() => catalogueChange({ ...input(), description: '' }), /required/);
  assert.throws(
    () =>
      catalogueChange({
        ...input(),
        levels: input().levels.map(level => ({ ...level, description: '' })),
      }),
    /required/,
  );
  assert.throws(
    () =>
      catalogueChange({
        ...input(),
        levels: input().levels.map(level => ({ ...level, rank: level.rank + 1 })),
      }),
    /sequential/,
  );
  assert.throws(
    () =>
      catalogueChange({
        ...input(),
        levels: input().levels.map(level =>
          level.rank === 2 ? { ...level, name: 'AWARENESS' } : level,
        ),
      }),
    /unique/,
  );
  assert.throws(() => catalogueChange({ ...input(), levels: [] }), /exactly five/);
  assert.throws(
    () =>
      catalogueChange({
        ...input(),
        levels: Array.from({ length: 9 }, (_, i) => ({
          rank: i + 1,
          name: String(i),
          description: 'Criteria',
        })),
      }),
    /exactly five/,
  );
  for (const levels of [
    input().levels.slice(0, 4),
    [...input().levels, { rank: 6, name: 'Master', description: 'Criteria' }],
    input().levels.map(level => (level.rank === 2 ? { ...level, name: 'Beginner' } : level)),
    input().levels.map(level => (level.rank === 3 ? { ...level, name: 'Intermediate' } : level)),
    input().levels.map(level => ({ ...level, name: level.name.toLowerCase() })),
  ]) {
    assert.throws(() => catalogueChange({ ...input(), levels }), /exactly five/);
    assert.throws(
      () => catalogueChange({ ...input(), id: '00000000-0000-4000-8000-000000000001', levels }),
      /exactly five/,
    );
  }
  assert.throws(
    () =>
      catalogueChange({
        ...input(),
        levels: input().levels.map(level =>
          level.rank === 5 ? { ...level, description: '' } : level,
        ),
      }),
    /required/,
  );
  assert.throws(() => catalogueChange({ ...input(), revision: 0 }), /Reload/);
  assert.throws(() => catalogueChange({ ...input(), id: 'outside' }), /valid skill/);
  assert.throws(() => catalogueQuery({ page: '1.5' }), /valid/);
  assert.throws(() => catalogueQuery({ status: 'DELETED' }), /valid/);
  assert.throws(() => catalogueQuery({ search: 'x'.repeat(101) }), /lengths/);
  assert.deepEqual(catalogueQuery({ search: ' C++ [%] ', page: '2' }), {
    search: 'C++ [%]',
    status: '',
    page: 2,
  });
});

test('catalogue HTTP binds Microsoft actor, checks independent permissions and rejects revoked, own-only and forged access', async () => {
  const access = await LocalAccessStore.open();
  let current = access.snapshot();
  const actor = current.people[0].id;
  current.people[0].overrides.push({
    permission: 'skill.view',
    scope: 'ORGANIZATION',
    effect: 'ALLOW',
  });
  access.snapshot = () => structuredClone(current);
  let reads = 0,
    saves = 0,
    savedActor = '',
    outage = false;
  const server = createApp({
    verify: async header => {
      if (header !== 'Bearer trusted') throw Error();
      return { tenantId: 'tenant', objectId: 'owner' };
    },
    profile: async () => undefined,
    access,
    resolveAccess: async () => {
      if (outage) throw Error('SQL connection secret');
      return actor;
    },
    catalogue: {
      read: async (id, query) => {
        assert.equal(id, actor);
        reads++;
        return {
          revision: 1,
          canManage: false,
          total: 0,
          page: query.page,
          pageSize: 25,
          skills: [],
        };
      },
      save: async id => {
        savedActor = id;
        saves++;
      },
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/skills`,
    headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal(reads, 0);
    const read = await fetch(url, { headers });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(input()) })).status,
      403,
    );
    assert.equal(saves, 0);
    // Admin role labels and permission administration do not imply taxonomy authority.
    current.people[0].overrides.push({
      permission: 'skill.catalogue.manage',
      scope: 'OWN',
      effect: 'ALLOW',
    });
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(input()) })).status,
      403,
    );
    current.people[0].overrides.push({
      permission: 'skill.catalogue.manage',
      scope: 'ORGANIZATION',
      effect: 'ALLOW',
    });
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input(), actorId: 'attacker', accountId: 'other' }),
        })
      ).status,
      200,
    );
    assert.equal(savedActor, actor);
    current.people[0].overrides.push({
      permission: 'skill.catalogue.manage',
      scope: 'ORGANIZATION',
      effect: 'DENY',
    });
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(input()) })).status,
      403,
    );
    assert.equal(saves, 1);
    current.people[0].overrides.push({
      permission: 'skill.view',
      scope: 'ORGANIZATION',
      effect: 'DENY',
    });
    assert.equal((await fetch(url, { headers })).status, 403);
    current.people[0].active = false;
    assert.equal((await fetch(url, { headers })).status, 403);
    outage = true;
    const failed = await fetch(url, { headers });
    assert.equal(failed.status, 500);
    assert.ok(!(await failed.text()).includes('SQL connection secret'));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
