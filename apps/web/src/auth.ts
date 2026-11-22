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
let companySubject: string | undefined;
let sessionExpired = false;
let openingCompanySession: Promise<void> | undefined;
let companySessionCheck: Promise<void> | undefined;

function pauseCompanySession() {
  if (!companySession) return;
  companySession = false;
  sessionExpired = true;
  reads.invalidate();
  window.dispatchEvent(new Event('company-session-expired'));
}

function confirmCompanySessionExpiry() {
  return (companySessionCheck ??= (async () => {
    try {
      const response = await fetch('/api/auth/config', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;
      const state = await response.json();
      if (!companySession || state.cookieSession !== true || state.sessionActive !== false) return;
      pauseCompanySession();
    } catch {
      // A failed verification cannot determine the current session state.
    }
  })().finally(() => {
    companySessionCheck = undefined;
  }));
}
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
    companySubject = typeof body.sessionSubject === 'string' ? body.sessionSubject : undefined;
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
export function companyResumePath(chooseAccount = false) {
  if (!backendSignIn || !companySubject) return undefined;
  return (
    '/api/auth/login?' +
    new URLSearchParams({
      mode: chooseAccount ? 'choose' : 'default',
      returnTo: '/api/auth/resume-complete',
    })
  );
}
export async function resumeCompanySession() {
  if (!backendSignIn || !companySubject) return false;
  const response = await fetch('/api/auth/config', {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Company sign-in could not be verified. Try again.');
  const state = await response.json();
  if (!state.sessionActive) throw Error('Complete Microsoft sign-in in the other tab first.');
  if (state.sessionSubject !== companySubject) return false;
  sessionExpired = false;
  companySession = true;
  return true;
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
      ...(companySubject ? { headers: { 'X-Company-Session-Subject': companySubject } } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (response.headers.get('X-Company-Session-Changed') === 'true') pauseCompanySession();
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
  if (hadCompanySession) {
    headers.delete('Authorization');
    if (companySubject) headers.set('X-Company-Session-Subject', companySubject);
  } else if (!isDemoSession()) {
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
    await confirmCompanySessionExpiry();
  }
  if (hadCompanySession && response.headers.get('X-Company-Session-Changed') === 'true') {
    pauseCompanySession();
  }
  void notifyResponse(path, (init.method ?? 'GET').toUpperCase(), response);
  return response;
}
