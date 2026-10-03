import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';
import { discoverDevelopmentLogin, parseDemoLogin, type DemoLoginState } from './development-login';

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
export let developmentLoginState:DemoLoginState={status:'error',people:[],signedIn:false};
let discovery:Promise<DemoLoginState>|undefined;
export function refreshDevelopmentLogin(){
  return discovery??=(async()=>{try{const state=await discoverDevelopmentLogin();developmentLoginState=state;demoSession=state.signedIn;return state;}finally{discovery=undefined;}})();
}
export function isDemoSession() { return demoSession; }
export async function unlockDemoPeople(accessCode: string) {
  const response=await fetch('/api/dev-login/people',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessCode}),signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error('Check the demo access code and try again.');
  return parseDemoLogin(await response.json());
}
export async function directSignIn(personId: string, accessCode?: string) {
  const response = await fetch('/api/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId, accessCode }),signal:AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error('Direct login failed.');
  window.location.assign('/');
}
export function initializeAuth() {
  return ready ??= (async () => {
    await refreshDevelopmentLogin();
    if (demoSession) return;
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
export async function authenticatedFetch(path:string,init:RequestInit={}) {
  const headers=new Headers(init.headers);
  if(!isDemoSession())headers.set('Authorization',`Bearer ${await profileToken()}`);
  const wasDemo=isDemoSession();
  const response=await fetch(path,{...init,headers,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});
  if(wasDemo&&response.status===401){demoSession=false;window.dispatchEvent(new Event('development-session-expired'));}
  return response;
}
