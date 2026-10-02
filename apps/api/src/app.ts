import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Identity } from './auth.js';
import type { Profile } from './profile.js';

export function createApp(dependencies?: { verify: (authorization: string | undefined) => Promise<Identity>; profile: (identity: Identity) => Promise<Profile | undefined> }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  // Liveness only: this must never imply SQL or organizational SSO is ready.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', service: 'capability-api', version: '0.1.0' });
  });

  app.get('/api/me', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let identity: Identity;
    try {
      if (!dependencies) throw new Error('Identity unavailable');
      identity = await dependencies.verify(req.headers.authorization);
    } catch {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: { code: 'NOT_AUTHORIZED', message: 'Please sign in again.', requestId: res.locals.requestId } });
      return;
    }
    const profile = await dependencies!.profile(identity);
    if (!profile) {
      res.status(403).json({ error: { code: 'ACCESS_NOT_PROVISIONED', message: 'Your workspace access is not available. Contact your administrator.', requestId: res.locals.requestId } });
      return;
    }
    res.json({ profile });
  });
  // Other workflows remain closed until their authorization is implemented.
  app.use('/api', (_req, res) => {
    res.status(401).json({ error: { code: 'NOT_AUTHORIZED', message: 'Organizational sign-in is required.', requestId: res.locals.requestId } });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId } });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const malformed = error instanceof SyntaxError && 'body' in error;
    const tooLarge = error?.type === 'entity.too.large';
    res.status(malformed ? 400 : tooLarge ? 413 : 500).json({
      error: {
        code: malformed || tooLarge ? 'VALIDATION' : 'INTERNAL_ERROR',
        message: malformed ? 'Invalid JSON body.' : tooLarge ? 'Request body is too large.' : 'An unexpected error occurred.',
        requestId: res.locals.requestId,
      },
    });
  };
  app.use(errorHandler);
  return app;
}
