import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { localRequest, localMutation } from '../../shared/http-security.js';
export { localRequest, localMutation } from '../../shared/http-security.js';
import { can, readActorAccess, type AccessStore } from '../access/index.js';
export interface HostedDemoConfig {
  origin: string;
  accessCode: string;
  sessionSecret: string;
}
export function hostedDemoConfig(env: NodeJS.ProcessEnv): HostedDemoConfig | undefined {
  if (env.HOSTED_DEMO_LOGIN !== 'true') return undefined;
  const origin = env.PUBLIC_APP_ORIGIN ?? '';
  const url = new URL(origin);
  if (
    env.NODE_ENV !== 'production' ||
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    (env.DEMO_LOGIN_ACCESS_CODE?.length ?? 0) < 4 ||
    (env.DEMO_SESSION_SECRET?.length ?? 0) < 32
  ) {
    throw new Error(
      'Hosted demo requires a production HTTPS origin, an access code of at least 4 characters and a signing secret of at least 32 characters.',
    );
  }
  return {
    origin,
    accessCode: env.DEMO_LOGIN_ACCESS_CODE!,
    sessionSecret: env.DEMO_SESSION_SECRET!,
  };
}
export function developmentLoginEnabled(env: NodeJS.ProcessEnv) {
  if (env.DEV_DIRECT_LOGIN !== 'true') return false;
  if (env.NODE_ENV !== 'development')
    throw new Error('Direct login requires NODE_ENV=development.');
  return true;
}
export function createDevelopmentSessions(
  store: AccessStore,
  now = Date.now,
  hosted?: HostedDemoConfig,
) {
  const sessions = new Map<string, { personId: string; started: number; expires: number }>();
  const cookieName = 'skill_dev_session';
  const lifetime = 30 * 60 * 1000;
  const maxLifetime = 8 * 60 * 60 * 1000;
  const requestAllowed = (req: Request) =>
    hosted ? req.get('host') === new URL(hosted.origin).host : localRequest(req);
  const mutationAllowed = (req: Request) =>
    hosted ? requestAllowed(req) && req.get('Origin') === hosted.origin : localMutation(req);
  const signature = (value: string) =>
    createHmac('sha256', hosted!.sessionSecret + ':' + hosted!.accessCode)
      .update(value)
      .digest('base64url');
  const constantMatch = (left: string, right: string) => {
    const a = createHmac('sha256', 'demo-comparison').update(left).digest();
    const b = createHmac('sha256', 'demo-comparison').update(right).digest();
    return timingSafeEqual(a, b);
  };
  const token = (req: Request) =>
    req
      .get('Cookie')
      ?.split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  const sweep = () => {
    for (const [key, session] of sessions) if (session.expires <= now()) sessions.delete(key);
  };
  const session = (req: Request, issuedToken?: string) => {
    sweep();
    if (!requestAllowed(req)) return undefined;
    const value = issuedToken ?? token(req);
    if (!value) return undefined;
    if (!hosted) return sessions.get(value);
    if (value.length > 1024) return undefined;
    const [payload, mac, ...extra] = value.split('.');
    if (!payload || !mac || extra.length || !constantMatch(mac, signature(payload)))
      return undefined;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      // Existing 30-minute cookies can renew without forcing a rollout logout.
      const started = data.started ?? data.issued;
      if (
        data.version !== 1 ||
        data.origin !== hosted.origin ||
        typeof data.personId !== 'string' ||
        !Number.isSafeInteger(data.issued) ||
        !Number.isSafeInteger(data.expires) ||
        data.issued > now() ||
        data.expires <= now() ||
        !Number.isSafeInteger(started) ||
        started > data.issued ||
        data.expires <= data.issued ||
        data.expires - data.issued > lifetime ||
        data.expires > started + maxLifetime
      )
        return undefined;
      return {
        personId: data.personId as string,
        started: started as number,
        expires: data.expires as number,
      };
    } catch {
      return undefined;
    }
  };
  const subject = (req: Request) => session(req)?.personId;
  const person = async (req: Request) => {
    const id = subject(req);
    const user = id ? await store.person(id) : undefined;
    return user?.entraObjectId ? undefined : user;
  };
  return {
    cookieName,
    lifetime,
    maxLifetime,
    timing(req: Request) {
      const current = session(req);
      return current
        ? { expiresAt: current.expires, absoluteExpiresAt: current.started + maxLifetime }
        : undefined;
    },
    person,
    requestAllowed,
    mutationAllowed,
    secure: Boolean(hosted),
    requiresAccessCode: Boolean(hosted),
    authorizeCode(value: unknown) {
      return (
        !hosted ||
        (typeof value === 'string' &&
          value.length <= 256 &&
          constantMatch(value, hosted.accessCode))
      );
    },
    subject,
    async issue(id: string, startedAt?: number) {
      sweep();
      const user = await store.person(id);
      const issued = now(),
        started = startedAt ?? issued;
      if (
        !user ||
        !user.active ||
        user.entraObjectId ||
        issued >= started + maxLifetime ||
        (!hosted && sessions.size >= 100 && startedAt === undefined)
      )
        return undefined;
      if (hosted) {
        const payload = Buffer.from(
          JSON.stringify({
            version: 1,
            personId: id,
            origin: hosted.origin,
            issued,
            started,
            expires: Math.min(issued + lifetime, started + maxLifetime),
            nonce: randomBytes(16).toString('hex'),
          }),
        ).toString('base64url');
        return payload + '.' + signature(payload);
      }
      const value = randomBytes(32).toString('hex');
      sessions.set(value, {
        personId: id,
        started,
        expires: Math.min(issued + lifetime, started + maxLifetime),
      });
      return value;
    },
    async renew(req: Request) {
      const current = session(req);
      if (!current) return undefined;
      const value = await this.issue(current.personId, current.started);
      if (!value) return undefined;
      const renewed = session(req, value);
      if (!renewed) return undefined;
      this.revoke(req);
      return {
        value,
        expiresAt: renewed.expires,
        absoluteExpiresAt: current.started + maxLifetime,
      };
    },
    revoke(req: Request) {
      const value = token(req);
      if (value) sessions.delete(value);
    },
    async profile(req: Request) {
      const id = subject(req);
      if (!id) return undefined;
      const state = await readActorAccess(store, id);
      const user = state.people.find(person => person.id === id && person.active);
      if (!user || user.entraObjectId || !can(state, user, 'profile.view', true)) return undefined;
      return {
        id: user.id,
        displayName: user.displayName,
        employeeCode: user.employeeCode,
        jobTitle: user.jobTitle ?? null,
        grade: user.grade ?? null,
        primaryCapabilityId: user.primaryCapabilityId,
        primaryCapabilityName: user.primaryCapabilityName,
        primaryCapabilityStatus: user.primaryCapabilityStatus,
        organization: 'Development Workspace',
        status: 'ACTIVE',
        canViewSkills: can(state, user, 'skill.view') || can(state, user, 'skill.catalogue.manage'),
        roles: state.roles.filter(role => user.roleIds.includes(role.id)).map(role => role.name),
      };
    },
  };
}
