import type { Request } from 'express';

export interface RequestIdentity {
  tenantId: string;
  objectId: string;
  workEmail?: string;
}
const identities = new WeakMap<Request, RequestIdentity>();

export function setSessionIdentity(req: Request, identity: RequestIdentity) {
  identities.set(req, identity);
}

export function verifyRequestIdentity(
  req: Request,
  verify: (authorization: string | undefined) => Promise<RequestIdentity>,
): Promise<RequestIdentity> {
  const identity = identities.get(req);
  return identity ? Promise.resolve(identity) : verify(req.headers.authorization);
}
