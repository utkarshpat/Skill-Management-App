import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

test('Vercel entrypoint exports the configured app and public routing retains API authentication', async () => {
  process.env.VERCEL = '1';
  process.env.NODE_ENV = 'production';
  process.env.DEV_DIRECT_LOGIN = 'false';
    const { default: app } = await import('../app.js');
  assert.equal(typeof app, 'function');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(origin + '/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'capability-api');
    for (const path of ['/api/profile', '/api/my-skills', '/api/assistant', '/api/learning']) {
      assert.equal((await fetch(origin + path)).status, 401);
    }
    assert.equal((await fetch(origin + '/api/dev-login')).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
