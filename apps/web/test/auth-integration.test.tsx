import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeBrowser, deferred, demoResponse, settle } from './support/browser';
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';

const config = {
  enabled: true,
  tenantId: '11111111-1111-4111-8111-111111111111',
  apiClientId: '22222222-2222-4222-8222-222222222222',
  webClientId: '33333333-3333-4333-8333-333333333333',
};
const account: AccountInfo = {
  homeAccountId: 'test-account',
  localAccountId: 'test-object',
  tenantId: config.tenantId,
  environment: 'login.microsoftonline.com',
  username: 'test@example.test',
};
const require = createRequire(import.meta.url);
const { businessDraftHandoff } =
  require('../src/business/business-draft-handoff.ts') as typeof import('../src/business/business-draft-handoff');

test('company re-sign-in resumes only the original account after an expired session', async () => {
  const { auth, transport } = await fixture();
  let active = true;
  let subject = 'original-account';
  transport(async input =>
    String(input) === '/api/auth/config'
      ? Response.json({
          ...config,
          cookieSession: true,
          backendSignIn: true,
          sessionActive: active,
          sessionSubject: subject,
        })
      : new Response(null, { status: 401 }),
  );
  await auth.initializeAuth();
  active = false;
  assert.equal((await auth.authenticatedFetch('/api/workspace')).status, 401);
  assert.equal(auth.signedIn(), false);
  assert.match(auth.companyResumePath() ?? '', /returnTo=%2Fapi%2Fauth%2Fresume-complete/);
  await assert.rejects(auth.resumeCompanySession(), /Complete Microsoft sign-in/);
  active = true;
  subject = 'different-account';
  assert.equal(await auth.resumeCompanySession(), false);
  assert.equal(auth.signedIn(), false);
  subject = 'original-account';
  assert.equal(await auth.resumeCompanySession(), true);
  assert.equal(auth.signedIn(), true);
});
async function fixture() {
  const channels: {
    onmessage: ((event: { data: unknown }) => void) | null;
    messages: unknown[];
  }[] = [];
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    value: class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      messages: unknown[] = [];
      constructor() {
        channels.push(this);
      }
      postMessage(value: unknown) {
        this.messages.push(value);
      }
      close() {}
    },
  });
  let active: AccountInfo | null = account;
  let sdkOptions: ReturnType<PublicClientApplication['getConfiguration']> | undefined;
  const calls = {
    initialize: 0,
    login: [] as unknown[],
    logout: [] as unknown[],
    silent: [] as unknown[],
    redirect: [] as unknown[],
  };
  const client = {
    initialize: async () => {
      calls.initialize++;
    },
    handleRedirectPromise: async () => null,
    getActiveAccount: () => active,
    getAllAccounts: () => (active ? [active] : []),
    setActiveAccount: (next: AccountInfo | null) => {
      active = next;
    },
    loginRedirect: async (input: unknown) => {
      calls.login.push(input);
    },
    logoutRedirect: async (input: unknown) => {
      calls.logout.push(input);
    },
    acquireTokenSilent: async (input: unknown): Promise<AuthenticationResult> => {
      calls.silent.push(input);
      return {
        accessToken: 'test-access-token',
        account,
        authority: '',
        uniqueId: 'test-object',
        tenantId: config.tenantId,
        scopes: [`api://${config.apiClientId}/access_as_user`],
        idToken: '',
        idTokenClaims: {},
        fromCache: true,
        expiresOn: null,
        tokenType: 'Bearer',
        correlationId: 'test-request',
      };
    },
    acquireTokenRedirect: async (input: unknown) => {
      calls.redirect.push(input);
    },
  };
  mock.method(
    PublicClientApplication.prototype,
    'initialize',
    function (this: PublicClientApplication) {
      sdkOptions = this.getConfiguration();
      return client.initialize();
    },
  );
  mock.method(PublicClientApplication.prototype, 'handleRedirectPromise', () =>
    client.handleRedirectPromise(),
  );
  mock.method(PublicClientApplication.prototype, 'getActiveAccount', () =>
    client.getActiveAccount(),
  );
  mock.method(PublicClientApplication.prototype, 'getAllAccounts', () => client.getAllAccounts());
  mock.method(PublicClientApplication.prototype, 'setActiveAccount', (next: AccountInfo | null) =>
    client.setActiveAccount(next),
  );
  mock.method(PublicClientApplication.prototype, 'loginRedirect', (input: unknown) =>
    client.loginRedirect(input),
  );
  mock.method(PublicClientApplication.prototype, 'logoutRedirect', (input: unknown) =>
    client.logoutRedirect(input),
  );
  mock.method(PublicClientApplication.prototype, 'acquireTokenSilent', (input: unknown) =>
    client.acquireTokenSilent(input),
  );
  mock.method(PublicClientApplication.prototype, 'acquireTokenRedirect', (input: unknown) =>
    client.acquireTokenRedirect(input),
  );
  let demo = false;
  let transport: typeof fetch = async input => {
    if (String(input) === '/api/dev-login')
      return demo ? demoResponse() : new Response('', { status: 404 });
    if (String(input) === '/api/auth/config')
      return Response.json(demo ? { enabled: false } : config);
    return Response.json({ ok: true });
  };
  mock.method(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit) =>
    transport(input, init),
  );
  // Reload only the auth entry point, retaining its real dependencies and canonical coverage URL.
  delete require.cache[require.resolve('../src/auth.ts')];
  const auth = require('../src/auth.ts') as typeof import('../src/auth');
  return {
    auth,
    client,
    calls,
    channels,
    options: () => sdkOptions,
    demo(next = true) {
      demo = next;
    },
    transport(next: typeof fetch) {
      transport = next;
    },
    clearAccount() {
      active = null;
    },
  };
}
afterEach(() => {
  mock.restoreAll();
  businessDraftHandoff.clear();
  sessionStorage.clear();
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
});
after(async () => {
  await closeBrowser();
});

