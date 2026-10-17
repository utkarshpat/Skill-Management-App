import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { applicationDependencies } from '../src/application-dependencies.js';
import type { AccessStore, LocalAccessState } from '../src/modules/access/local-access-store.js';

test('services remain disabled without either configured authentication mode', () => {
  assert.equal(
    applicationDependencies(undefined, false, { profile: async () => undefined }),
    undefined,
  );
});

test('demo-only composition enables capability services while denying bearer tokens and revoked sessions', async () => {
  const actor = '11111111-1111-4111-8111-111111111111';
  const state: LocalAccessState = {
    revision: 1,
    roles: [],
    audit: [],
    people: [
      {
        id: actor,
        displayName: 'Setup operator',
        employeeCode: 'SETUP',
        active: true,
        roleIds: [],
        overrides: [{ permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' }],
      },
    ],
  };
  const store: AccessStore = {
    snapshot: () => state,
    person: id => state.people.find(p => p.id === id),
    save: async () => {
      throw new Error('Unexpected mutation');
    },
  };
  let reads = 0;
  const dependencies = applicationDependencies(undefined, true, {
    access: store,
    profile: async () => undefined,
    resolveAccess: async () => {
      throw new Error('Bearer must not resolve');
    },
    capabilitySubmissions: {
      run: async (id, operation) => {
        assert.equal(id, actor);
        assert.equal(operation, 'MINE');
        reads++;
        return { submissions: [] };
      },
    },
  });
  await assert.rejects(dependencies!.verify('Bearer arbitrary'));
  const hosted = {
    origin: 'https://127.0.0.1',
    accessCode: 'test-access-code',
    sessionSecret: 'test-only-signing-secret-with-32-characters',
  };
  const server = createApp(dependencies, { developmentStore: store, hostedDemo: hosted }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  hosted.origin = `https://127.0.0.1:${address.port}`;
  try {
    for (const authorization of ['', 'Bearer arbitrary']) {
      assert.equal(
        (await fetch(base + '/api/capability-submissions', { headers: { authorization } })).status,
        401,
      );
    }
    const login = await fetch(base + '/api/dev-login', {
      method: 'POST',
      headers: { Origin: hosted.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: actor, accessCode: hosted.accessCode }),
    });
    assert.equal(login.status, 200);
    const Cookie = login.headers.get('set-cookie')!.split(';')[0];
    const response = await fetch(base + '/api/capability-submissions', { headers: { Cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { submissions: [] });
    assert.equal(reads, 1);
    state.people[0].active = false;
    assert.equal(
      (await fetch(base + '/api/capability-submissions', { headers: { Cookie } })).status,
      403,
    );
    assert.equal(reads, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
