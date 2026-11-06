import { readActorAccess } from './actor-context.js';
import { auditQuery, readAuditPage } from './audit.js';
import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';

import { can, type AccessStore } from './local-access-store.js';
import { AccessError } from '../../shared/errors.js';
import { rolePresets } from './role-presets.js';
import { actionRegistry, effectiveAccessSummary } from './effective-access.js';
import { previewAccessChange, recheckAccessChange } from './access-preview.js';
import { primaryCapabilityQuery, validatePrimaryCapabilityChange } from './primary-capability.js';
import {
  directoryQuery,
  readDirectory,
  readPersonAdministration,
  administrationId,
} from './administration.js';

export interface HttpDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
}
export function registerRoutes(
  app: Express,
  dependencies: HttpDependencies | undefined,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  const compactRead = (req: import('express').Request) =>
    req.method === 'GET' &&
    ((req.path === '/' && req.query.summary === '1') ||
      req.path === '/directory' ||
      req.path === '/primary-capabilities' ||
      req.path.startsWith('/people/') ||
      req.path.startsWith('/effective/'));
  async function effectiveHandler(req: import('express').Request, res: import('express').Response) {
    try {
      const access = res.locals.demoPersonId ? store! : dependencies!.access!;
      const id =
        access.storage === 'azure-sql' ? administrationId(req.params.id) : String(req.params.id);
      const targetState = await readActorAccess(access, id),
        person = targetState.people.find(p => p.id === id);
      if (!person) throw new AccessError(404, 'This person is unavailable.');
      const fresh = await readActorAccess(access, res.locals.accessPerson.id),
        actor = fresh.people.find(p => p.id === res.locals.accessPerson.id && p.active);
      if (!actor || !can(fresh, actor, 'permissions.manage'))
        throw new AccessError(403, 'Permission administration is no longer assigned.');
      if (fresh.revision !== targetState.revision)
        throw new AccessError(409, 'Access changed. Reload the person.');
      res.json(effectiveAccessSummary(targetState, person));
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  }
  async function previewWithCapability(
    access: AccessStore,
    state: import('./local-access-store.js').LocalAccessState,
    actorId: string,
    input: unknown,
  ) {
    const preview = await previewAccessChange(state, actorId, input);
    const details = await validatePrimaryCapabilityChange(access, state, actorId, input);
    return { ...preview, after: details ? { ...preview.after, ...details } : preview.after };
  }
  app.use('/api/dev-access', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!demo || !store || !demo.requestAllowed(req)) {
      res.sendStatus(404);
      return;
    }
    const state =
      req.path === '/audit' || compactRead(req)
        ? await readActorAccess(store, demo.subject(req))
        : await store.snapshot({ includeAudit: false });
    const person = state?.people.find(
      person => person.id === demo.subject(req) && person.active && !person.entraObjectId,
    );
    if (!state || !person) {
      res.sendStatus(401);
      return;
    }
    if (!can(state, person, 'permissions.manage')) {
      res.sendStatus(403);
      return;
    }
    res.locals.demoPersonId = person.id;
    res.locals.accessState = state;
    res.locals.accessPerson = person;
    next();
  });
  const auditHandler: import('express').RequestHandler = async (req, res) => {
    try {
      const access = res.locals.demoPersonId ? store : dependencies?.access;
      if (!access) throw new AccessError(503, 'Activity storage is unavailable.');
      const person = res.locals.accessPerson,
        state = res.locals.accessState;
      if (!can(state, person, 'audit.view'))
        throw new AccessError(403, 'Activity viewing is not assigned.');
      res.json(await readAuditPage(access, person.id, auditQuery(req.query)));
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  };
  app.get('/api/dev-access/audit', auditHandler);
  app.get('/api/dev-access', (req, res) => {
    const state = res.locals.accessState;
    const person = res.locals.accessPerson;
    res.json({
      ...state,
      ...(req.query.summary === '1'
        ? { people: [], roles: [], audit: [], reporting: undefined }
        : {}),
      reporting: undefined,
      storage: store!.storage,
      currentPerson: person,
      authentication: 'local-demo',
      audit: can(state, person, 'audit.view') ? state.audit : [],
      presets: rolePresets,
      catalogue: actionRegistry,
      canManageUsers: can(state, person, 'users.manage'),
      canViewSkills:
        can(state, person, 'skill.view') || can(state, person, 'skill.catalogue.manage'),
      canViewAudit: can(state, person, 'audit.view'),
    });
  });
  app.get('/api/dev-access/effective/:id', effectiveHandler);
  app.post('/api/dev-access/preview', async (req, res) => {
    if (!demo!.mutationAllowed(req)) {
      res.sendStatus(403);
      return;
    }
    try {
      res.json(
        await previewWithCapability(
          store!,
          res.locals.accessState,
          res.locals.demoPersonId,
          req.body,
        ),
      );
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  });
  app.post('/api/dev-access', async (req, res) => {
    if (!demo!.mutationAllowed(req)) {
      res.sendStatus(403);
      return;
    }
    try {
      const state = res.locals.accessState;
      await recheckAccessChange(state, res.locals.demoPersonId, req.body);
      await validatePrimaryCapabilityChange(store!, state, res.locals.demoPersonId, req.body);
      await store!.save(res.locals.demoPersonId, req.body);
      res.json({ saved: true });
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({
          error: {
            code: 'ACCESS_CHANGE_REJECTED',
            message: error.message,
            requestId: res.locals.requestId,
          },
        });
        return;
      }
      throw error;
    }
  });
  app.use('/api/access', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    let identity: Identity;
    try {
      if (!dependencies?.resolveAccess || !dependencies.access) throw new Error();
      identity = await dependencies.verify(req.headers.authorization);
    } catch {
      res
        .status(401)
        .json({ error: { code: 'NOT_AUTHORIZED', message: 'Microsoft sign-in is required.' } });
      return;
    }
    const id = await dependencies.resolveAccess(identity);
    const state =
      req.path === '/audit' || compactRead(req)
        ? await readActorAccess(dependencies.access, id)
        : await dependencies.access.snapshot({ includeAudit: false });
    const person = state?.people.find(person => person.id === id && person.active);
    if (!state || !person || !can(state, person, 'permissions.manage')) {
      res.status(403).json({
        error: { code: 'ACCESS_DENIED', message: 'Permission administration is not assigned.' },
      });
      return;
    }
    res.locals.accessState = state;
    res.locals.accessPerson = person;
    next();
  });
  app.get('/api/access/audit', auditHandler);
  const capabilityHandler: import('express').RequestHandler = async (req, res) => {
    try {
      const access = req.path.startsWith('/api/dev-access/') ? store : dependencies?.access;
      const state = res.locals.accessState,
        actor = res.locals.accessPerson;
      if (!can(state, actor, 'users.manage'))
        throw new AccessError(403, 'People administration is required.');
      const query = primaryCapabilityQuery(req.query);
      if (!access?.primaryCapabilities)
        throw new AccessError(
          503,
          'Primary capability selection requires the Azure SQL catalogue.',
        );
      res.json(await access.primaryCapabilities(actor.id, query));
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  };
  app.get('/api/access/primary-capabilities', capabilityHandler);
  app.get('/api/dev-access/primary-capabilities', capabilityHandler);
  app.get('/api/access', (req, res) => {
    const state = res.locals.accessState;
    const person = res.locals.accessPerson;
    res.json({
      ...state,
      ...(req.query.summary === '1'
        ? { people: [], roles: [], audit: [], reporting: undefined }
        : {}),
      reporting: undefined,
      storage: dependencies!.access!.storage,
      currentPerson: person,
      authentication: 'microsoft',
      audit: can(state, person, 'audit.view') ? state.audit : [],
      presets: rolePresets,
      catalogue: actionRegistry,
      canManageUsers: can(state, person, 'users.manage'),
      canViewSkills:
        can(state, person, 'skill.view') || can(state, person, 'skill.catalogue.manage'),
      canViewAudit: can(state, person, 'audit.view'),
    });
  });
  app.get('/api/access/effective/:id', effectiveHandler);
  const directoryHandler: import('express').RequestHandler = async (req, res) => {
    try {
      const access = req.path.startsWith('/api/dev-access/') ? store! : dependencies!.access!;
      const actor = res.locals.accessPerson;
      if (!can(res.locals.accessState, actor, 'users.manage'))
        throw new AccessError(403, 'People administration is required.');
      if (req.params.id && Object.keys(req.query).length)
        throw new AccessError(400, 'Unexpected person filters.');
      const result = req.params.id
        ? await readPersonAdministration(access, actor.id, administrationId(req.params.id))
        : await readDirectory(access, actor.id, directoryQuery(req.query));
      const fresh = await readActorAccess(access, actor.id),
        current = fresh?.people.find(p => p.id === actor.id && p.active);
      if (
        !fresh ||
        !current ||
        !can(fresh, current, 'permissions.manage') ||
        !can(fresh, current, 'users.manage')
      )
        throw new AccessError(403, 'People administration is no longer assigned.');
      if (fresh.revision !== result.revision)
        throw new AccessError(409, 'Access changed. Search or open the person again.');
      res.json(result);
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  };
  for (const base of ['/api/access', '/api/dev-access']) {
    app.get(base + '/directory', directoryHandler);
    app.get(base + '/people/:id', directoryHandler);
  }
  app.post('/api/access/preview', async (req, res) => {
    try {
      res.json(
        await previewWithCapability(
          dependencies!.access!,
          res.locals.accessState,
          res.locals.accessPerson.id,
          req.body,
        ),
      );
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  });
  app.post('/api/access', async (req, res) => {
    try {
      const state = res.locals.accessState;
      await recheckAccessChange(state, res.locals.accessPerson.id, req.body);
      if (dependencies!.access!.storage !== 'azure-sql') {
        await validatePrimaryCapabilityChange(
          dependencies!.access!,
          state,
          res.locals.accessPerson.id,
          req.body,
        );
      }
      await dependencies!.access!.save(res.locals.accessPerson.id, req.body);
      res.json({ saved: true });
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({
          error: {
            code: 'ACCESS_CHANGE_REJECTED',
            message: error.message,
            requestId: res.locals.requestId,
          },
        });
        return;
      }
      throw error;
    }
  });
}