test('SSO initializes without demo discovery and coalesces concurrent configuration reads', async () => {
  const f = await fixture();
  const requests: { path: string; init?: RequestInit }[] = [];
  f.transport(async (input, init) => {
    const path = String(input);
    requests.push({ path, init });
    assert.notEqual(path, '/api/dev-login');
    return Response.json(path === '/api/auth/config' ? config : { ok: true });
  });
  await Promise.all([f.auth.initializeAuth(), f.auth.initializeAuth()]);
  assert.equal(f.auth.developmentLoginState.status, 'disabled');
  assert.equal(requests.filter(r => r.path === '/api/auth/config').length, 1);
  assert.equal(f.calls.initialize, 1);
  assert.equal(f.options()?.auth.clientId, config.webClientId);
  assert.equal(f.options()?.auth.authority, `https://login.microsoftonline.com/${config.tenantId}`);
  assert.equal(f.options()?.auth.redirectUri, 'http://localhost:3000/');
  assert.equal(f.options()?.auth.postLogoutRedirectUri, 'http://localhost:3000/');
  assert.equal(f.options()?.cache.cacheLocation, 'sessionStorage');
  assert.equal(f.auth.signedIn(), true);
  const response = await f.auth.authenticatedFetch('/api/profile', {
    headers: { 'X-Revision': '5', Authorization: 'untrusted' },
  });
  assert.deepEqual(await response.json(), { ok: true });
  const headers = new Headers(requests.at(-1)!.init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer test-access-token');
  assert.equal(headers.get('X-Revision'), '5');
  assert.deepEqual(f.calls.silent[0], {
    scopes: [`api://${config.apiClientId}/access_as_user`],
    account,
  });
});

test('demo discovery avoids MSAL and uses cookie requests; expiry emits a sign-in event and clears demo state', async () => {
  const f = await fixture();
  f.demo();
  await f.auth.initializeAuth();
  assert.equal(f.auth.isDemoSession(), true);
  assert.equal(f.auth.signedIn(), true);
  assert.equal(f.calls.initialize, 0);
  let expired = 0;
  const listener = () => {
    expired++;
  };
  window.addEventListener('development-session-expired', listener);
  try {
    f.transport(async (_input, init) => {
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return new Response('', { status: 401 });
    });
    const response = await f.auth.authenticatedFetch('/api/profile');
    await response.text();
    assert.equal(expired, 1);
    assert.equal(f.auth.isDemoSession(), false);
    assert.equal(f.auth.signedIn(), false);
  } finally {
    window.removeEventListener('development-session-expired', listener);
  }
});

for (const failure of ['http', 'invalid-json', 'invalid-config', 'network']) {
  test(`SSO ${failure} configuration failure is explicit and a later attempt can recover`, async () => {
    const f = await fixture();
    let bad = true;
    f.transport(async input => {
      if (String(input) === '/api/dev-login') return new Response('', { status: 404 });
      if (!bad) return Response.json(config);
      if (failure === 'network') throw Error('Offline');
      if (failure === 'http') return new Response('', { status: 503 });
      if (failure === 'invalid-json') return new Response('invalid');
      return Response.json({ ...config, tenantId: 'not-a-uuid' });
    });
    await assert.rejects(f.auth.initializeAuth());
    assert.equal(f.auth.signInConfigured, false);
    assert.equal(f.calls.initialize, 0);
    bad = false;
    await f.auth.initializeAuth();
    assert.equal(f.auth.signInConfigured, true);
    assert.equal(f.calls.initialize, 1);
  });
}

test('disabled SSO never invents a token or a signed-in account', async () => {
  const f = await fixture();
  f.clearAccount();
  f.transport(async input =>
    String(input) === '/api/dev-login'
      ? new Response('', { status: 404 })
      : Response.json({ enabled: false }),
  );
  await f.auth.initializeAuth();
  assert.equal(f.auth.signInConfigured, false);
  assert.equal(f.auth.signedIn(), false);
  await assert.rejects(f.auth.profileToken(), /Please sign in/);
  assert.equal(f.calls.initialize, 0);
});

test('login uses explicit account selection; logout uses the active account and clears pending drafts', async () => {
  const f = await fixture();
  await f.auth.signIn({ chooseAccount: true });
  assert.deepEqual(f.calls.login, [
    { scopes: [`api://${config.apiClientId}/access_as_user`], prompt: 'select_account' },
  ]);
  const ticket = businessDraftHandoff.offer('actor', {
    kind: 'amendment_draft',
    title: 'Test',
    body: '',
    summary: '',
  });
  sessionStorage.setItem('pending-learning-draft', 'legacy');
  await f.auth.signOut();
  assert.deepEqual(f.calls.logout, [{ account }]);
  assert.equal(businessDraftHandoff.take('actor', ticket), undefined);
  assert.equal(sessionStorage.getItem('pending-learning-draft'), null);
});

for (const interaction of [false, true]) {
  test(`silent token failure ${interaction ? 'starts interaction only when required' : 'does not redirect for ordinary errors'}`, async () => {
    const f = await fixture();
    f.client.acquireTokenSilent = async () => {
      throw interaction
        ? new InteractionRequiredAuthError('interaction', 'required')
        : Error('Network failed');
    };
    await assert.rejects(f.auth.profileToken(), /Please sign in again/);
    assert.equal(f.calls.redirect.length, interaction ? 1 : 0);
  });
}

test('no active account fails before making an authenticated resource request', async () => {
  const f = await fixture();
  f.clearAccount();
  let resources = 0;
  f.transport(async input => {
    if (String(input) === '/api/dev-login') return new Response('', { status: 404 });
    if (String(input) === '/api/auth/config') return Response.json(config);
    resources++;
    return Response.json({});
  });
  await assert.rejects(f.auth.authenticatedFetch('/api/profile'), /Please sign in/);
  assert.equal(resources, 0);
});

test('direct demo login sends the chosen person/code and requires cookie verification', async () => {
  const f = await fixture();
  let selected = false;
  f.transport(async (_input, init) => {
    if (init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), {
        personId: 'person-1',
        accessCode: 'test-code',
      });
      selected = true;
      return Response.json({});
    }
    return demoResponse(selected);
  });
  await f.auth.directSignIn('person-1', 'test-code');
  assert.equal(f.auth.isDemoSession(), true);
  assert.equal(f.calls.initialize, 0);
});

