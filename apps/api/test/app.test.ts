import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

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
    for (const [path, method] of [['/api/me', 'GET'], ['/api/me/permissions', 'GET'], ['/api/skills/claims', 'POST']]) {
      const response = await fetch(base + path, {method});
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'NOT_AUTHORIZED');
    }
    const invalid = await fetch(`${base}/api/skills/claims`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'});
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'VALIDATION');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
