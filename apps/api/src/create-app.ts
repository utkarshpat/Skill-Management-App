import { registerBusinessRoutes, type BusinessDependencies } from './modules/business/index.js';
import { startRequestTiming } from './shared/request-timing.js';
import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { DatabaseQuotaUnavailable } from './shared/database-availability.js';
import { createDevelopmentSessions, type HostedDemoConfig } from './modules/identity/index.js';
import type { AccessStore } from './modules/access/index.js';
import {
  registerRoutes as identityRoutes,
  type HttpDependencies as IdentityDependencies,
} from './modules/identity/routes.js';
import {
  registerRoutes as accessRoutes,
  type HttpDependencies as AccessDependencies,
} from './modules/access/routes.js';
import {
  registerRoutes as organizationRoutes,
  type HttpDependencies as OrganizationDependencies,
} from './modules/organization/routes.js';
import {
  registerRoutes as skillsRoutes,
  type HttpDependencies as SkillsDependencies,
} from './modules/skills/routes.js';
import {
  registerRoutes as aiRoutes,
  type HttpDependencies as AiDependencies,
} from './modules/ai/routes.js';
import {
  registerClaimsRoutes,
  type ClaimsHttpDependencies,
} from './modules/skills/claims-routes.js';
import { registerLearningRoutes, type LearningDependencies } from './modules/learning/index.js';
import { registerWorkflowRoutes, type WorkflowDependencies } from './modules/workflows/index.js';
import {
  registerRecommendationRoutes,
  type RecommendationDependencies,
} from './modules/recommendations/index.js';
import { registerDashboardRoutes } from './modules/dashboard/index.js';
import {
  registerCertificationRoutes,
  type CertificationDependencies,
} from './modules/skills/certification-routes.js';
import {
  registerCertificationRecommendationRoutes,
  type CertificationRecommendationDependencies,
} from './modules/skills/certification-recommendation-routes.js';
import {
  registerKnowledgeRoutes,
  type KnowledgeDependencies,
} from './modules/knowledge-transfer/index.js';

export type AppDependencies = IdentityDependencies &
  AccessDependencies &
  OrganizationDependencies &
  SkillsDependencies &
  AiDependencies &
  ClaimsHttpDependencies &
  LearningDependencies &
  WorkflowDependencies &
  RecommendationDependencies &
  CertificationDependencies &
  CertificationRecommendationDependencies &
  KnowledgeDependencies & BusinessDependencies;

export function createApp(
  dependencies?: AppDependencies,
  options: {
    developmentStore?: AccessStore;
    hostedDemo?: HostedDemoConfig;
    onRequestTiming?: (metric: {
      requestId: string;
      method: string;
      route: string;
      status: number;
      durationMs: number;
      databaseCalls: number;
      databaseMs: number;
      databaseConnectionRetries: number;
      databasePhases: ReturnType<ReturnType<typeof startRequestTiming>['result']>['databasePhases'];
    }) => void;
  } = {},
) {
  const app = express();
  const store = options.developmentStore;
  const demo = store ? createDevelopmentSessions(store, Date.now, options.hostedDemo) : undefined;
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    if (!options.onRequestTiming) {
      next();
      return;
    }
    const timing = startRequestTiming();
    res.once('finish', () => {
      try {
        options.onRequestTiming?.({
          requestId: res.locals.requestId,
          method: req.method,
          route: req.route?.path ? String(req.route.path) : 'unmatched',
          status: res.statusCode,
          ...timing.result(),
        });
      } catch {
        /* Telemetry failures cannot change request behavior. */
      }
    });
    timing.run(next);
  });
  app.use(express.json({ limit: '128kb' }));
  identityRoutes(
    app,
    dependencies
      ? {
          ...dependencies,
          skillNotifications: dependencies.claims?.notifications?.bind(dependencies.claims),
          workflowNotifications: dependencies.workflows?.notifications.bind(dependencies.workflows),
          recommendationNotifications: dependencies.recommendations?.notifications.bind(
            dependencies.recommendations,
          ),
          certificationNotifications: dependencies.certifications?.notifications.bind(
            dependencies.certifications,
          ),
          certificationRecommendationNotifications:
            dependencies.certificationRecommendations?.notifications.bind(
              dependencies.certificationRecommendations,
            ),
        }
      : undefined,
    store,
    demo,
  );
  // Access middleware authenticates /api/access before organization routes run.
  accessRoutes(app, dependencies, store, demo);
  organizationRoutes(app, dependencies);
  skillsRoutes(app, dependencies, store, demo);
  registerClaimsRoutes(
    app,
    dependencies
      ? { ...dependencies, aiConfigured: dependencies.assistant?.status().configured }
      : undefined,
    store,
    demo,
  );
  registerLearningRoutes(app, dependencies, store, demo);
  registerCertificationRoutes(app, dependencies, store, demo);
  registerCertificationRecommendationRoutes(app, dependencies, store, demo);
  registerRecommendationRoutes(app, dependencies, store, demo);
  registerWorkflowRoutes(app, dependencies, store, demo);
  registerDashboardRoutes(
    app,
    dependencies
      ? { ...dependencies, aiConfigured: dependencies.assistant?.status().configured }
      : undefined,
    store,
    demo,
  );
  registerBusinessRoutes(app, dependencies, store, demo);
  aiRoutes(app, dependencies, store, demo);
  // Temporary KT feature: no business persistence or changes to core policy.
  registerKnowledgeRoutes(app, dependencies, demo);
  // Liveness only: this must never imply SQL or organizational SSO is ready.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', service: 'capability-api', version: '0.1.0' });
  });

  // Other workflows remain closed until their authorization is implemented.
  app.use('/api', (_req, res) => {
    res.status(401).json({
      error: {
        code: 'NOT_AUTHORIZED',
        message: 'Organizational sign-in is required.',
        requestId: res.locals.requestId,
      },
    });
  });
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId },
    });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof DatabaseQuotaUnavailable) {
      res.setHeader('Retry-After', error.retryAfter);
      res.status(503).json({
        error: {
          code: 'DATABASE_QUOTA_EXHAUSTED',
          message: error.message,
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    const malformed = error instanceof SyntaxError && 'body' in error;
    const tooLarge = error?.type === 'entity.too.large';
    res.status(malformed ? 400 : tooLarge ? 413 : 500).json({
      error: {
        code: malformed || tooLarge ? 'VALIDATION' : 'INTERNAL_ERROR',
        message: malformed
          ? 'Invalid JSON body.'
          : tooLarge
            ? 'Request body is too large.'
            : 'An unexpected error occurred.',
        requestId: res.locals.requestId,
      },
    });
  };
  app.use(errorHandler);
  return app;
}
