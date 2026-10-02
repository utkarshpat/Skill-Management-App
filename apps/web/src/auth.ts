import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

const tenant = import.meta.env.VITE_ENTRA_TENANT_ID;
const web = import.meta.env.VITE_ENTRA_WEB_CLIENT_ID;
const api = import.meta.env.VITE_ENTRA_API_CLIENT_ID;
const redirectUri = import.meta.env.VITE_AUTH_REDIRECT_URI ?? window.location.origin + '/';
export const signInConfigured = Boolean(tenant && web && api);
const client = signInConfigured ? new PublicClientApplication({
  auth: { clientId: web, authority: `https://login.microsoftonline.com/${tenant}`, redirectUri, postLogoutRedirectUri: redirectUri },
  cache: { cacheLocation: 'sessionStorage' },
}) : undefined;
const scopes = [`api://${api}/access_as_user`];
let ready: Promise<void> | undefined;
let demoSession = false;
export interface DemoPerson { id: string; displayName: string; employeeCode: string; roles: string[] }
export let developmentPeople: DemoPerson[] = [];
export function isDemoSession() { return demoSession; }
export async function directSignIn(personId: string) {
  const response = await fetch('/api/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId }) });
  if (!response.ok) throw new Error('Direct login failed.');
  window.location.assign('/');
}
export function initializeAuth() {
  return ready ??= (async () => {
    const demoResponse = await fetch('/api/dev-login', {signal:AbortSignal.timeout(45000)}).catch(() => undefined);
    if (demoResponse?.ok) {
      const data = await demoResponse.json();
      developmentPeople = data.people; demoSession = data.signedIn === true;
      if (demoSession) return;
    }
    if (!client) return;
    await client.initialize();
    const result = await client.handleRedirectPromise();
    if (result) client.setActiveAccount(result.account);
    if (!client.getActiveAccount() && client.getAllAccounts().length === 1) client.setActiveAccount(client.getAllAccounts()[0]);
  })();
}
export function signedIn() { return demoSession || Boolean(client?.getActiveAccount()); }
export async function signIn() { await initializeAuth(); await client?.loginRedirect({ scopes, prompt: 'select_account' }); }
export async function signOut() {
  await initializeAuth();
  if (demoSession) {
    const response = await fetch('/api/dev-login', { method: 'DELETE' });
    if (!response.ok) throw new Error('Sign-out failed.');
    window.location.assign('/'); return;
  }
  await client?.logoutRedirect({ account: client.getActiveAccount() });
}
export async function profileToken() {
  await initializeAuth();
  const account = client?.getActiveAccount();
  if (!client || !account) throw new Error('Please sign in.');
  try { return (await client.acquireTokenSilent({ scopes, account })).accessToken; }
  catch (error) {
    if (error instanceof InteractionRequiredAuthError) await client.acquireTokenRedirect({ scopes, account });
    throw new Error('Please sign in again to continue.');
  }
}
