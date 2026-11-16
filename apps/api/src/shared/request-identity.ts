import type { Request } from 'express';

type Identity = { tenantId: string; objectId: string };
const identities = new WeakMap<Request, Identity>();

export function setSessionIdentity(req: Request, identity: Identity) {
  identities.set(req, identity);
}

export function verifyRequestIdentity(
  req: Request,
  verify: (authorization: string | undefined) => Promise<Identity>,
): Promise<Identity> {
  const identity = identities.get(req);
  return identity ? Promise.resolve(identity) : verify(req.headers.authorization);
}
