// Synthetic identity-provider adapter used only by e2e/vite.config.ts.
// Never imported by the production config or included in the release source ZIP.
export class InteractionRequiredAuthError extends Error {}
const account = {
  homeAccountId: 'synthetic',
  environment: 'synthetic.test',
  tenantId: '11111111-1111-4111-8111-111111111111',
  username: 'synthetic@example.test',
  localAccountId: 'synthetic',
};
export class PublicClientApplication {
  async initialize() {}
  async handleRedirectPromise() {
    return null;
  }
  getActiveAccount() {
    return sessionStorage.getItem('synthetic-signed-out') ? null : account;
  }
  getAllAccounts() {
    return this.getActiveAccount() ? [account] : [];
  }
  setActiveAccount() {}
  async acquireTokenSilent() {
    return { accessToken: 'synthetic-e2e-access-token' };
  }
  async acquireTokenRedirect() {
    throw new Error('Unexpected interactive acquisition in synthetic test');
  }
  async loginRedirect() {
    sessionStorage.removeItem('synthetic-signed-out');
    location.assign('/');
  }
  async logoutRedirect() {
    if ((window as any).__syntheticSignoutFailure) throw new Error('Synthetic sign-out failure');
    sessionStorage.setItem('synthetic-signed-out', 'true');
    location.assign('/');
  }
}
