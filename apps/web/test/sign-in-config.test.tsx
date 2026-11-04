import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSignInConfig } from '../src/sign-in-config';

test('runtime Entra config is explicit, validates identifiers and never accepts arbitrary authority URLs', () => {
  assert.equal(parseSignInConfig({ enabled: false }), undefined);
  for (const input of [
    null,
    {},
    { enabled: true, tenantId: 'https://evil.test', webClientId: 'x', apiClientId: 'x' },
    { enabled: 'true' },
  ])
    assert.throws(() => parseSignInConfig(input));
  const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  assert.deepEqual(
    parseSignInConfig({
      enabled: true,
      tenantId: id,
      apiClientId: id,
      webClientId: id,
      authority: 'https://evil.test',
    }),
    { tenantId: id.toLowerCase(), apiClientId: id.toLowerCase(), webClientId: id.toLowerCase() },
  );
});
