import { businessDraftHandoff } from './business/business-draft-handoff';
import { InflightReads } from './inflight-reads';
import { learningDraftHandoff } from './learning-draft-handoff';
import { notifyResponse, notify } from './toast';
import { createMicrosoftSession } from './microsoft-session';
import { discoverDevelopmentLogin, parseDemoLogin, type DemoLoginState } from './development-login';
import { connectDemoSessionChanges } from './demo-session-sync';
import { parseSignInConfig } from './sign-in-config';

let tenant = '',
  web = '',
  api = '';
const redirectUri = window.location.origin + '/';
export let signInConfigured = false;
let configuration: Promise<void> | undefined;
let cookieSessionEnabled = false;
let backendSignIn = false;
let automaticSignInStarted = false;
let companySession = false;
let sessionExpired = false;
let openingCompanySession: Promise<void> | undefined;
function configureSignIn() {
  return (configuration ??= (async () => {
    const response = await fetch('/api/auth/config', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Sign-in configuration unavailable.');
    const body = await response.json();
    const config = parseSignInConfig(body);
    cookieSessionEnabled = Boolean(config) && body.cookieSession === true;
    companySession = cookieSessionEnabled && body.sessionActive === true;
    backendSignIn = cookieSessionEnabled && body.backendSignIn === true;
    tenant = config?.tenantId ?? '';
    web = config?.webClientId ?? '';
    api = config?.apiClientId ?? '';
    signInConfigured = Boolean(config);
  })().catch(error => {
    configuration = undefined;
    throw error;
  }));
}
const microsoft = createMicrosoftSession(async () => {
  const sdk = await import('@azure/msal-browser');
  return {
    createClient: () =>
      new sdk.PublicClientApplication({
        auth: {
          clientId: web,
          authority: `https://login.microsoftonline.com/${tenant}`,
          redirectUri,
          postLogoutRedirectUri: redirectUri,
        },
        cache: { cacheLocation: 'sessionStorage' },
      }),
    requiresInteraction: error => error instanceof sdk.InteractionRequiredAuthError,
  };
});
const scopes = () => [`api://${api}/access_as_user`];
let ready: Promise<void> | undefined;
let demoSession = false;
export let developmentLoginState: DemoLoginState = {
  status: 'disabled',
  people: [],
  signedIn: false,
};
let discovery: Promise<DemoLoginState> | undefined;
let sessionSync: ReturnType<typeof connectDemoSessionChanges> | undefined;
const demoSessionSync = () =>
  (sessionSync ??= connectDemoSessionChanges(() => {
    reads.invalidate();
    learningDraftHandoff.clear();
    businessDraftHandoff.clear();
    window.location.reload();
  }));
export function refreshDevelopmentLogin() {
  return (discovery ??= (async () => {
    try {
      const state = await discoverDevelopmentLogin();
      developmentLoginState = state;
      demoSession = state.signedIn;
      return state;
    } finally {
      discovery = undefined;
    }
  })());
}
export function isDemoSession() {
  return demoSession;
}
export async function unlockDemoPeople(accessCode: string) {
  const response = await fetch('/api/dev-login/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessCode }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error('Check the demo access code and try again.');
  return parseDemoLogin(await response.json());
}
export async function directSignIn(personId: string, accessCode?: string) {
  learningDraftHandoff.clear();
  businessDraftHandoff.clear();
  try {
    sessionStorage.removeItem('pending-learning-draft');
  } catch {
    /* Legacy handoff is never consumed. */
  }
  const response = await fetch('/api/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personId, accessCode }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error('Direct login failed.');
  reads.invalidate();
  demoSessionSync().changed();
  await refreshDevelopmentLogin();
  if (!demoSession) throw new Error('Demo session could not be verified.');
}
export async function initializeAuth({ automatic = false } = {}) {
  if (demoSession) return;
  await configureSignIn();
  if (signInConfigured) {
    if (companySession || sessionExpired) return;
    if (backendSignIn) {
      const result = new URLSearchParams(window.location.search).get('signin');
      if (automatic && !result && !automaticSignInStarted) {
        automaticSignInStarted = true;
        window.location.replace(companyLoginPath('silent'));
      }
      return;
    }
    await microsoft.initialize();
    const account = microsoft.client?.getActiveAccount();
    if (cookieSessionEnabled && account) {
      await (openingCompanySession ??= (async () => {
        const token = await acquireProfileToken();
        const response = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw Error('Company session could not be started.');
        companySession = true;
      })().finally(() => {
        openingCompanySession = undefined;
      }));
    }
    return;
  }
  demoSessionSync();
  await (ready ??= refreshDevelopmentLogin()
    .then(() => undefined)
    .catch(error => {
      ready = undefined;
      throw error;
    }));
}
export function signedIn() {
  return (
    demoSession ||
    companySession ||
    (!sessionExpired && Boolean(microsoft.client?.getActiveAccount()))
  );
}
function companyLoginPath(mode: 'silent' | 'choose' | 'default') {
  const query = new URLSearchParams(window.location.search);
  query.delete('signin');
  const search = query.toString();
  const returnTo = window.location.pathname + (search ? '?' + search : '') + window.location.hash;
  const options = new URLSearchParams({ mode, returnTo });
  return '/api/auth/login?' + options;
}
export async function signIn({ chooseAccount = false } = {}) {
  await configureSignIn();
  if (backendSignIn) {
    // Page-load SSO is attempted separately with prompt=none. This button is
    // the interactive fallback shown on the sign-in page.
    window.location.assign(companyLoginPath(chooseAccount ? 'choose' : 'default'));
    return;
  }
  await initializeAuth();
  if (signInConfigured) await microsoft.initialize();
  await microsoft.client?.loginRedirect({
    scopes: scopes(),
    ...(chooseAccount ? { prompt: 'select_account' } : {}),
  });
}
export async function signOut() {
  reads.invalidate();
  learningDraftHandoff.clear();
  businessDraftHandoff.clear();
  try {
    sessionStorage.removeItem('pending-learning-draft');
  } catch {
    /* Legacy handoff is never consumed. */
  }
  await initializeAuth();
  if (demoSession) {
    const response = await fetch('/api/dev-login', { method: 'DELETE' });
    if (!response.ok) throw new Error('Sign-out failed.');
    demoSessionSync().changed();
    window.location.assign('/');
    return;
  }
  if (cookieSessionEnabled) {
    const response = await fetch('/api/auth/session', {
      method: 'DELETE',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Sign-out failed.');
    companySession = false;
    sessionExpired = true;
    if (backendSignIn) {
      const logout = new URL('https://login.microsoftonline.com/' + tenant + '/oauth2/v2.0/logout');
      logout.searchParams.set(
        'post_logout_redirect_uri',
        new URL('/api/auth/signed-out', redirectUri).href,
      );
      if (response.status === 200) {
        const { logoutHint } = await response.json();
        if (typeof logoutHint === 'string' && logoutHint)
          logout.searchParams.set('logout_hint', logoutHint);
      }
      window.location.assign(logout.toString());
      return;
    }
    await microsoft.initialize();
  }
  await microsoft.client?.logoutRedirect({ account: microsoft.client.getActiveAccount() });
}
export async function profileToken() {
  await initializeAuth();
  return acquireProfileToken();
}
async function acquireProfileToken() {
  const client = microsoft.client;
  const account = client?.getActiveAccount();
  if (!client || !account) throw new Error('Please sign in.');
  try {
    return (await client.acquireTokenSilent({ scopes: scopes(), account })).accessToken;
  } catch (error) {
    if (microsoft.requiresInteraction(error))
      await client.acquireTokenRedirect({ scopes: scopes(), account });
    throw new Error('Please sign in again to continue.');
  }
}
const reads = new InflightReads(async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!init?.signal?.aborted) notify('Connection interrupted. Please try again.', 'error');
    throw error;
  }
});
export async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!isDemoSession()) await initializeAuth();
  const hadCompanySession = companySession;
  if (hadCompanySession) headers.delete('Authorization');
  else if (!isDemoSession()) {
    if (sessionExpired || backendSignIn) throw Error('Please sign in again to continue.');
    headers.set('Authorization', 'Bearer ' + (await acquireProfileToken()));
  }
  const wasDemo = isDemoSession();
  const response = await reads.fetch(path, {
    ...init,
    headers,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(90000)])
      : AbortSignal.timeout(90000),
  });
  if (wasDemo && response.status === 401) {
    demoSession = false;
    window.dispatchEvent(new Event('development-session-expired'));
  }
  if (hadCompanySession && companySession && response.status === 401) {
    companySession = false;
    sessionExpired = true;
    reads.invalidate();
    window.dispatchEvent(new Event('company-session-expired'));
  }
  void notifyResponse(path, (init.method ?? 'GET').toUpperCase(), response);
  return response;
}
