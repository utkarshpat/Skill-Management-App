import { readActorAccess } from '../access/index.js';
import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import type { AccessStore } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import {
  dashboardManifest,
  dashboardPolicy,
  loadDashboardCard,
  type DashboardSources,
  type CardId,
} from './dashboard.js';
export interface DashboardDependencies extends DashboardSources {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
}
export function registerDashboardRoutes(
  app: Express,
  deps: DashboardDependencies | undefined,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  app.use('/api/dashboard', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    let actor: string | undefined;
    if (demo?.subject(req)) {
      if (!demo.requestAllowed(req)) {
        res.sendStatus(403);
        return;
      }
      actor = demo.subject(req);
    } else
      try {
        if (!deps?.resolveAccess) throw Error();
        actor = await deps.resolveAccess(await deps.verify(req.headers.authorization));
      } catch {
        res.sendStatus(401);
        return;
      }
    const state = await readActorAccess(deps?.access ?? store, actor),
      person = state?.people.find(
        p => p.id === actor && p.active && (!demo?.subject(req) || !p.entraObjectId),
      );
    if (!state || !person) {
      res.sendStatus(403);
      return;
    }
    if (
      Object.keys(req.query).some(key => key !== 'status') ||
      (Object.keys(req.query).length &&
        (req.path !== '/requests' ||
          typeof req.query.status !== 'string' ||
          !['SUBMITTED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'].includes(req.query.status)))
    ) {
      res.status(400).json({
        error: {
          message: 'Choose a valid request status. Dashboard scope is resolved by the server.',
        },
      });
      return;
    }
    res.locals.dashboardPerson = person;
    res.locals.dashboardState = state;
    res.locals.dashboardRevision = state.revision;
    res.locals.dashboardPolicy = dashboardPolicy(state, person);
    next();
  });
  app.get('/api/dashboard', (_req, res) =>
    res.json(dashboardManifest(res.locals.dashboardState, res.locals.dashboardPerson, deps ?? {})),
  );
  app.get('/api/dashboard/:card', async (req, res) => {
    try {
      if (!['attention', 'learning', 'capability', 'requests'].includes(req.params.card as string))
        throw new AccessError(404, 'Unknown dashboard card.');
      const data = await loadDashboardCard(
        req.params.card as CardId,
        res.locals.dashboardPerson.id,
        res.locals.dashboardState,
        res.locals.dashboardPerson,
        deps ?? {},
        new Date(),
        req.query.status as string | undefined,
      );
      const state = await readActorAccess((deps?.access ?? store)!, res.locals.dashboardPerson.id),
        person = state.people.find(p => p.id === res.locals.dashboardPerson.id && p.active);
      if (state.revision !== res.locals.dashboardRevision)
        throw new AccessError(409, 'Workspace changed. Refresh your dashboard.');
      if (person && dashboardPolicy(state, person) !== res.locals.dashboardPolicy)
        throw new AccessError(403, 'Dashboard access changed. Refresh your dashboard.');
      if (
        !person ||
        !dashboardManifest(state, person, deps ?? {}).cards.some(c => c.id === req.params.card)
      )
        throw new AccessError(403, 'Dashboard access changed. Refresh your dashboard.');
      res.json(data);
    } catch (e) {
      if (e instanceof AccessError) {
        res.status(e.status).json({ error: { message: e.message } });
        return;
      }
      throw e;
    }
  });
}
