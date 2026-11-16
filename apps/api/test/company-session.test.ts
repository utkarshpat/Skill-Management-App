import { verifyRequestIdentity } from '../src/shared/request-identity.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import { registerCompanySessions } from '../src/modules/identity/company-session.js';

test('company cookie is opaque, origin-bound for writes, expires, and can be revoked', async () => {
  const origin = 'https://skills.example.test';
  const app = express();
  let now = Date.now();
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(Math.floor(now / 1000) + 300)
    .sign(new Uint8Array(32));
  const authorization = 'Bearer ' + token;
  const session = registerCompanySessions(
    app,
    origin,
    async header => {
      assert.equal(header, authorization);
      return { tenantId: 'tenant', objectId: 'employee' };
    },
    () => now,
  );
  app.get('/api/status', (req, res) => res.json({ active: session.active(req) }));
  app.all('/api/protected', async (req, res) => {
    try {
      const identity = await verifyRequestIdentity(req, async () => {
        throw Error('Bearer missing');
      });
      res.sendStatus(identity.objectId === 'employee' ? 204 : 401);
    } catch {
      res.sendStatus(401);
    }
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const send = async (path: string, expected: number, method = 'GET', headers = {}) => {
      const response = await fetch('http://127.0.0.1:' + address.port + '/api/' + path, {
        method,
        headers,
      });
      assert.equal(response.status, expected);
      return response;
    };
    await send('auth/session', 403, 'POST', { Authorization: authorization });
    await send('auth/session', 401, 'POST', { Origin: origin });
    const issue = () =>
      send('auth/session', 204, 'POST', { Origin: origin, Authorization: authorization });
    const header = (await issue()).headers.get('set-cookie')!;
    assert.match(header, /__Host-skill-session=[\w-]{43};/);
    assert.match(header, /HttpOnly; Secure; SameSite=Strict/);
    assert.ok(!header.includes(token));
    const Cookie = header.split(';')[0];
    assert.deepEqual(await (await send('status', 200, 'GET', { Cookie })).json(), { active: true });
    await send('protected', 204, 'GET', { Cookie });
    await send('protected', 403, 'POST', { Cookie, Origin: 'https://elsewhere.test' });
    await send('protected', 204, 'POST', { Cookie, Origin: origin });
    await send('auth/session', 204, 'DELETE', { Cookie, Origin: origin });
    await send('protected', 401, 'GET', { Cookie });
    const fresh = (await issue()).headers.get('set-cookie')!.split(';')[0];
    now += 301_000;
    assert.deepEqual(await (await send('status', 200, 'GET', { Cookie: fresh })).json(), {
      active: false,
    });
    await send('protected', 401, 'GET', { Cookie: fresh });
  } finally {
    server.close();
  }
});
