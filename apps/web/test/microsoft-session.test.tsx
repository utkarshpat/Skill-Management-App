import test from 'node:test';
import assert from 'node:assert/strict';
import type { AccountInfo, AuthenticationResult } from '@azure/msal-browser';
import { createMicrosoftSession } from '../src/microsoft-session';

const account: AccountInfo = {
  homeAccountId: 'home',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant',
  username: 'member@example.test',
  localAccountId: 'local',
};
function fixture() {
  let active: AccountInfo | null = null,
    calls = 0;
  const client = {
    initialize: async () => {
      calls++;
    },
    handleRedirectPromise: async (): Promise<AuthenticationResult | null> => null,
    getActiveAccount: () => active,
    getAllAccounts: () => [account],
    setActiveAccount: (value: AccountInfo | null) => {
      active = value;
    },
    loginRedirect: async () => {},
    logoutRedirect: async () => {},
    acquireTokenSilent: async () => ({ accessToken: 'sdk-managed' }) as AuthenticationResult,
    acquireTokenRedirect: async () => {},
  };
  return { client, calls: () => calls };
}
test('unused Microsoft sessions load no SDK; concurrent initialization restores one SDK-selected account once', async () => {
  const f = fixture();
  let loads = 0;
  const session = createMicrosoftSession(async () => {
    loads++;
    return { createClient: () => f.client, requiresInteraction: () => false };
  });
  assert.equal(loads, 0);
  assert.equal(Boolean(session.client), false);
  await Promise.all([session.initialize(), session.initialize(), session.initialize()]);
  assert.equal(loads, 1);
  assert.equal(f.calls(), 1);
  assert.equal(session.client?.getActiveAccount(), account);
  await session.initialize();
  assert.equal(f.calls(), 1);
});
test('SDK load and initialization failures remain retryable without starting automatic retries', async () => {
  const f = fixture();
  let loads = 0,
    initialized = 0;
  const failure = Error('SDK unavailable');
  f.client.initialize = async () => {
    if (++initialized === 1) throw failure;
  };
  const session = createMicrosoftSession(async () => {
    if (++loads === 1) throw failure;
    return { createClient: () => f.client, requiresInteraction: error => error === failure };
  });
  await assert.rejects(session.initialize(), error => error === failure);
  assert.equal(loads, 1);
  await assert.rejects(session.initialize(), error => error === failure);
  assert.equal(loads, 2);
  assert.equal(initialized, 1);
  await session.initialize();
  assert.equal(loads, 2);
  assert.equal(initialized, 2);
  assert.equal(session.requiresInteraction(failure), true);
});
test('multiple SDK accounts require explicit selection rather than choosing the first', async () => {
  const f = fixture();
  f.client.getAllAccounts = () => [account, { ...account, localAccountId: 'other' }];
  const session = createMicrosoftSession(async () => ({
    createClient: () => f.client,
    requiresInteraction: () => false,
  }));
  await session.initialize();
  assert.equal(session.client?.getActiveAccount(), null);
});
