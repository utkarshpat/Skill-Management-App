import { setSessionIdentity } from '../../shared/request-identity.js';
import { errorType, logEvent } from '../../shared/logger.js';
import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { decodeJwt } from 'jose';
import type { Identity } from './auth.js';
import { memoryCompanyAuthState, type CompanyAuthState } from './company-auth-state.js';
import { AccessError } from '../../shared/errors.js';

export type CompanySession = { identity: Identity; expiresAt: number; logoutHint?: string };

const cookieName = '__Host-skill-session';
const loginHintCookieName = '__Host-skill-login-hint';
const cookie = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;
const hintCookie = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
const lifetime = 8 * 60 * 60 * 1000;
const loginHintLifetime = 30 * 24 * 60 * 60 * 1000;
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const subjectHeader = 'X-Company-Session-Subject';

function identitySubject(identity: Identity) {
  return createHash('sha256').update(`${identity.tenantId}:${identity.objectId}`).digest('hex');
}

function subjectChanged(req: Request, res: Response, entry: CompanySession) {
  const expected = req.get(subjectHeader);
  if (expected === undefined || expected === identitySubject(entry.identity)) return false;
  res.set('Cache-Control', 'no-store');
  res.set('X-Company-Session-Changed', 'true');
  res.status(409).json({ error: { message: 'The Microsoft account changed in another tab.' } });
  return true;
}

export function registerCompanySessions(
  app: Express,
  origin: string,
  verify: ((authorization: string | undefined) => Promise<Identity>) | undefined,
  now = Date.now,
  sessions: CompanyAuthState<CompanySession> = memoryCompanyAuthState(now),
) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin)
    throw Error('Company sessions require an exact HTTPS PUBLIC_APP_ORIGIN.');

  const sessionId = (req: Request) =>
    /(?:^|;\s*)__Host-skill-session=([\w-]{43})(?=;|$)/.exec(req.get('Cookie') ?? '')?.[1];
  const checked = new WeakMap<Request, Promise<CompanySession | undefined>>();
  const find = (req: Request) => {
    const cached = checked.get(req);
    if (cached) return cached;
    const id = sessionId(req);
    const result = (id ? sessions.read(id) : Promise.resolve(undefined)).catch(() => {
      throw new AccessError(503, 'Company sign-in is temporarily unavailable.');
    });
    checked.set(req, result);
    return result;
  };
  const revoke = async (req: Request) => {
    const id = sessionId(req);
    if (id) await sessions.remove(id);
  };

  const storeSession = async (
    req: Request,
    res: Response,
    identity: Identity,
    expiresAt: number,
    logoutHint?: string,
  ) => {
    const current = now();
    if (!Number.isFinite(expiresAt) || expiresAt <= current) return false;
    const id = randomBytes(32).toString('base64url');
    await revoke(req);
    if (!(await sessions.write(id, { identity, expiresAt, logoutHint }))) return false;
    res.cookie(cookieName, id, { ...cookie, maxAge: expiresAt - current });
    if (logoutHint && logoutHint.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(logoutHint))
      res.cookie(loginHintCookieName, logoutHint, { ...hintCookie, maxAge: loginHintLifetime });
    logEvent('info', 'auth.session.issued', {
      requestId: res.locals.requestId,
      lifetimeSeconds: Math.floor((expiresAt - current) / 1000),
    });
    return true;
  };
  if (verify) {
    app.post('/api/auth/session', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (req.get('Origin') !== origin) {
        logEvent('warn', 'auth.session.origin_rejected', {
          requestId: res.locals.requestId,
          method: req.method,
        });
        res.sendStatus(403);
        return;
      }
      const authorization = req.get('Authorization');
      let identity: Identity, expiresAt: number;
      try {
        identity = await verify(authorization);
        if (!authorization) throw Error('Bearer required.');
        const { exp } = decodeJwt(authorization.slice(7));
        if ((exp ?? 0) * 1000 <= now()) throw Error('Token expired.');
        expiresAt = Math.min(exp! * 1000, now() + lifetime);
      } catch (error) {
        logEvent('warn', 'auth.session.exchange_denied', {
          requestId: res.locals.requestId,
          errorType: errorType(error),
        });
        res.sendStatus(401);
        return;
      }
      try {
        res.sendStatus((await storeSession(req, res, identity, expiresAt)) ? 204 : 503);
      } catch {
        res.sendStatus(503);
      }
    });
  }

  app.delete('/api/auth/session', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('Origin') !== origin) {
      logEvent('warn', 'auth.session.origin_rejected', {
        requestId: res.locals.requestId,
        method: req.method,
      });
      res.sendStatus(403);
      return;
    }
    const id = sessionId(req);
    const activeSession = await find(req);
    if (activeSession && subjectChanged(req, res, activeSession)) return;
    const logoutHint = id ? (await sessions.take(id))?.logoutHint : undefined;
    res.clearCookie(cookieName, cookie);
    logEvent('info', 'auth.session.revoked', {
      requestId: res.locals.requestId,
      microsoftLogoutAvailable: Boolean(logoutHint),
    });
    if (logoutHint) {
      res.json({ logoutHint });
      return;
    }
    res.sendStatus(204);
  });

  app.use('/api', async (req, res, next) => {
    if (!verify && req.headers.authorization) {
      res.sendStatus(401);
      return;
    }
    const session = req.headers.authorization ? undefined : await find(req);
    if (session) {
      if (!safeMethods.has(req.method) && req.get('Origin') !== origin) {
        logEvent('warn', 'auth.session.origin_rejected', {
          requestId: res.locals.requestId,
          method: req.method,
        });
        res.sendStatus(403);
        return;
      }
      if (subjectChanged(req, res, session)) return;
      res.set('Cache-Control', 'no-store');
      setSessionIdentity(req, session.identity);
    }
    next();
  });

  return {
    active: async (req: Request) => Boolean(await find(req)),
    async subject(req: Request) {
      const entry = await find(req);
      if (entry) return identitySubject(entry.identity);
    },
    async issueFromOidc(
      req: Request,
      res: Response,
      identity: Identity,
      idTokenExpiresAt: number,
      logoutHint?: string,
    ) {
      const current = now();
      if (!Number.isFinite(idTokenExpiresAt) || idTokenExpiresAt <= current) return false;
      // The verified ID token establishes identity at login. The app owns the resulting session.
      return storeSession(req, res, identity, current + lifetime, logoutHint);
    },
  };
}
