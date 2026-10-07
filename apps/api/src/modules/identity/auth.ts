import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Identity {
  tenantId: string;
  objectId: string;
}
export interface IdentityConfig {
  tenantId: string;
  apiClientId: string;
  webClientId: string;
}
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identityConfig(env: NodeJS.ProcessEnv): IdentityConfig | undefined {
  const ids = [env.ENTRA_TENANT_ID, env.ENTRA_API_CLIENT_ID, env.ENTRA_WEB_CLIENT_ID];
  if (ids.every(id => !id)) return undefined;
  if (!ids.every(id => typeof id === 'string' && guid.test(id)))
    throw new Error('Entra tenant/API/web IDs must be UUIDs.');
  return { tenantId: ids[0]!, apiClientId: ids[1]!, webClientId: ids[2]! };
}

export function tokenVerifier(config: IdentityConfig, key?: JWTVerifyGetKey) {
  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
  const signingKey =
    key ??
    createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`),
      { timeoutDuration: 5000 },
    );
  return async (authorization: string | undefined): Promise<Identity> => {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    if (!match || match[1].length > 16384) throw new Error('Invalid authorization');
    const { payload } = await jwtVerify(match[1], signingKey, {
      issuer,
      audience: config.apiClientId,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'nbf', 'tid', 'oid', 'scp', 'azp', 'ver'],
      clockTolerance: 5,
    });
    if (
      payload.tid !== config.tenantId ||
      payload.azp !== config.webClientId ||
      payload.ver !== '2.0' ||
      typeof payload.oid !== 'string' ||
      !guid.test(payload.oid) ||
      typeof payload.scp !== 'string' ||
      !payload.scp.split(' ').includes('access_as_user')
    )
      throw new Error('Invalid token claims');
    return { tenantId: config.tenantId, objectId: payload.oid };
  };
}
