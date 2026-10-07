export { identityConfig, tokenVerifier, type Identity } from './auth.js';
export { ownProfile, type Profile } from './profile.js';
export {
  createDevelopmentSessions,
  developmentLoginEnabled,
  hostedDemoConfig,
} from './development-login.js';
export type { HostedDemoConfig } from './development-login.js';
export type DevelopmentSessions = ReturnType<
  typeof import('./development-login.js').createDevelopmentSessions
>;
