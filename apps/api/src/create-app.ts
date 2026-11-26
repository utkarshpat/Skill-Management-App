import { registerCompanyCallback } from './modules/identity/company-oidc.js';
import {
  registerCompanySessions,
  type CompanySession,
} from './modules/identity/company-session.js';
import { sqlCompanyAuthState } from './modules/identity/company-auth-state.js';
import {
  registerAnnouncementRoutes,
  type SqlAnnouncements,
} from './modules/announcements/announcement-routes.js';
import { registerBusinessRoutes, type BusinessDependencies } from './modules/business/index.js';
import { startRequestTiming } from './shared/request-timing.js';
import { errorType, logEvent } from './shared/logger.js';
import { AccessError } from './shared/errors.js';
import { registerWebHosting } from './shared/web-hosting.js';
import {
  registerCapabilityRoutes,
  type CapabilityDependencies,
} from './modules/skills/capability-routes.js';
import { randomUUID } from 'node:crypto';
import type { IdentityConfig } from './modules/identity/auth.js';
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
import { phaseTwoAvailable } from './shared/release-features.js';
import {
  registerCapabilityLeadRoutes,
  type CapabilityLeadDependencies,
} from './modules/skills/capability-lead-routes.js';
import { registerWorkflowRoutes, type WorkflowDependencies } from './modules/workflows/index.js';
import {
  registerRecommendationRoutes,
  type RecommendationDependencies,
} from './modules/recommendations/index.js';
import { registerDashboardRoutes } from './modules/dashboard/index.js';
import {
  registerExcelBulkRoutes,
  type SqlExcelBulkData,
} from './modules/skills/excel-bulk-routes.js';
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
  CapabilityDependencies &
  AccessDependencies &
  OrganizationDependencies &
  SkillsDependencies &
  AiDependencies &
  ClaimsHttpDependencies &
  LearningDependencies &
  WorkflowDependencies &
  RecommendationDependencies &
  CertificationDependencies &
  CapabilityLeadDependencies &
  CertificationRecommendationDependencies &
  KnowledgeDependencies &
  BusinessDependencies & {
    excelBulk?: Pick<SqlExcelBulkData, 'execute'>;
    announcements?: SqlAnnouncements;
  };

