import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
test('scheduler requires machine secret, ignores caller scope, and withholds diagnostics', async () => {
  let calls = 0,
    fail = false;
  const server = createApp(undefined, {
    certificationReminderJob: {
      secret: 'fixture-secret',
      run: async () => {
        calls++;
        if (fail) throw Error('Private SQL diagnostic');
        return { created: 2 };
      },
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/jobs/certification-expiry`;
  try {
    for (const authorization of ['', 'Bearer wrong', 'Bearer fixture-secreu']) {
      const result = await fetch(url, { headers: { authorization, cookie: 'demo=fixture' } });
      assert.equal(result.status, 401);
      assert.equal(result.headers.get('cache-control'), 'no-store');
    }
    assert.equal(calls, 0);
    const headers = { authorization: 'Bearer fixture-secret' };
    const ok = await fetch(url + '?account_id=foreign&actor_id=foreign', { headers });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, created: 2 });
    fail = true;
    const failed = await fetch(url, { headers });
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('Private SQL'));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
test('scheduler without configuration is unavailable', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    assert.equal(
      (await fetch(`http://127.0.0.1:${address.port}/api/jobs/certification-expiry`)).status,
      503,
    );
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