for (const status of [403, 200]) {
  test(`demo login ${status === 403 ? 'rejects failed writes' : 'rejects an unverified cookie'} without claiming success`, async () => {
    const f = await fixture();
    f.transport(async (_input, init) =>
      init?.method === 'POST' ? new Response('', { status }) : demoResponse(false),
    );
    await assert.rejects(
      f.auth.directSignIn('person-1'),
      status === 403 ? /Direct login failed/ : /could not be verified/,
    );
    assert.equal(f.auth.isDemoSession(), false);
  });
}

test('demo access-code unlock validates both status and response shape', async () => {
  const f = await fixture();
  f.transport(async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { accessCode: 'code' });
    return demoResponse(false);
  });
  assert.equal((await f.auth.unlockDemoPeople('code')).signedIn, false);
  f.transport(async () => new Response('', { status: 403 }));
  await assert.rejects(f.auth.unlockDemoPeople('wrong'), /Check the demo access code/);
  f.transport(async () => Response.json({ people: [] }));
  await assert.rejects(f.auth.unlockDemoPeople('code'), /Invalid development login response/);
});

test('failed demo logout remains visible and does not navigate away', async () => {
  const f = await fixture();
  f.demo();
  await f.auth.initializeAuth();
  f.transport(async () => new Response('', { status: 500 }));
  await assert.rejects(f.auth.signOut(), /Sign-out failed/);
  assert.equal(f.auth.isDemoSession(), true);
});

