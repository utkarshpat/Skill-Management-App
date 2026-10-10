import type { PublicClientApplication } from '@azure/msal-browser';

type Client = Pick<
  PublicClientApplication,
  | 'initialize'
  | 'handleRedirectPromise'
  | 'getActiveAccount'
  | 'getAllAccounts'
  | 'setActiveAccount'
  | 'loginRedirect'
  | 'logoutRedirect'
  | 'acquireTokenSilent'
  | 'acquireTokenRedirect'
>;
interface Sdk {
  createClient(): Client;
  requiresInteraction(error: unknown): boolean;
}
// Loading/initialization is shared, but rejected initialization remains retryable.
// The SDK continues to own account selection and token caching/refresh.
export function createMicrosoftSession(load: () => Promise<Sdk>) {
  let sdk: Sdk | undefined, client: Client | undefined, ready: Promise<void> | undefined;
  return {
    get client() {
      return client;
    },
    requiresInteraction: (error: unknown) => sdk?.requiresInteraction(error) ?? false,
    initialize: () => {
      if (!ready) {
        const pending = (async () => {
          sdk ??= await load();
          client ??= sdk.createClient();
          await client.initialize();
          const result = await client.handleRedirectPromise();
          if (result) client.setActiveAccount(result.account);
          if (!client.getActiveAccount() && client.getAllAccounts().length === 1)
            client.setActiveAccount(client.getAllAccounts()[0]);
        })().catch(error => {
          if (ready === pending) ready = undefined;
          throw error;
        });
        ready = pending;
      }
      return ready;
    },
  };
}
