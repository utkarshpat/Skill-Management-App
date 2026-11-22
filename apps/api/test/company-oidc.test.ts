import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { generateKeyPair, SignJWT } from 'jose';
import { registerCompanyCallback } from '../src/modules/identity/company-oidc.js';
import { registerCompanySessions } from '../src/modules/identity/company-session.js';
import { memoryCompanyAuthState } from '../src/modules/identity/company-auth-state.js';
import { verifyRequestIdentity } from '../src/shared/request-identity.js';

test('backend callback binds PKCE and nonce, consumes state once, and authorizes via opaque cookie', async () => {
  const origin = 'https://skills.example.test';
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const objectId = '22222222-2222-4222-8222-222222222222';
  const webClientId = '33333333-3333-4333-8333-333333333333';
  const loginHint = 'opaque-account-hint';
  const issuer = 'https://login.microsoftonline.com/' + tenantId + '/v2.0';
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const app = express();
  const rejectBearer = async () => {
    throw Error('No bearer in callback mode');
  };
  const signedInAt = Date.now();
  const eightHours = 8 * 60 * 60 * 1000;
  let now = signedInAt;
  const sharedSessions = memoryCompanyAuthState<
    import('../src/modules/identity/company-session.js').CompanySession
  >(() => now);
  const session = registerCompanySessions(app, origin, undefined, () => now, sharedSessions);
  const secondWorker = express();
  registerCompanySessions(secondWorker, origin, undefined, () => now, sharedSessions);
  secondWorker.get('/api/actor', async (req, res) => {
    try {
      res.json(await verifyRequestIdentity(req, rejectBearer));
    } catch {
      res.sendStatus(401);
    }
  });
  let authorization: URL;
  let exchanges = 0;
  let wrongNonce = false;
  let username = 'employee@SopraSteria.com';
  registerCompanyCallback(
    app,
    origin,
    { tenantId, webClientId, apiClientId: webClientId },
    'test-secret',
    session.issueFromOidc,
    async (input, init) => {
      assert.equal(
        String(input),
        'https://login.microsoftonline.com/' + tenantId + '/oauth2/v2.0/token',
      );
      const query = new URLSearchParams(String(init?.body));
      assert.equal(query.get('redirect_uri'), origin + '/api/auth/callback');
      assert.equal(
        createHash('sha256').update(query.get('code_verifier')!).digest('base64url'),
        authorization.searchParams.get('code_challenge'),
      );
      const nonce = wrongNonce ? 'wrong' : authorization.searchParams.get('nonce');
      exchanges++;
      return Response.json({
        id_token: await new SignJWT({
          tid: tenantId,
          oid: objectId,
          nonce,
          login_hint: loginHint,
          preferred_username: username,
        })
          .setProtectedHeader({ alg: 'RS256' })
          .setIssuer(issuer)
          .setAudience(webClientId)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey),
      });
    },
    async () => publicKey,
  );

  app.get('/api/actor', async (req, res) => {
    try {
      res.json(await verifyRequestIdentity(req, rejectBearer));
    } catch {
      res.sendStatus(401);
    }
  });
  const server = app.listen(0, '127.0.0.1');
  const secondServer = secondWorker.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const secondAddress = secondServer.address();
    assert.ok(secondAddress && typeof secondAddress !== 'string');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (path: string, cookie = '') =>
      fetch('http://127.0.0.1:' + address.port + path, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
    async function start(mode = '', extraCookie = '') {
      const login = await get('/api/auth/login' + mode, extraCookie);
      authorization = new URL(login.headers.get('location')!);
      assert.equal(authorization.searchParams.get('scope'), 'openid profile');
      return {
        authorization,
        cookie: login.headers.get('set-cookie')!.split(';')[0],
        callback:
          '/api/auth/callback?code=fixture&state=' + authorization.searchParams.get('state'),
      };
    }
    assert.equal(
      (await get('/api/auth/signed-out')).headers.get('location'),
      '/?signin=signed-out',
    );
    const completion = await get('/api/auth/resume-complete');
    assert.match(completion.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(completion.headers.get('cache-control'), 'no-store');
    const pageNonce = /script-src 'nonce-([\w-]+)'/.exec(
      completion.headers.get('content-security-policy') ?? '',
    )?.[1];
    assert.ok(pageNonce);
    const completionHtml = await completion.text();
    assert.ok(completionHtml.includes(`<script nonce="${pageNonce}">`));
    assert.match(completionHtml, /href="\/workspace"/);
    const failedCompletion = await (await get('/api/auth/resume-complete?signin=failed')).text();
    assert.match(failedCompletion, /Try Microsoft sign-in again/);
    assert.doesNotMatch(failedCompletion, /<script/);
    const legacy = await fetch('http://127.0.0.1:' + address.port + '/api/auth/session', {
      method: 'POST',
      headers: { Authorization: 'Bearer legacy', Origin: origin },
    });
    assert.equal(legacy.status, 401);
    assert.equal(legacy.headers.get('set-cookie'), null);
    const silent = await start(
      '?mode=silent&returnTo=' + encodeURIComponent('/requests?view=mine#open'),
    );
    const noMicrosoftSession = await get(
      '/api/auth/callback?error=login_required&state=' +
        silent.authorization.searchParams.get('state'),
      silent.cookie,
    );
    assert.equal(
      noMicrosoftSession.headers.get('location'),
      '/requests?view=mine&signin=failed#open',
    );
    assert.equal(exchanges, 0);
    const first = await start('?mode=silent&returnTo=%2Frequests');
    assert.equal(first.authorization.searchParams.get('prompt'), 'none');
    assert.equal(first.authorization.searchParams.has('login_hint'), false);
    assert.equal((await get(first.callback)).headers.get('location'), '/?signin=failed');
    assert.equal(exchanges, 0);
    const completed = await get(first.callback, first.cookie);
    assert.equal(completed.headers.get('location'), origin + '/requests');
    const sessionHeader = completed.headers
      .getSetCookie()
      .find(value => value.startsWith('__Host-skill-session='))!;
    assert.match(sessionHeader, /(?:^|; )Max-Age=28800(?:;|$)/);
    const cookie = sessionHeader.split(';')[0];
    const hintHeader = completed.headers
      .getSetCookie()
      .find(value => value.startsWith('__Host-skill-login-hint='))!;
    const savedHint = hintHeader.split(';')[0];
    assert.match(hintHeader, /HttpOnly; Secure; SameSite=Lax/);
    const resumed = await start('?mode=silent', savedHint);
    assert.equal(resumed.authorization.searchParams.get('prompt'), 'none');
    assert.equal(resumed.authorization.searchParams.get('login_hint'), loginHint);
    now = signedInAt + eightHours - 1;
    const sharedResponse = await fetch('http://127.0.0.1:' + secondAddress.port + '/api/actor', {
      headers: { Cookie: cookie },
    });
    assert.deepEqual(await sharedResponse.json(), {
      tenantId,
      objectId,
      workEmail: username.toLowerCase(),
    });
    now = signedInAt + eightHours;
    assert.equal((await get('/api/actor', cookie)).status, 401);
    now = signedInAt;
    const nextLogin = await start();
    const nextSession = await get(nextLogin.callback, nextLogin.cookie);
    const nextCookie = nextSession.headers
      .getSetCookie()
      .find(value => value.startsWith('__Host-skill-session='))!
      .split(';')[0];
    assert.equal(
      (await get(first.callback, first.cookie)).headers.get('location'),
      '/?signin=failed',
    );
    assert.equal(exchanges, 2);
    const logout = await fetch('http://127.0.0.1:' + address.port + '/api/auth/session', {
      method: 'DELETE',
      headers: { Origin: origin, Cookie: nextCookie },
    });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { logoutHint: loginHint });
    assert.equal((await get('/api/actor', nextCookie)).status, 401);
    wrongNonce = true;
    const second = await start('?mode=choose', savedHint);
    assert.equal(second.authorization.searchParams.get('prompt'), 'select_account');
    assert.equal(second.authorization.searchParams.has('login_hint'), false);
    const rejected = await get(second.callback, second.cookie);
    assert.equal(rejected.headers.get('location'), '/?signin=failed');
    assert.ok(
      !rejected.headers.getSetCookie().some(value => value.startsWith('__Host-skill-session=')),
    );
    wrongNonce = false;
    username = 'employee@soprasteria.com.example.org';
    const foreign = await start();
    assert.equal(foreign.authorization.searchParams.has('prompt'), false);
    const denied = await get(foreign.callback, foreign.cookie);
    assert.equal(denied.headers.get('location'), '/?signin=company-required');
    assert.ok(
      !denied.headers.getSetCookie().some(value => value.startsWith('__Host-skill-session=')),
    );
  } finally {
    server.close();
    secondServer.close();
  }
});