test('successful demo logout notifies other tabs and navigates only after the cookie is removed', async () => {
  const f = await fixture();
  f.demo();
  await f.auth.initializeAuth();
  const navigated: string[] = [];
  mock.method(window.location, 'assign', (path: string) => navigated.push(path));
  f.transport(async (input, init) => {
    assert.equal(String(input), '/api/dev-login');
    assert.equal(init?.method, 'DELETE');
    assert.deepEqual(navigated, []);
    return new Response(null, { status: 204 });
  });
  await f.auth.signOut();
  assert.deepEqual(navigated, ['/']);
  assert.deepEqual(f.channels[0].messages, ['demo-session-changed']);
});

test('SDK initialization can be retried after failure and never reports a usable token first', async () => {
  const f = await fixture();
  let attempts = 0;
  f.client.initialize = async () => {
    if (++attempts === 1) throw Error('SDK unavailable');
  };
  await assert.rejects(f.auth.initializeAuth(), /SDK unavailable/);
  assert.equal(f.calls.silent.length, 0);
  await f.auth.initializeAuth();
  assert.equal(attempts, 2);
  assert.equal(await f.auth.profileToken(), 'test-access-token');
});

test('SDK redirect/logout failures propagate rather than looking successful', async () => {
  const f = await fixture();
  f.client.loginRedirect = async () => {
    throw Error('Login failed');
  };
  await assert.rejects(f.auth.signIn(), /Login failed/);
  f.client.logoutRedirect = async () => {
    throw Error('Logout failed');
  };
  await assert.rejects(f.auth.signOut(), /Logout failed/);
});

test('a session-change message clears pending drafts and reloads once without selecting a person', async () => {
  const f = await fixture();
  f.demo();
  await f.auth.initializeAuth();
  const ticket = businessDraftHandoff.offer('actor', {
    kind: 'demand_draft',
    title: 'Test',
    body: '',
    summary: '',
  });
  let reloads = 0;
  mock.method(window.location, 'reload', () => {
    reloads++;
  });
  f.channels[0].onmessage?.({ data: { personId: 'foreign-person' } });
  assert.equal(reloads, 0);
  f.channels[0].onmessage?.({ data: 'demo-session-changed' });
  f.channels[0].onmessage?.({ data: 'demo-session-changed' });
  assert.equal(reloads, 1);
  assert.equal(businessDraftHandoff.take('actor', ticket), undefined);
});

test('blocked legacy storage does not prevent explicit demo sign-in or logout', async () => {
  const f = await fixture();
  mock.method(sessionStorage, 'removeItem', () => {
    throw Error('Storage disabled');
  });
  f.transport(async () => demoResponse());
  await f.auth.directSignIn('person-1');
  mock.method(window.location, 'assign', () => {});
  await f.auth.signOut();
  assert.equal(f.channels[0].messages.length, 2);
});

test('concurrent demo refresh shares one discovery and subsequent refreshes observe a changed session', async () => {
  const f = await fixture();
  const pending = deferred<Response>();
  let count = 0;
  f.transport(() => {
    count++;
    return pending.promise;
  });
  const a = f.auth.refreshDevelopmentLogin();
  const b = f.auth.refreshDevelopmentLogin();
  assert.equal(a, b);
  pending.resolve(demoResponse());
  await Promise.all([a, b]);
  assert.equal(count, 1);
  f.transport(async () => demoResponse(false));
  await f.auth.refreshDevelopmentLogin();
  assert.equal(f.auth.isDemoSession(), false);
});

test('an already-aborted write is never transmitted and network errors emit an explicit toast', async () => {
  const f = await fixture();
  f.demo();
  await f.auth.initializeAuth();
  const toasts: string[] = [];
  const listener = (event: Event) =>
    toasts.push((event as CustomEvent<{ message: string }>).detail.message);
  window.addEventListener('app-toast', listener);
  let count = 0;
  f.transport(async () => {
    count++;
    throw Error('Offline');
  });
  try {
    await assert.rejects(
      f.auth.authenticatedFetch('/api/files', { method: 'POST', signal: AbortSignal.abort() }),
      { name: 'AbortError' },
    );
    assert.equal(count, 0);
    assert.equal(toasts.length, 0);
    await assert.rejects(f.auth.authenticatedFetch('/api/files', { method: 'POST' }), /Offline/);
    await settle();
    assert.deepEqual(toasts, ['Connection interrupted. Please try again.']);
  } finally {
    window.removeEventListener('app-toast', listener);
  }
});

