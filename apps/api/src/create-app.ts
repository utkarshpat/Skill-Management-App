import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { createDevelopmentSessions, type HostedDemoConfig } from './modules/identity/index.js';
import type { AccessStore } from './modules/access/index.js';
import { registerRoutes as identityRoutes, type HttpDependencies as IdentityDependencies } from './modules/identity/routes.js';
import { registerRoutes as accessRoutes, type HttpDependencies as AccessDependencies } from './modules/access/routes.js';
import { registerRoutes as organizationRoutes, type HttpDependencies as OrganizationDependencies } from './modules/organization/routes.js';
import { registerRoutes as skillsRoutes, type HttpDependencies as SkillsDependencies } from './modules/skills/routes.js';
import { registerRoutes as aiRoutes, type HttpDependencies as AiDependencies } from './modules/ai/routes.js';
import { registerClaimsRoutes, type ClaimsHttpDependencies } from './modules/skills/claims-routes.js';
import {registerLearningRoutes,type LearningDependencies} from './modules/learning/index.js';

export type AppDependencies = IdentityDependencies & AccessDependencies & OrganizationDependencies & SkillsDependencies & AiDependencies & ClaimsHttpDependencies & LearningDependencies;

export function createApp(dependencies?: AppDependencies, options: { developmentStore?: AccessStore; hostedDemo?: HostedDemoConfig } = {}) {
  const app = express();
  const store = options.developmentStore;
  const demo = store ? createDevelopmentSessions(store, Date.now, options.hostedDemo) : undefined;
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  identityRoutes(app, dependencies ? {...dependencies,skillNotifications:dependencies.claims?.notifications?.bind(dependencies.claims)} : undefined, store, demo);
  // Access middleware authenticates /api/access before organization routes run.
  accessRoutes(app, dependencies, store, demo);
  organizationRoutes(app, dependencies);
  skillsRoutes(app, dependencies, store, demo);
  registerClaimsRoutes(app, dependencies, store, demo);
  registerLearningRoutes(app, dependencies, store, demo);
  aiRoutes(app, dependencies, store, demo);
  // Liveness only: this must never imply SQL or organizational SSO is ready.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', service: 'capability-api', version: '0.1.0' });
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
