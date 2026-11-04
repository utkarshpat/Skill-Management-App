import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { tokenVerifier } from '../src/modules/identity/auth.js';

test('delegated token boundaries reject missing claims, app-only tokens, near-match scopes and invalid headers', async t => {
  const config = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    apiClientId: '22222222-2222-4222-8222-222222222222',
    webClientId: '33333333-3333-4333-8333-333333333333',
  };
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'boundaries';
  const verify = tokenVerifier(config, createLocalJWKSet({ keys: [jwk] }));
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    aud: config.apiClientId,
    tid: config.tenantId,
    oid: '44444444-4444-4444-8444-444444444444',
    azp: config.webClientId,
    scp: 'access_as_user',
    ver: '2.0',
    iat: now,
    nbf: now,
    exp: now + 600,
  };
  const sign = (value: Record<string, unknown>) =>
    new SignJWT(value)
      .setProtectedHeader({ alg: 'RS256', kid: 'boundaries' })
      .sign(pair.privateKey);
  for (const claim of ['exp', 'iat', 'nbf', 'tid', 'oid', 'scp', 'azp', 'ver']) {
    await t.test(`missing ${claim} is rejected`, async () => {
      const value = { ...claims };
      delete value[claim];
      await assert.rejects(verify(`Bearer ${await sign(value)}`));
    });
  }
  for (const scope of ['access_as_user_extra', 'prefix_access_as_user', 'ACCESS_AS_USER', '']) {
    await t.test(`nonmatching scope ${scope || '(empty)'}`, async () => {
      await assert.rejects(verify(`Bearer ${await sign({ ...claims, scp: scope })}`));
    });
  }
  await t.test('application roles cannot replace a delegated scope', async () => {
    const value: Record<string, unknown> = { ...claims, roles: ['access_as_user'] };
    delete value.scp;
    await assert.rejects(verify(`Bearer ${await sign(value)}`));
  });
  await t.test('multiple delegated scopes and case-insensitive bearer scheme work', async () => {
    const identity = await verify(
      `bearer ${await sign({ ...claims, scp: 'profile access_as_user other' })}`,
    );
    assert.equal(identity.objectId, claims.oid);
  });
  for (const header of ['Basic abc', 'Bearer a b', 'Bearer ' + 'a'.repeat(16385), 'Bearer\tabc']) {
    await t.test(`malformed header (${header.length} chars)`, async () => {
      await assert.rejects(verify(header));
    });
  }
});