test('session switching invalidates overlapping reads so the new actor cannot reuse an old response', async () => {
  const f = await fixture();
  f.demo();
  await f.auth.initializeAuth();
  const old = deferred<Response>();
  let actor = 'old';
  let reads = 0;
  f.transport(async (input, init) => {
    if (String(input) === '/api/dev-login') {
      if (init?.method === 'POST') actor = 'new';
      return demoResponse();
    }
    reads++;
    return actor === 'old' ? old.promise : Response.json({ actor });
  });
  const first = f.auth.authenticatedFetch('/api/profile');
  await settle();
  await f.auth.directSignIn('new-person');
  const second = await f.auth.authenticatedFetch('/api/profile');
  assert.deepEqual(await second.json(), { actor: 'new' });
  old.resolve(Response.json({ actor: 'old' }));
  assert.deepEqual(await (await first).json(), { actor: 'old' });
  assert.equal(reads, 2);
});

test('concurrent reads share transport but writes remain independent and error responses are preserved', async () => {
  const f = await fixture();
  f.demo();
  await f.auth.initializeAuth();
  const pending = deferred<Response>();
  let reads = 0;
  let writes = 0;
  f.transport(async (_input, init) => {
    if (init?.method === 'POST') {
      writes++;
      return Response.json({ error: { message: 'Conflict' } }, { status: 409 });
    }
    reads++;
    return pending.promise;
  });
  const a = f.auth.authenticatedFetch('/api/profile');
  const b = f.auth.authenticatedFetch('/api/profile');
  await settle();
  assert.equal(reads, 1);
  pending.resolve(Response.json({ actor: 'same' }));
  assert.deepEqual(await (await a).json(), { actor: 'same' });
  assert.deepEqual(await (await b).json(), { actor: 'same' });
  const responses = await Promise.all([
    f.auth.authenticatedFetch('/api/files', { method: 'POST' }),
    f.auth.authenticatedFetch('/api/files', { method: 'POST' }),
  ]);
  assert.equal(writes, 2);
  for (const response of responses) {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.message, 'Conflict');
  }
});

test('a valid company cookie restores workspace access without loading MSAL or sending a bearer', async () => {
  const f = await fixture();
  const requests: string[] = [];
  f.transport(async (input, init) => {
    const path = String(input);
    requests.push(path);
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    if (path === '/api/auth/config')
      return Response.json({ ...config, cookieSession: true, sessionActive: true });
    return Response.json({ ok: true });
  });
  await f.auth.initializeAuth();
  assert.equal(f.auth.signedIn(), true);
  const result = await f.auth.authenticatedFetch('/api/workspace', {
    headers: { Authorization: 'discard' },
  });
  assert.deepEqual(await result.json(), { ok: true });
  assert.deepEqual(requests, ['/api/auth/config', '/api/workspace']);
  assert.equal(f.calls.initialize, 0);
});

test('an Excel authorization failure leaves a verified company session signed in', async () => {
  const f = await fixture();
  const requests: string[] = [];
  f.transport(async input => {
    const path = String(input);
    requests.push(path);
    if (path === '/api/auth/config')
      return Response.json({ ...config, cookieSession: true, sessionActive: true });
    if (path === '/api/excel/catalogue/preview')
      return Response.json({ error: { message: 'Sign in to continue.' } }, { status: 401 });
    return Response.json({ ok: true });
  });
  await f.auth.initializeAuth();
  const response = await f.auth.authenticatedFetch('/api/excel/catalogue/preview', {
    method: 'POST',
  });
  assert.equal(response.status, 401);
  assert.equal(f.auth.signedIn(), true);
  assert.equal((await f.auth.authenticatedFetch('/api/workspace')).status, 200);
  assert.deepEqual(requests, [
    '/api/auth/config',
    '/api/excel/catalogue/preview',
    '/api/auth/config',
    '/api/workspace',
  ]);
});