export function createApp(
  dependencies?: AppDependencies,
  options: {
    webRoot?: string;
    developmentStore?: AccessStore;
    hostedDemo?: HostedDemoConfig;
    identityConfig?: IdentityConfig;
    companySessionOrigin?: string;
    companyOidcSecret?: string;
    sharedCompanyAuth?: boolean;
    probeReadiness?: () => Promise<void>;
    onRequestTiming?: (metric: {
      requestId: string;
      method: string;
      route: string;
      status: number;
      durationMs: number;
      databaseCalls: number;
      databaseMs: number;
      databaseConnectionRetries: number;
      databasePhysicalConnections: number;
      databasePhases: ReturnType<ReturnType<typeof startRequestTiming>['result']>['databasePhases'];
    }) => void;
  } = {},
) {
  const app = express();
  const phaseTwo = phaseTwoAvailable();
  const store = options.developmentStore;
  const demo = store ? createDevelopmentSessions(store, Date.now, options.hostedDemo) : undefined;
  app.disable('x-powered-by');
  app.use(
    helmet(
      options.webRoot
        ? {
            contentSecurityPolicy: {
              directives: {
                // Authorized private files become local object URLs in the browser.
                // PDF.js reads those URLs and image previews display them directly.
                connectSrc: ["'self'", 'blob:', 'https://login.microsoftonline.com'],
                imgSrc: ["'self'", 'data:', 'blob:'],
                frameSrc: ["'self'", 'https://login.microsoftonline.com'],
                workerSrc: ["'self'", 'blob:'],
              },
            },
          }
        : undefined,
    ),
  );
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    const apiRequest = req.path === '/api' || req.path.startsWith('/api/');
    const assetRequest =
      !apiRequest &&
      (req.path.startsWith('/assets/') ||
        req.path.startsWith('/brand/') ||
        /\.[a-z\d]{1,8}$/i.test(req.path));
    const timingEnabled =
      apiRequest &&
      (options.onRequestTiming !== undefined || process.env.HTTP_TIMING_ENABLED !== 'false');
    const timing = timingEnabled ? startRequestTiming(res.locals.requestId) : undefined;
    res.once('finish', () => {
      // Successful hashed bundles/images are high-volume and have no API/DB timing value.
      if (assetRequest && res.statusCode < 400) return;
      const timingResult = timing?.result();
      const registeredPath = req.route?.path;
      const matchedPath =
        typeof registeredPath === 'string'
          ? registeredPath
          : Array.isArray(registeredPath)
            ? registeredPath.find(
                path =>
                  typeof path === 'string' &&
                  path.replace(/\/$/, '').toLowerCase() ===
                    req.path.replace(/\/$/, '').toLowerCase(),
              )
            : undefined;
      const fields = {
        requestId: res.locals.requestId,
        method: req.method,
        route: apiRequest
          ? (matchedPath ?? 'api.unmatched')
          : assetRequest
            ? 'web.asset'
            : 'web.document',
        status: res.statusCode,
        ...(timingResult ?? {}),
      };
      const level: 'error' | 'warn' | 'info' =
        res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      const changesState = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      const event = apiRequest && changesState ? 'app.action' : 'http.request';
      logEvent(level, event, {
        ...fields,
        ...(event === 'app.action' && {
          outcome:
            res.statusCode < 400
              ? 'success'
              : res.statusCode === 401 || res.statusCode === 403
                ? 'denied'
                : res.statusCode >= 500
                  ? 'failed'
                  : 'rejected',
        }),
      });
      try {
        if (timingResult) options.onRequestTiming?.({ ...fields, ...timingResult });
      } catch {
        /* Telemetry failures cannot change request behavior. */
      }
    });
    if (timing) timing.run(next);
    else next();
  });
  // Combined drafts carry bounded details for up to twenty items, including catalogue criteria.
  app.use('/api/capability-submissions', express.json({ limit: '1mb' }));
  // Both draft saves and iterative design requests carry bounded design history.
  app.use(
    ['/api/announcements/draft', '/api/announcements/design'],
    express.json({ limit: '1mb' }),
  );
  app.use(express.json({ limit: '128kb' }));
  const companySession =
    dependencies && options.identityConfig && options.companySessionOrigin
      ? registerCompanySessions(
          app,
          options.companySessionOrigin,
          options.companyOidcSecret ? undefined : dependencies.verify,
          undefined,
          options.sharedCompanyAuth ? sqlCompanyAuthState<CompanySession>('SESSION') : undefined,
        )
      : undefined;
  const backendSignIn = Boolean(companySession && options.companyOidcSecret);
  if (options.companyOidcSecret) {
    if (!companySession || !options.identityConfig || !options.companySessionOrigin)
      throw Error('Backend sign-in requires Entra and an HTTPS company session origin.');
    registerCompanyCallback(
      app,
      options.companySessionOrigin,
      options.identityConfig,
      options.companyOidcSecret,
      companySession.issueFromOidc,
      undefined,
      undefined,
      options.sharedCompanyAuth ? sqlCompanyAuthState('OIDC') : undefined,
    );
  }
  app.get('/api/auth/config', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const config = options.identityConfig;
    res.json(
      config
        ? {
            enabled: true,
            tenantId: config.tenantId,
            apiClientId: config.apiClientId,
            webClientId: config.webClientId,
            ...(companySession && {
              cookieSession: true,
              sessionActive: await companySession.active(req),
              sessionSubject: await companySession.subject(req),
              backendSignIn,
            }),
          }
        : { enabled: false },
    );
  });
  if (options.webRoot && options.companySessionOrigin) {
    let clientEventWindow = Date.now();
    let clientEvents = 0;
    app.post('/api/diagnostics/client', (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (req.get('Origin') !== options.companySessionOrigin) {
        res.sendStatus(403);
        return;
      }
      const kind = req.body?.kind;
      const action = req.body?.action;
      const errorType = req.body?.errorType;
      if (
        kind === 'user.action'
          ? typeof action !== 'string' ||
            ![
              'notifications.open',
              'notifications.close',
              'notifications.refresh',
              'notifications.item_open',
              'notifications.mark_read',
              'notifications.mark_unread',
              'notifications.mark_all_read',
              'notifications.filter_changed',
              'notifications.category_changed',
            ].includes(action)
          : !['window.error', 'unhandledrejection', 'react.error'].includes(kind) ||
            typeof errorType !== 'string' ||
            !/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(errorType)
      ) {
        res.sendStatus(400);
        return;
      }
      const now = Date.now();
      if (now - clientEventWindow >= 60_000) {
        clientEventWindow = now;
        clientEvents = 0;
      }
      if (clientEvents < 120) {
        clientEvents++;
        if (kind === 'user.action')
          logEvent('info', 'client.user_action', {
            requestId: res.locals.requestId,
            action,
          });
        else
          logEvent('error', 'client.runtime_error', {
            requestId: res.locals.requestId,
            clientEvent: kind,
            errorType,
          });
      }
      res.sendStatus(204);
    });
  }
  identityRoutes(
    app,
    dependencies
      ? {
          ...dependencies,
          announcementNotifications: dependencies.announcements?.notifications.bind(
            dependencies.announcements,
          ),
          skillNotifications: dependencies.claims?.notifications?.bind(dependencies.claims),
          skillStalenessNotifications: dependencies.claims?.stalenessNotifications?.bind(
            dependencies.claims,
          ),
          workflowNotifications: dependencies.workflows?.notifications.bind(dependencies.workflows),
          amendmentNotifications: dependencies.business?.notifications?.bind(dependencies.business),
          recommendationNotifications: dependencies.recommendations?.notifications.bind(
            dependencies.recommendations,
          ),
          certificationNotifications: dependencies.certifications?.notifications.bind(
            dependencies.certifications,
          ),
          certificationExpiryNotifications: dependencies.certifications?.expiryNotifications?.bind(
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
  organizationRoutes(app, dependencies, demo);
  skillsRoutes(app, dependencies, store, demo);
  registerClaimsRoutes(
    app,
    dependencies
      ? { ...dependencies, aiConfigured: dependencies.assistant?.status().configured }
      : undefined,
    store,
    demo,
  );
  if (phaseTwo || dependencies?.learning) registerLearningRoutes(app, dependencies, store, demo);
  registerCertificationRoutes(app, dependencies, store, demo);
  registerExcelBulkRoutes(app, dependencies);
  registerAnnouncementRoutes(app, dependencies);
  registerCapabilityRoutes(app, dependencies, store, demo);
  registerCapabilityLeadRoutes(app, dependencies);
  registerCertificationRecommendationRoutes(app, dependencies, store, demo);
  if (phaseTwo || dependencies?.recommendations)
    registerRecommendationRoutes(app, dependencies, store, demo);
  if (phaseTwo || dependencies?.workflows) registerWorkflowRoutes(app, dependencies, store, demo);
  if (!phaseTwo) {
    const unavailable = [
      ...(dependencies?.learning ? [] : ['/api/learning']),
      ...(dependencies?.recommendations ? [] : ['/api/recommendations']),
      ...(dependencies?.workflows ? [] : ['/api/workflows', '/api/assistant/workflow-draft']),
    ];
    if (unavailable.length)
      app.use(unavailable, (_req, res) => {
        res
          .status(404)
          .json({ error: { message: 'This feature is unavailable in this release.' } });
      });
  }
  registerDashboardRoutes(
    app,
    dependencies
      ? {
          ...dependencies,
          aiConfigured: dependencies.assistant?.status().configured,
          certificationRenewalConfigured: Boolean(dependencies.certificationImages),
        }
      : undefined,
    store,
    demo,
  );
  const capabilityLeads = dependencies?.capabilityLeads;
  registerBusinessRoutes(
    app,
    dependencies && capabilityLeads
      ? {
          ...dependencies,
          leadAdministration: (actor, personId) => capabilityLeads.run(actor, 'LIST', { personId }),
        }
      : dependencies,
    store,
    demo,
  );
  aiRoutes(app, dependencies, store, demo);
  // Temporary KT feature: no business persistence or changes to core policy.
  registerKnowledgeRoutes(app, dependencies, demo);
  // Liveness only: this must never imply SQL or organizational SSO is ready.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', service: 'capability-api', version: '0.1.0' });
  });
  let readinessCheck: Promise<void> | undefined;
  app.get('/api/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const probe = options.probeReadiness;
    if (!probe) {
      res.status(503).json({ status: 'unavailable' });
      return;
    }
    readinessCheck ??= Promise.resolve()
      .then(probe)
      .finally(() => {
        readinessCheck = undefined;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        readinessCheck,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Readiness check timed out.')), 5000);
        }),
      ]);
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
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
  if (options.webRoot) registerWebHosting(app, options.webRoot);
  app.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId },
    });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      logEvent('error', 'http.error_after_headers', {
        requestId: res.locals.requestId,
        errorType: errorType(error),
      });
      next(error);
      return;
    }
    if (error instanceof DatabaseQuotaUnavailable) {
      logEvent('warn', 'database.quota_unavailable', {
        requestId: res.locals.requestId,
        retryAfter: error.retryAfter,
      });
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
    if (error instanceof AccessError) {
      res.status(error.status).json({
        error: {
          code: 'ACCESS_REJECTED',
          message: error.message,
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    const malformed = error instanceof SyntaxError && 'body' in error;
    const tooLarge = error?.type === 'entity.too.large';
    if (!malformed && !tooLarge)
      logEvent('error', 'http.unhandled_error', {
        requestId: res.locals.requestId,
        errorType: errorType(error),
      });
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
