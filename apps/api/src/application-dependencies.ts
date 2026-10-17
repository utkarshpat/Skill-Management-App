import type { AppDependencies } from './create-app.js';
import { tokenVerifier, type IdentityConfig } from './modules/identity/auth.js';

// Temporary sessions authenticate through the existing route middleware. Without
// Entra configuration, arbitrary bearer tokens must never establish an identity.
export function applicationDependencies(
  config: IdentityConfig | undefined,
  temporaryLoginEnabled: boolean,
  services: Omit<AppDependencies, 'verify'>,
): AppDependencies | undefined {
  if (!config && !temporaryLoginEnabled) return undefined;
  return {
    ...services,
    verify: config
      ? tokenVerifier(config)
      : async () => {
          throw new Error('Microsoft sign-in is not configured.');
        },
  };
}
