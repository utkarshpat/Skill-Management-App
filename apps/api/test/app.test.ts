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
    assert.equal((await fetch(`${base}/api/ready`)).status, 503);
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

test('readiness reflects runtime dependency failure and recovery without exposing the cause', async () => {
  let reachable = false;
  const server = createApp(undefined, {
    probeReadiness: async () => {
      if (!reachable) throw new Error('private database details');
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const failed = await fetch(base + '/api/ready');
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await failed.json(), { status: 'unavailable' });
    assert.equal((await fetch(base + '/api/health')).status, 200);
    reachable = true;
    const ready = await fetch(base + '/api/ready');
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });
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
  let saves = 0;
  t.mock.method(leads, 'run', async (...[, operation]: Parameters<SqlCapabilityLeads['run']>) => {
    if (operation === 'LIST')
      throw new AccessError(409, 'Workspace changed. Refresh and review again.');
    if (operation === 'SAVE') saves++;
    return {};
  });
  const previousKey = process.env.ENTRA_WEB_CLIENT_SECRET;
  process.env.ENTRA_WEB_CLIENT_SECRET = 'test-preview-key';
  const app = createApp({
    capabilityLeads: leads,
    profile: async () => undefined,
    verify: async () => ({ tenantId: 'trusted-tenant', objectId: 'trusted-object' }),
    resolveAccess: async () => actor,
  });
  if (previousKey === undefined) delete process.env.ENTRA_WEB_CLIENT_SECRET;
  else process.env.ENTRA_WEB_CLIENT_SECRET = previousKey;
  const server = app.listen(0, '127.0.0.1');
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
    const assignment = {
      id: actor,
      personId: actor,
      revision: 1,
      allIssuers: true,
      issuerIds: [],
      scopeId: actor,
      scopeKind: 'PROJECT',
      effect: 'ALLOW',
      active: true,
      reason: 'Certificate approvals for this project',
    };
    const post = (operation: string, body: object) =>
      fetch(`${url}/${operation}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const preview = await post('preview', assignment);
    assert.equal(preview.status, 200);
    const { receipt } = await preview.json();
    for (const invalid of [undefined, 42, 'g'.repeat(64), receipt.slice(1), receipt + '0'])
      assert.equal((await post('save', { ...assignment, receipt: invalid })).status, 409);
    assert.equal((await post('save', { ...assignment, active: false, receipt })).status, 409);
    assert.equal(saves, 0);
    assert.equal((await post('save', { ...assignment, receipt })).status, 200);
    assert.equal(saves, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
