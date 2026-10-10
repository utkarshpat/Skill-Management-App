import { businessDraftHandoff } from './business/business-draft-handoff';
import { InflightReads } from './inflight-reads';
import { learningDraftHandoff } from './learning-draft-handoff';
import { notifyResponse, notify } from './toast';
import { createMicrosoftSession } from './microsoft-session';
import { discoverDevelopmentLogin, parseDemoLogin, type DemoLoginState } from './development-login';

const tenant = import.meta.env.VITE_ENTRA_TENANT_ID;
const web = import.meta.env.VITE_ENTRA_WEB_CLIENT_ID;
const api = import.meta.env.VITE_ENTRA_API_CLIENT_ID;
const redirectUri = import.meta.env.VITE_AUTH_REDIRECT_URI ?? window.location.origin + '/';
export const signInConfigured = Boolean(tenant && web && api);
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
const scopes = [`api://${api}/access_as_user`];
let ready: Promise<void> | undefined;
let demoSession = false;
export let developmentLoginState: DemoLoginState = { status: 'error', people: [], signedIn: false };
let discovery: Promise<DemoLoginState> | undefined;
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
  await refreshDevelopmentLogin();
  if (!demoSession) throw new Error('Demo session could not be verified.');
}
export async function initializeAuth() {
  await (ready ??= refreshDevelopmentLogin()
    .then(() => undefined)
    .catch(error => {
      ready = undefined;
      throw error;
    }));
  if (!demoSession && signInConfigured) await microsoft.initialize();
}
export function signedIn() {
  return demoSession || Boolean(microsoft.client?.getActiveAccount());
}
export async function signIn() {
  await initializeAuth();
  if (signInConfigured) await microsoft.initialize();
  await microsoft.client?.loginRedirect({ scopes, prompt: 'select_account' });
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
    window.location.assign('/');
    return;
  }
  await microsoft.client?.logoutRedirect({ account: microsoft.client.getActiveAccount() });
}
export async function profileToken() {
  await initializeAuth();
  const client = microsoft.client;
  const account = client?.getActiveAccount();
  if (!client || !account) throw new Error('Please sign in.');
  try {
    return (await client.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (error) {
    if (microsoft.requiresInteraction(error))
      await client.acquireTokenRedirect({ scopes, account });
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
  if (!isDemoSession()) headers.set('Authorization', `Bearer ${await profileToken()}`);
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
  void notifyResponse(path, (init.method ?? 'GET').toUpperCase(), response);
  return response;
}
