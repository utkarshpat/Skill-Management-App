import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { SqlCapabilityLeads } from '../src/modules/skills/capability-lead-routes.js';
import { AccessError } from '../src/shared/errors.js';

test('health is public; profile, permissions and writes require identity', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    assert.ok(health.headers.get('x-request-id'));
    for (const [path, method] of [
      ['/api/me', 'GET'],
      ['/api/me/permissions', 'GET'],
      ['/api/skills/claims', 'POST'],
    ]) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'NOT_AUTHORIZED');
    }
    const invalid = await fetch(`${base}/api/skills/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'VALIDATION');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('profile trusts verified identity, denies missing membership and hides SQL failures', async () => {
  const identity = { tenantId: 'trusted-tenant', objectId: 'trusted-object' };
  let state: 'allowed' | 'denied' | 'failed' = 'allowed';
  let calls = 0;
  const server = createApp({
    verify: async header => {
      if (header !== 'Bearer valid') throw new Error('invalid');
      return identity;
    },
    profile: async subject => {
      calls++;
      assert.deepEqual(subject, identity);
      if (state === 'failed') throw new Error('SQL connection password must never escape');
      return state === 'denied'
        ? undefined
        : {
            id: 'member',
            displayName: 'Development member',
            employeeCode: 'DEV',
            organization: 'Development',
            status: 'ACTIVE',
            roles: ['EMPLOYEE'],
          };
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/me?objectId=attacker&role=CHRO`;
  try {
    const invalid = await fetch(url, { headers: { Authorization: 'Bearer invalid' } });
    assert.equal(invalid.status, 401);
    assert.equal(calls, 0);
    const allowed = await fetch(url, { headers: { Authorization: 'Bearer valid' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await allowed.json()).profile.roles, ['EMPLOYEE']);
    state = 'denied';
    const denied = await fetch(url, { headers: { Authorization: 'Bearer valid' } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'ACCESS_NOT_PROVISIONED');
    state = 'failed';
    const failed = await fetch(url, { headers: { Authorization: 'Bearer valid' } });
    assert.equal(failed.status, 500);
    const error = await failed.json();
    assert.equal(error.error.code, 'INTERNAL_ERROR');
    assert.ok(error.error.requestId);
    assert.doesNotMatch(JSON.stringify(error), /SQL|password/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('capability lead route keeps expected rejections in the public HTTP error contract', async t => {
  const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const leads = new SqlCapabilityLeads(actor);
  t.mock.method(leads, 'run', async () => {
    throw new AccessError(409, 'Workspace changed. Refresh and review again.');
  });
  const server = createApp({
    capabilityLeads: leads,
    profile: async () => undefined,
    verify: async () => ({ tenantId: 'trusted-tenant', objectId: 'trusted-object' }),
    resolveAccess: async () => actor,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/capability-leads`;
  try {
    for (const [path, status] of [
      ['?personId=invalid', 400],
      ['', 409],
    ] as const) {
      const response = await fetch(url + path, { headers: { Authorization: 'Bearer valid' } });
      assert.equal(response.status, status);
      const error = (await response.json()).error;
      assert.equal(error.code, 'ACCESS_REJECTED');
      assert.equal(error.requestId, response.headers.get('x-request-id'));
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
