import type { ClientSecretCredential } from '@azure/identity';
import { measureDatabasePhase } from './request-timing.js';

// Preserve the SDK credential's token caching, refresh and cancellation behavior.
// Record elapsed time only; never inspect or log the returned token/options.
export function timedSqlCredential(credential: Pick<ClientSecretCredential, 'getToken'>) {
  return {
    getToken: (...args: Parameters<ClientSecretCredential['getToken']>) =>
      measureDatabasePhase('token', () => credential.getToken(...args)),
  };
}
