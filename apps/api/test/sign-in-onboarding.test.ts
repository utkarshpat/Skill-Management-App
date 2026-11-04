import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { identityConfig } from '../src/modules/identity/auth.js';

test('public config contains only registration IDs; unprovisioned identity comes only from verifier', async () => {
  const config = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    apiClientId: '22222222-2222-4222-8222-222222222222',
    webClientId: '33333333-3333-4333-8333-333333333333',
    secret: 'never-public',
  };
  const identity = { tenantId: config.tenantId, objectId: '44444444-4444-4444-8444-444444444444' };
  let profileCalls = 0;
  const server = createApp(
    {
      verify: async header => {
        if (header !== 'Bearer trusted') throw new Error('invalid');
        return identity;
      },
      profile: async () => {
        profileCalls++;
        return undefined;
      },
    },
    { identityConfig: config },
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(base + '/api/auth/config');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      enabled: true,
      tenantId: config.tenantId,
      apiClientId: config.apiClientId,
      webClientId: config.webClientId,
    });
    for (const authorization of [undefined, 'Bearer forged']) {
      const denied = await fetch(base + '/api/auth/identity?objectId=attacker', {
        headers: authorization ? { Authorization: authorization } : {},
      });
      assert.equal(denied.status, 401);
    }
    const own = await fetch(base + '/api/auth/identity?objectId=attacker&employeeCode=admin', {
      headers: { Authorization: 'Bearer trusted' },
    });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await own.json(), identity);
    assert.equal(profileCalls, 0); // No membership lookup, linking or access mutation.
    const workspace = await fetch(base + '/api/me', {
      headers: { Authorization: 'Bearer trusted' },
    });
    assert.equal(workspace.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('partial Entra configuration fails closed and UUID casing is normalized', () => {
  assert.equal(identityConfig({}), undefined);
  assert.throws(() => identityConfig({ ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111' }));
  const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  assert.deepEqual(
    identityConfig({ ENTRA_TENANT_ID: id, ENTRA_API_CLIENT_ID: id, ENTRA_WEB_CLIENT_ID: id }),
    { tenantId: id.toLowerCase(), apiClientId: id.toLowerCase(), webClientId: id.toLowerCase() },
  );
});
