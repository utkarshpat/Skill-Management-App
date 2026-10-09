import type { Express, Request, Response } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { AccessError } from '../../shared/errors.js';
import { can, effectiveAccess, readActorAccess, type AccessStore } from '../access/index.js';
import {
  canRecommendCertification,
  certificationRecommendationInput,
  certificationRecommendationResponse,
  type CertificationRecommendationStore,
} from './certification-recommendations.js';
import { canReviewAssigned } from '../access/index.js';

export interface CertificationRecommendationDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
  certificationRecommendations?: CertificationRecommendationStore;
}

export function registerCertificationRecommendationRoutes(
  app: Express,
  deps: CertificationRecommendationDependencies | undefined,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  app.use('/api/certification-recommendations', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    let actor: string | undefined;
    if (demo?.subject(req)) {
      if (!demo.requestAllowed(req) || (req.method !== 'GET' && !demo.mutationAllowed(req))) {
        res.sendStatus(403);
        return;
      }
      actor = (await demo.person(req))?.id;
    } else {
      try {
        if (!deps?.resolveAccess) throw Error();
        actor = await deps.resolveAccess(await deps.verify(req.headers.authorization));
      } catch {
        res.status(401).json({ error: { message: 'Sign in to continue.' } });
        return;
      }
    }
    const state = await readActorAccess(deps?.access ?? store, actor),
      person = state?.people.find(item => item.id === actor && item.active);
    if (!state || !person || !can(state, person, 'profile.view', true)) {
      res.sendStatus(403);
      return;
    }
    res.locals.certRecommendationActor = person;
    res.locals.certRecommendationState = state;
    next();
  });

  async function handle(req: Request, res: Response) {
    try {
      const path = req.path.slice('/api/certification-recommendations'.length) || '/';
      const backend = deps?.certificationRecommendations;
      if (!backend) throw new AccessError(503, 'Certification recommendations are unavailable.');
      let state = res.locals.certRecommendationState,
        actor = res.locals.certRecommendationActor;
      let value: unknown;
      if (req.method === 'GET' && path === '/analytics') {
        if (Object.keys(req.query).length)
          throw new AccessError(400, 'Certification analytics do not accept filters.');
        if (!canReviewAssigned(state, actor))
          throw new AccessError(403, 'Assigned certification review is unavailable.');
        value = await backend.analytics(actor.id);
      } else if (req.method === 'GET' && path === '/people') {
        if (!effectiveAccess(state, actor, 'learning.recommend', 'DIRECT_REPORTS').allowed)
          throw new AccessError(403, 'Direct report recommendations are unavailable.');
        if (
          Object.keys(req.query).some(key => key !== 'search') ||
          typeof (req.query.search ?? '') !== 'string' ||
          String(req.query.search ?? '').length > 100
        )
          throw new AccessError(400, 'Check the recipient search.');
        value = await backend.people(actor.id, String(req.query.search ?? ''));
      } else if (req.method === 'GET') {
        const view = req.query.view ?? 'received',
          page = Number(req.query.page ?? 1),
          id = req.query.id,
          search = req.query.search ?? '';
        if (
          Object.keys(req.query).some(key => !['view', 'page', 'id', 'search'].includes(key)) ||
          typeof view !== 'string' ||
          !['received', 'sent'].includes(view) ||
          !Number.isSafeInteger(page) ||
          page < 1 ||
          page > 1000 ||
          typeof search !== 'string' ||
          search.length > 100 ||
          (id !== undefined &&
            (typeof id !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
        )
          throw new AccessError(400, 'Check recommendation filters.');
        if (
          view === 'sent'
            ? !effectiveAccess(state, actor, 'learning.recommend', 'DIRECT_REPORTS').allowed
            : !can(state, actor, 'learning.view', true)
        )
          throw new AccessError(403, 'Certification recommendations are unavailable.');
        value = await backend.read(
          actor.id,
          view as 'received' | 'sent',
          page,
          search,
          id as string | undefined,
        );
      } else if (req.method === 'POST' && path === '/send') {
        const input = certificationRecommendationInput(req.body);
        if (!canRecommendCertification(state, actor, input.personId))
          throw new AccessError(
            403,
            'Only an authorized current direct manager can recommend a credential.',
          );
        value = await backend.send(actor.id, input);
      } else if (req.method === 'POST') {
        if (
          !can(state, actor, 'learning.view', true) ||
          !can(state, actor, 'learning.manage', true)
        )
          throw new AccessError(403, 'Personal recommendation responses are unavailable.');
        value = await backend.respond(actor.id, certificationRecommendationResponse(req.body));
      } else {
        throw new AccessError(404, 'Recommendation endpoint unavailable.');
      }
      if (req.method === 'GET') {
        const current = await readActorAccess((deps?.access ?? store)!, actor.id);
        const currentActor = current.people.find(person => person.id === actor.id && person.active);
        if (!currentActor || !can(current, currentActor, 'profile.view', true))
          throw new AccessError(403, 'Access changed. Reload your workspace.');
        if (current.revision !== state.revision)
          throw new AccessError(
            409,
            'Access or reporting relationships changed. Refresh and retry.',
          );
        if (
          (path === '/analytics' && !canReviewAssigned(current, currentActor)) ||
          (path === '/people' &&
            !effectiveAccess(current, currentActor, 'learning.recommend', 'DIRECT_REPORTS')
              .allowed) ||
          (path === '/' &&
            req.query.view === 'sent' &&
            !effectiveAccess(current, currentActor, 'learning.recommend', 'DIRECT_REPORTS')
              .allowed) ||
          (path === '/' &&
            req.query.view !== 'sent' &&
            !can(current, currentActor, 'learning.view', true))
        )
          throw new AccessError(403, 'Recommendation access changed. Refresh and retry.');
      }
      res.json(value);
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  }
  app.get('/api/certification-recommendations', handle);
  app.get('/api/certification-recommendations/analytics', handle);
  app.get('/api/certification-recommendations/people', handle);
  app.post('/api/certification-recommendations/send', handle);
  app.post('/api/certification-recommendations/respond', handle);
}
