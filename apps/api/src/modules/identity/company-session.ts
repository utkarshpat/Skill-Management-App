import { setSessionIdentity } from '../../shared/request-identity.js';
import { errorType, logEvent } from '../../shared/logger.js';
import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { decodeJwt } from 'jose';
import type { Identity } from './auth.js';

const cookieName = '__Host-skill-session';
const loginHintCookieName = '__Host-skill-login-hint';
const cookie = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;
const hintCookie = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
const lifetime = 60 * 60 * 1000;
const loginHintLifetime = 30 * 24 * 60 * 60 * 1000;
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registerCompanySessions(
  app: Express,
  origin: string,
  verify: ((authorization: string | undefined) => Promise<Identity>) | undefined,
  now = Date.now,
) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin)
    throw Error('Company sessions require an exact HTTPS PUBLIC_APP_ORIGIN.');

  const sessions = new Map<string, { identity: Identity; expiresAt: number; logoutHint?: string }>();
  const sessionId = (req: Request) =>
    /(?:^|;\s*)__Host-skill-session=([\w-]{43})(?=;|$)/.exec(req.get('Cookie') ?? '')?.[1];
  const find = (req: Request) => {
    const id = sessionId(req);
    if (!id) return;
    const session = sessions.get(id);
    if (session && session.expiresAt > now()) return session;
    sessions.delete(id);
  };
  const revoke = (req: Request) => {
    const id = sessionId(req);
    if (id) sessions.delete(id);
  };

  const issue = (
    req: Request,
    res: Response,
    identity: Identity,
    tokenExpiry: number,
    logoutHint?: string,
  ) => {
    const current = now();
    const expiresAt = Math.min(tokenExpiry, current + lifetime);
    if (!Number.isFinite(expiresAt) || expiresAt <= current) return false;
    for (const [id, session] of sessions) if (session.expiresAt <= current) sessions.delete(id);
    revoke(req);
    if (sessions.size >= 10_000) return false;
    const id = randomBytes(32).toString('base64url');
    sessions.set(id, { identity, expiresAt, logoutHint });
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
      try {
        const identity = await verify(authorization);
        if (!authorization) throw Error('Bearer required.');
        const { exp } = decodeJwt(authorization.slice(7));
        if ((exp ?? 0) * 1000 <= now()) throw Error('Token expired.');
        res.sendStatus(issue(req, res, identity, exp! * 1000) ? 204 : 503);
      } catch (error) {
        logEvent('warn', 'auth.session.exchange_denied', {
          requestId: res.locals.requestId,
          errorType: errorType(error),
        });
        res.sendStatus(401);
      }
    });
  }

  app.delete('/api/auth/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('Origin') !== origin) {
      logEvent('warn', 'auth.session.origin_rejected', {
        requestId: res.locals.requestId,
        method: req.method,
      });
      res.sendStatus(403);
      return;
    }
    const logoutHint = find(req)?.logoutHint;
    revoke(req);
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

  app.use('/api', (req, res, next) => {
    if (!verify && req.headers.authorization) {
      res.sendStatus(401);
      return;
    }
    const session = req.headers.authorization ? undefined : find(req);
    if (session) {
      if (!safeMethods.has(req.method) && req.get('Origin') !== origin) {
        logEvent('warn', 'auth.session.origin_rejected', {
          requestId: res.locals.requestId,
          method: req.method,
        });
        res.sendStatus(403);
        return;
      }
      res.set('Cache-Control', 'no-store');
      setSessionIdentity(req, session.identity);
    }
    next();
  });

  return { active: (req: Request) => Boolean(find(req)), issue };
}
