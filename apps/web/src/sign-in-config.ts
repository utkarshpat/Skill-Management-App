export interface SignInConfig {
  tenantId: string;
  apiClientId: string;
  webClientId: string;
}
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseSignInConfig(value: unknown): SignInConfig | undefined {
  if (!value || typeof value !== 'object') throw new Error('Sign-in configuration unavailable.');
  const input = value as Record<string, unknown>;
  if (input.enabled === false) return undefined;
  if (
    input.enabled !== true ||
    !['tenantId', 'apiClientId', 'webClientId'].every(
      key => typeof input[key] === 'string' && guid.test(input[key] as string),
    )
  )
    throw new Error('Sign-in configuration unavailable.');
  return {
    tenantId: String(input.tenantId).toLowerCase(),
    apiClientId: String(input.apiClientId).toLowerCase(),
    webClientId: String(input.webClientId).toLowerCase(),
  };
}
