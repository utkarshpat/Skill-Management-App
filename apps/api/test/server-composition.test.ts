import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let sequence = 0;
async function boot(settings: Record<string, string>) {
  const previous = { ...process.env };
  try {
    // Import the actual composition root without a listener, credentials or
    // inherited company configuration. Only unauthenticated HTTP is exercised.
    for (const key of Object.keys(process.env))
      if (
        /^(?:AZURE_|AI_|ENTRA_|ACCESS_|EVIDENCE_|DEMO_|HOSTED_|DEV_DIRECT_|STORAGE_|SERVE_WEB|VERCEL|PORT$|NODE_ENV|KNOWLEDGE_)/.test(
          key,
        )
      )
        delete process.env[key];
    Object.assign(process.env, { VERCEL: '1', NODE_ENV: 'production', ...settings });
    return (await import(`../src/server.js?composition=${++sequence}`)).default;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test('server startup rejects invalid listener ports and ambiguous Microsoft/development sign-in', async () => {
  for (const port of ['0', '-1', '65536', '1.5', 'not-a-port'])
    await assert.rejects(boot({ PORT: port }), /PORT must be between/);
  await assert.rejects(
    boot({
      NODE_ENV: 'development',
      DEV_DIRECT_LOGIN: 'true',
      ENTRA_TENANT_ID: id,
      ENTRA_API_CLIENT_ID: id,
      ENTRA_WEB_CLIENT_ID: id,
    }),
    /Disable HOSTED_DEMO_LOGIN and DEV_DIRECT_LOGIN/,
  );
});

test('production composition exposes liveness separately from configured identity and protected workflows', async t => {
  for (const configured of [false, true]) {
    const app = await boot(
      configured
        ? {
            ACCESS_ACCOUNT_ID: id,
            ENTRA_TENANT_ID: id,
            ENTRA_API_CLIENT_ID: id,
            ENTRA_WEB_CLIENT_ID: id,
            STORAGE_IS_SQL: 'true',
            KNOWLEDGE_TRANSFER_ENABLED: 'false',
            AI_PROVIDER: 'azure',
            AI_ENDPOINT: 'https://delivery-audit.services.ai.azure.com/openai/v1',
            AI_MODEL: 'workflow-deployment',
            AI_AZURE_AUTH: 'managed-identity',
          }
        : {},
    );
    const server = app.listen(0, '127.0.0.1');
    t.after(() => server.close());
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const root = `http://127.0.0.1:${address.port}`;
    const live = await fetch(root + '/api/health');
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), {
      status: 'ok',
      service: 'capability-api',
      version: '0.1.0',
    });
    assert.equal(live.headers.get('cache-control'), 'no-store');
    const auth = (await (await fetch(root + '/api/auth/config')).json()) as { enabled: boolean };
    assert.equal(auth.enabled, configured);
    for (const path of ['/api/workspace', '/api/my-skills', '/api/business/dashboard'])
      assert.equal((await fetch(root + path)).status, 401, path);
    assert.equal((await fetch(root + '/api/dev-login')).status, 404);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
