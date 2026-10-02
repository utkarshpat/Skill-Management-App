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
export function initializeAuth() {
  return ready ??= (async () => {
    if (!client) return;
    await client.initialize();
    const result = await client.handleRedirectPromise();
    if (result) client.setActiveAccount(result.account);
    if (!client.getActiveAccount() && client.getAllAccounts().length === 1) client.setActiveAccount(client.getAllAccounts()[0]);
  })();
}
export function signedIn() { return Boolean(client?.getActiveAccount()); }
export async function signIn() { await initializeAuth(); await client?.loginRedirect({ scopes, prompt: 'select_account' }); }
export async function signOut() { await initializeAuth(); await client?.logoutRedirect({ account: client.getActiveAccount() }); }
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