test('a changed account pauses a stale tab without replaying a pending write', async () => {
  const { auth, transport } = await fixture();
  let writes = 0;
  transport(async (input, init) => {
    if (input === '/api/auth/config')
      return Response.json({
        ...config,
        cookieSession: true,
        backendSignIn: true,
        sessionActive: true,
        sessionSubject: 'tab-account',
      });
    assert.equal(new Headers(init?.headers).get('X-Company-Session-Subject'), 'tab-account');
    writes++;
    return new Response(null, { status: 409, headers: { 'X-Company-Session-Changed': 'true' } });
  });
  await auth.initializeAuth();
  assert.equal((await auth.authenticatedFetch('/api/workflows', { method: 'POST' })).status, 409);
  assert.equal(auth.signedIn(), false);
  await assert.rejects(
    auth.authenticatedFetch('/api/workflows', { method: 'POST' }),
    /sign in again/i,
  );
  assert.equal(writes, 1);
});

test('concurrent company initialization exchanges one bearer and expiry never retries a write', async () => {
  const f = await fixture();
  let exchanges = 0;
  let writes = 0;
  f.transport(async (input, init) => {
    const path = String(input);
    if (path === '/api/auth/config')
      return Response.json({ ...config, cookieSession: true, sessionActive: false });
    if (path === '/api/auth/session') {
      exchanges++;
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-access-token');
      return new Response(null, { status: 204 });
    }
    assert.equal(path, '/api/workflows');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    writes++;
    return new Response(null, { status: 401 });
  });
  await Promise.all([f.auth.initializeAuth(), f.auth.initializeAuth()]);
  assert.equal(exchanges, 1);
  assert.equal((await f.auth.authenticatedFetch('/api/workflows', { method: 'POST' })).status, 401);
  assert.equal(f.auth.signedIn(), false);
  assert.equal(writes, 1);
  await assert.rejects(
    f.auth.authenticatedFetch('/api/workflows', { method: 'POST' }),
    /sign in again/,
  );
  assert.equal(writes, 1);
});

test('backend-managed sign-in redirects to the server without initializing MSAL', async () => {
  const f = await fixture();
  const paths: string[] = [];
  f.transport(async input => {
    assert.equal(String(input), '/api/auth/config');
    return Response.json({
      ...config,
      cookieSession: true,
      backendSignIn: true,
      sessionActive: false,
    });
  });
  mock.method(window.location, 'assign', (path: string) => paths.push(path));
  await f.auth.initializeAuth();
  assert.equal(f.auth.signedIn(), false);
  await f.auth.signIn();
  assert.deepEqual(paths, ['/api/auth/login?mode=default&returnTo=%2F']);
  await f.auth.signIn({ chooseAccount: true });
  assert.equal(paths[1], '/api/auth/login?mode=choose&returnTo=%2F');
  const replacements: string[] = [];
  mock.method(window.location, 'replace', (path: string) => replacements.push(path));
  try {
    for (const result of ['failed', 'company-required', 'signed-out']) {
      window.history.replaceState(null, '', '/?signin=' + result);
      await f.auth.initializeAuth({ automatic: true });
      assert.deepEqual(replacements, []);
    }
    window.history.replaceState(null, '', '/');
    await Promise.all([
      f.auth.initializeAuth({ automatic: true }),
      f.auth.initializeAuth({ automatic: true }),
    ]);
    assert.deepEqual(replacements, ['/api/auth/login?mode=silent&returnTo=%2F']);
  } finally {
    window.history.replaceState(null, '', '/');
  }
  assert.equal(f.calls.initialize, 0);
});

test('backend logout revokes the cookie and uses the registered Web return without loading MSAL', async () => {
  const f = await fixture();
  const paths: string[] = [];
  f.transport(async (input, init) => {
    if (String(input) === '/api/auth/config')
      return Response.json({
        ...config,
        cookieSession: true,
        backendSignIn: true,
        sessionActive: true,
      });
    assert.equal(String(input), '/api/auth/session');
    assert.equal(init?.method, 'DELETE');
    assert.deepEqual(paths, []);
    return Response.json({ logoutHint: 'opaque-account-hint' });
  });
  mock.method(window.location, 'assign', (path: string) => paths.push(path));
  await f.auth.signOut();
  assert.equal(f.auth.signedIn(), false);
  assert.equal(f.calls.initialize, 0);
  const logout = new URL(paths[0]);
  assert.equal(logout.origin, 'https://login.microsoftonline.com');
  assert.equal(logout.searchParams.get('logout_hint'), 'opaque-account-hint');
  assert.equal(
    logout.searchParams.get('post_logout_redirect_uri'),
    'http://localhost:3000/api/auth/signed-out',
  );
});
