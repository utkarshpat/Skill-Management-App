import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { tokenVerifier } from '../src/auth.js';

test('signed access tokens validate signature, tenant, audience, caller, lifetime and delegated scope', async () => {
  const config = { tenantId: '11111111-1111-4111-8111-111111111111', apiClientId: '22222222-2222-4222-8222-222222222222', webClientId: '33333333-3333-4333-8333-333333333333' };
  const oid = '44444444-4444-4444-8444-444444444444';
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey); jwk.kid = 'test';
  const verify = tokenVerifier(config, createLocalJWKSet({ keys: [jwk] }));
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: `https://login.microsoftonline.com/${config.tenantId}/v2.0`, aud: config.apiClientId, tid: config.tenantId, oid, azp: config.webClientId, scp: 'access_as_user', ver: '2.0', iat: now, nbf: now, exp: now + 600 };
  const sign = (overrides = {}) => new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(pair.privateKey);
  assert.deepEqual(await verify(`Bearer ${await sign()}`), { tenantId: config.tenantId, objectId: oid });
  for (const override of [{ iss: 'https://untrusted.example' }, { aud: config.webClientId }, { tid: oid }, { azp: oid }, { exp: now - 20 }, { nbf: now + 100 }, { scp: 'User.Read' }, { oid: 'invalid' }, { ver: '1.0' }]) {
    await assert.rejects(verify(`Bearer ${await sign(override)}`));
  }
  await assert.rejects(verify(undefined));
  await assert.rejects(verify('Bearer invalid'));
  const other = await generateKeyPair('RS256');
  const forged = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(other.privateKey);
  await assert.rejects(verify(`Bearer ${forged}`));
});
