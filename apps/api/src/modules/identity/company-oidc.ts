import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Identity, IdentityConfig } from './auth.js';
import { errorType, logEvent } from '../../shared/logger.js';

const flowCookie = '__Host-skill-oidc';
const loginHintCookie = '__Host-skill-login-hint';
const browserCookie = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;
const flowLifetime = 5 * 60 * 1000;
const random = () => randomBytes(32).toString('base64url');

export function registerCompanyCallback(
  app: Express,
  origin: string,
  config: IdentityConfig,
  clientSecret: string,
  issue: (
    req: Request,
    res: Response,
    identity: Identity,
    expiresAt: number,
    logoutHint?: string,
  ) => boolean,
  transport = fetch,
  signingKey?: JWTVerifyGetKey,
) {
  const redirectUri = origin + '/api/auth/callback';
  const authority = 'https://login.microsoftonline.com/' + config.tenantId;
  const key =
    signingKey ??
    createRemoteJWKSet(new URL(authority + '/discovery/v2.0/keys'), { timeoutDuration: 5000 });
  const pending = new Map<
    string,
    { nonce: string; verifier: string; expiresAt: number; returnTo: string }
  >();
  const cookieState = (req: Request) =>
    /(?:^|;\s*)__Host-skill-oidc=([\w-]{43})(?=;|$)/.exec(req.get('Cookie') ?? '')?.[1];
  app.get('/api/auth/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const mode = req.query.mode === 'silent' || req.query.mode === 'choose' ? req.query.mode : 'default';
    logEvent('info', 'auth.oidc.login_started', { requestId: res.locals.requestId, mode });
    const now = Date.now();
    for (const [state, flow] of pending) if (flow.expiresAt <= now) pending.delete(state);
    const previous = cookieState(req);
    if (previous) pending.delete(previous);
    if (pending.size >= 10_000) {
      res.sendStatus(503);
      return;
    }
    const state = random(),
      nonce = random(),
      verifier = random();
    const requestedPath = req.query.returnTo;
    const returnTo =
      typeof requestedPath === 'string' &&
      /^\/(?![/\\])[^\\\u0000-\u0020]*$/.test(requestedPath) &&
      requestedPath.length <= 2048
        ? requestedPath
        : '/';
    pending.set(state, { nonce, verifier, expiresAt: now + flowLifetime, returnTo });
    res.cookie(flowCookie, state, { ...browserCookie, maxAge: flowLifetime });
    const query = new URLSearchParams({
      client_id: config.webClientId,
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: redirectUri,
      scope: 'openid profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    const savedHint = new RegExp('(?:^|;\\s*)' + loginHintCookie + '=([^;]+)').exec(
      req.get('Cookie') ?? '',
    )?.[1];
    if (savedHint) {
      try {
        const loginHint = decodeURIComponent(savedHint);
        if (loginHint.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(loginHint))
          query.set('login_hint', loginHint);
      } catch {
        // Ignore malformed hint cookies; they are hints, never identity proof.
      }
    }
    if (mode === 'silent') query.set('prompt', 'none');
    if (mode === 'choose') query.set('prompt', 'select_account');
    res.redirect(authority + '/oauth2/v2.0/authorize?' + query);
  });

  app.get('/api/auth/signed-out', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.redirect('/?signin=signed-out');
  });

  app.get('/api/auth/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const state = cookieState(req);
    const flow = state && req.query.state === state ? pending.get(state) : undefined;
    if (!flow || !state) {
      logEvent('warn', 'auth.oidc.callback_rejected', {
        requestId: res.locals.requestId,
        reason: 'missing_or_invalid_state',
      });
      res.redirect('/?signin=failed');
      return;
    }
    pending.delete(state);
    res.clearCookie(flowCookie, browserCookie);
    let failureReason = 'callback_processing_failed';
    try {
      if (flow.expiresAt <= Date.now() || typeof req.query.code !== 'string' || !req.query.code) {
        failureReason = 'authorization_response_invalid';
        throw Error('Invalid login callback.');
      }
      const response = await transport(authority + '/oauth2/v2.0/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: config.webClientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: redirectUri,
          code_verifier: flow.verifier,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        failureReason = 'code_exchange_rejected';
        logEvent('warn', 'auth.oidc.code_exchange_failed', {
          requestId: res.locals.requestId,
          upstreamStatus: response.status,
        });
        throw Error('Code exchange failed.');
      }
      const { id_token: idToken } = await response.json();
      failureReason = 'id_token_invalid';
      const { payload } = await jwtVerify(idToken, key, {
        issuer: authority + '/v2.0',
        audience: config.webClientId,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'tid', 'oid', 'nonce'],
      });
      if (
        payload.tid !== config.tenantId ||
        payload.nonce !== flow.nonce ||
        typeof payload.oid !== 'string' ||
        !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(payload.oid)
      )
        throw Error('Invalid company identity.');
      if (
        typeof payload.preferred_username !== 'string' ||
        !/^[^@\s]+@soprasteria\.com$/i.test(payload.preferred_username)
      ) {
        logEvent('warn', 'auth.oidc.domain_rejected', { requestId: res.locals.requestId });
        res.redirect('/?signin=company-required');
        return;
      }
      failureReason = 'session_unavailable';
      if (
        !issue(
          req,
          res,
          { tenantId: config.tenantId, objectId: payload.oid.toLowerCase() },
          payload.exp! * 1000,
          typeof payload.login_hint === 'string' ? payload.login_hint : undefined,
        )
      )
        throw Error('Session unavailable.');
      logEvent('info', 'auth.oidc.sign_in_succeeded', { requestId: res.locals.requestId });
      res.redirect(origin + flow.returnTo);
    } catch (error) {
      logEvent('warn', 'auth.oidc.callback_failed', {
        requestId: res.locals.requestId,
        reason: failureReason,
        errorType: errorType(error),
      });
      res.redirect('/?signin=failed');
    }
  });
}
