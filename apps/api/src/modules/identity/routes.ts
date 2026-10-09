import { loadNotificationFeed } from './notification-feed.js';
import { AccessError } from '../../shared/errors.js';
import type { Express } from 'express';
import type { Identity } from './auth.js';
import type { Profile } from './profile.js';
import { createDevelopmentSessions } from './development-login.js';
import { profileCompleteness } from './profile-completeness.js';

import type { AccessStore } from '../access/index.js';
import { workspaceFor } from './workspace.js';
import { notificationsFor } from './notifications.js';
import { can, readActorAccess, effectiveAccessSummary } from '../access/index.js';
type DevelopmentSessions = ReturnType<typeof createDevelopmentSessions>;
export interface HttpDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  profile: (identity: Identity) => Promise<Profile | undefined>;
  ownOrganization?: (actorId: string) => Promise<NonNullable<Profile['organizationDetails']>>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
  recommendationNotifications?: (
    actorId: string,
  ) => Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
  workflowNotifications?: (
    actorId: string,
  ) => Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
  skillNotifications?: (
    actorId: string,
  ) => Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
  certificationNotifications?: (
    actorId: string,
  ) => Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
  certificationRecommendationNotifications?: (
    actorId: string,
  ) => Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
}
export function registerRoutes(
  app: Express,
  dependencies: HttpDependencies | undefined,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  app.use('/api/dev-login', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!demo || !demo.requestAllowed(req)) {
      res.sendStatus(404);
      return;
    }
    next();
  });
  app.get('/api/dev-login', async (req, res) => {
    if (demo!.requiresAccessCode && !(await demo!.person(req))) {
      res.json({ people: [], signedIn: false, mode: 'local-demo', requiresAccessCode: true });
      return;
    }
    const state = await store!.snapshot({ includeAudit: false });
    res.json({
      people: state.people
        .filter(person => person.active && !person.entraObjectId)
        .map(person => ({
          id: person.id,
          displayName: person.displayName,
          employeeCode: person.employeeCode,
          roles: state.roles
            .filter(role => person.roleIds.includes(role.id))
            .map(role => role.name),
        })),
      signedIn: Boolean(await demo!.person(req)),
      mode: 'local-demo',
      requiresAccessCode: demo!.requiresAccessCode,
    });
  });
  app.post('/api/dev-login/people', async (req, res) => {
    if (!demo!.mutationAllowed(req) || !demo!.authorizeCode(req.body?.accessCode)) {
      res.sendStatus(403);
      return;
    }
    const state = await store!.snapshot({ includeAudit: false });
    res.json({
      people: state.people
        .filter(person => person.active && !person.entraObjectId)
        .map(person => ({
          id: person.id,
          displayName: person.displayName,
          employeeCode: person.employeeCode,
          roles: state.roles
            .filter(role => person.roleIds.includes(role.id))
            .map(role => role.name),
        })),
      signedIn: false,
      mode: 'local-demo',
      requiresAccessCode: demo!.requiresAccessCode,
    });
  });
  app.post('/api/dev-login', async (req, res) => {
    if (!demo!.mutationAllowed(req) || !demo!.authorizeCode(req.body?.accessCode)) {
      res.sendStatus(403);
      return;
    }
    const id = req.body?.personId;
    const value = typeof id === 'string' ? await demo!.issue(id) : undefined;
    if (!value) {
      res.status(400).json({
        error: { code: 'INVALID_DEMO_PERSON', message: 'Choose an available demo person.' },
      });
      return;
    }
    demo!.revoke(req);
    res.cookie(demo!.cookieName, value, {
      httpOnly: true,
      secure: demo!.secure,
      sameSite: 'strict',
      path: '/api',
      maxAge: demo!.lifetime,
    });
    res.json({ mode: 'local-demo' });
  });
  app.delete('/api/dev-login', (req, res) => {
    if (!demo!.mutationAllowed(req)) {
      res.sendStatus(403);
      return;
    }
    demo!.revoke(req);
    res.clearCookie(demo!.cookieName, {
      path: '/api',
      httpOnly: true,
      secure: demo!.secure,
      sameSite: 'strict',
    });
    res.sendStatus(204);
  });
  app.get(['/api/workspace', '/api/notifications', '/api/effective-access'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let actor: string | undefined;
    if (demo?.subject(req)) {
      actor = demo.subject(req);
    } else {
      let identity: Identity;
      try {
        if (!dependencies?.resolveAccess) throw new Error();
        identity = await dependencies.verify(req.headers.authorization);
      } catch {
        res.setHeader('WWW-Authenticate', 'Bearer');
        res.status(401).json({
          error: {
            code: 'NOT_AUTHORIZED',
            message: 'Sign in to continue.',
            requestId: res.locals.requestId,
          },
        });
        return;
      }
      actor = await dependencies!.resolveAccess!(identity);
    }
    const state = await readActorAccess(dependencies?.access ?? store, actor, {
      includeAudit: req.path === '/api/notifications',
    });
    const person = state?.people.find(
      item => item.id === actor && item.active && (!demo?.subject(req) || !item.entraObjectId),
    );
    if (!state || !person) {
      res.status(403).json({
        error: {
          code: 'ACCESS_NOT_PROVISIONED',
          message: 'Workspace access is not assigned.',
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    if (req.path === '/api/effective-access') {
      res.json(effectiveAccessSummary(state, person));
      return;
    }
    if (req.path === '/api/notifications') {
      if (!can(state, person, 'profile.view', true)) {
        res.sendStatus(403);
        return;
      }
      try {
        const feed = await loadNotificationFeed(notificationsFor(state, person), [
          {
            name: 'reviews',
            load: () => dependencies?.skillNotifications?.(person.id) ?? Promise.resolve([]),
          },
          {
            name: 'certifications',
            load: () =>
              can(state, person, 'skill.view', true)
                ? (dependencies?.certificationNotifications?.(person.id) ?? Promise.resolve([]))
                : Promise.resolve([]),
          },
          {
            name: 'certification-recommendations',
            load: () =>
              can(state, person, 'profile.view', true)
                ? (dependencies?.certificationRecommendationNotifications?.(person.id) ??
                  Promise.resolve([]))
                : Promise.resolve([]),
          },
          {
            name: 'requests',
            load: () => dependencies?.workflowNotifications?.(person.id) ?? Promise.resolve([]),
          },
          {
            name: 'recommendations',
            load: () =>
              dependencies?.recommendationNotifications?.(person.id) ?? Promise.resolve([]),
          },
        ]);
        res.json(feed);
      } catch (error) {
        if (error instanceof AccessError) {
          res
            .status(error.status)
            .json({ error: { message: 'Notification access changed. Refresh your workspace.' } });
          return;
        }
        throw error;
      }
      return;
    }
    res.json({
      ...workspaceFor(state, person),
      authentication: demo?.subject(req) ? 'local-demo' : 'microsoft',
    });
  });
  app.get('/api/me', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    async function sendProfile(profile: Profile, mode?: string) {
      try {
        const organizationDetails = await dependencies?.ownOrganization?.(profile.id);
        const own = organizationDetails
          ? { ...profile, organization: organizationDetails.workspace, organizationDetails }
          : profile;
        res.json({
          profile: { ...own, completeness: profileCompleteness(own) },
          ...(mode ? { mode } : {}),
        });
      } catch (error) {
        if (error instanceof AccessError) {
          res.status(error.status).json({
            error: {
              code: 'PROFILE_UNAVAILABLE',
              message: error.message,
              requestId: res.locals.requestId,
            },
          });
          return;
        }
        throw error;
      }
    }
    const demoProfile = await demo?.profile(req);
    if (demoProfile) {
      await sendProfile(demoProfile, 'local-demo');
      return;
    }
    if (demo?.subject(req)) {
      res.status(403).json({
        error: {
          code: 'ACCESS_NOT_PROVISIONED',
          message: 'Profile view permission is not assigned.',
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    let identity: Identity;
    try {
      if (!dependencies) throw new Error('Identity unavailable');
      identity = await dependencies.verify(req.headers.authorization);
    } catch {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({
        error: {
          code: 'NOT_AUTHORIZED',
          message: 'Please sign in again.',
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    const profile = await dependencies!.profile(identity);
    if (!profile) {
      res.status(403).json({
        error: {
          code: 'ACCESS_NOT_PROVISIONED',
          message: 'Your workspace access is not available. Contact your administrator.',
          requestId: res.locals.requestId,
        },
      });
      return;
    }
    await sendProfile(profile);
  });
}
