import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { teamQuery, type ClaimsStore } from '../src/modules/skills/claims.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { createApp } from '../src/create-app.js';
test('team query rejects forged scope, repeated selectors and oversized searches', () => {
  assert.deepEqual(teamQuery({ search: '  Khushi ', page: '2' }), {
    search: 'Khushi',
    page: 2,
    person: undefined,
  });
  for (const query of [
    { actor: randomUUID() },
    { scope: 'ORGANIZATION' },
    { person: ['a', 'b'] },
    { person: 'bad' },
    { search: 'x'.repeat(101) },
    { page: ['1', '2'] },
  ])
    assert.throws(() => teamQuery(query));
});
test('team HTTP requires independent view permission, verified actor and live authority after retrieval', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    person = state.people[0];
  access.snapshot = () => structuredClone(state);
  person.hasDirectReports = true;
  person.overrides.push({ permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'ALLOW' });
  let calls = 0,
    revoke = false;
  const claims: ClaimsStore = {
    read: async () => ({ claims: [], total: 0, page: 1, pageSize: 25, canClaim: false }),
    options: async () => ({ skills: [], total: 0, page: 1, pageSize: 25 }),
    save: async () => {},
    team: async actor => {
      calls++;
      assert.equal(actor, person.id);
      if (revoke)
        person.overrides.push({ permission: 'skill.view', scope: 'ORGANIZATION', effect: 'DENY' });
      return { total: 0, page: 1, pageSize: 12, scope: 'DIRECT_REPORTS', people: [], skills: [] };
    },
  };
  const server = createApp({
    verify: async auth => {
      if (auth !== 'Bearer trusted') throw Error();
      return { tenantId: 'tenant', objectId: 'actor' };
    },
    resolveAccess: async () => person.id,
    profile: async () => undefined,
    access,
    claims,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/skill-reviews/team`,
    headers = { Authorization: 'Bearer trusted' };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers })).status, 403);
    assert.equal(calls, 0);
    person.overrides.push({ permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' });
    assert.equal((await fetch(url + '?actor=' + randomUUID(), { headers })).status, 400);
    assert.equal(calls, 0);
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal(calls, 1);
    revoke = true;
    assert.equal((await fetch(url, { headers })).status, 403);
    assert.equal(calls, 2);
    assert.equal((await fetch(url, { headers })).status, 403);
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
  }
});
