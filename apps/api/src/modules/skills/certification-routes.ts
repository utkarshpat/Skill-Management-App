import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { can, effectiveAccess, readActorAccess, type AccessStore } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import {
  certificationChange,
  certificationQuery,
  type CertificationStore,
} from './certifications.js';

export interface CertificationDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
  certifications?: CertificationStore;
}
export function registerCertificationRoutes(
  app: Express,
  deps?: CertificationDependencies,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  app.use('/api/certifications', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    let actor: string | undefined;
    if (demo?.subject(req)) {
      if (!demo.requestAllowed(req) || (req.method !== 'GET' && !demo.mutationAllowed(req))) {
        res.sendStatus(403);
        return;
      }
      actor = (await demo.person(req))?.id;
    } else {
      let identity: Identity;
      try {
        if (!deps?.resolveAccess) throw new Error();
        identity = await deps.verify(req.headers.authorization);
      } catch {
        res.status(401).json({ error: { message: 'Sign in to continue.' } });
        return;
      }
      actor = await deps!.resolveAccess!(identity);
    }
    const state = await readActorAccess(deps?.access ?? store, actor);
    const person = state?.people.find(p => p.id === actor && p.active);
    if (!state || !person || !can(state, person, 'profile.view', true)) {
      res.sendStatus(403);
      return;
    }
    res.locals.certificationActor = person;
    res.locals.certificationState = state;
    next();
  });
  for (const route of ['/api/certifications', '/api/certifications/export']) {
    app.get(route, async (req, res) => {
      try {
        const exporting = route.endsWith('/export'),
          query = certificationQuery(req.query);
        const state = res.locals.certificationState,
          actor = res.locals.certificationActor;
        const allowed = exporting
          ? query.view === 'directory' && can(state, actor, 'certification.export')
          : query.view === 'mine'
            ? can(state, actor, 'certification.view', true)
            : query.view === 'queue'
              ? effectiveAccess(state, actor, 'certification.verify', 'DIRECT_REPORTS').allowed
              : can(state, actor, 'certification.directory');
        if (!allowed) throw new AccessError(403, 'Certification access is not assigned.');
        if (!deps?.certifications)
          throw new AccessError(503, 'Certification storage is not configured.');
        const value = await deps.certifications.read(actor.id, query, exporting);
        const current = await readActorAccess(deps.access ?? store, actor.id);
        if (
          !current ||
          current.revision !== state.revision ||
          !current.people.some(p => p.id === actor.id && p.active)
        )
          throw new AccessError(409, 'Access changed. Refresh certifications before continuing.');
        res.json(value);
      } catch (error) {
        if (error instanceof AccessError) {
          res.status(error.status).json({ error: { message: error.message } });
          return;
        }
        throw error;
      }
    });
  }
  app.post('/api/certifications', async (req, res) => {
    try {
      const input = certificationChange(req.body),
        own = ['SAVE', 'SUBMIT', 'REROUTE'].includes(input.action);
      const state = res.locals.certificationState,
        actor = res.locals.certificationActor;
      if (
        !(own
          ? can(state, actor, 'certification.manage', true)
          : effectiveAccess(state, actor, 'certification.verify', 'DIRECT_REPORTS').allowed)
      )
        throw new AccessError(403, 'Certification action is not assigned.');
      if (!deps?.certifications)
        throw new AccessError(503, 'Certification storage is not configured.');
      res.json(await deps.certifications.change(actor.id, input));
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  });
}
