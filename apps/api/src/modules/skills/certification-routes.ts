import type { Express } from 'express';
import {
  can,
  canReviewAssigned,
  type AccessStore,
  type LocalAccessState,
  type LocalPerson,
} from '../access/index.js';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { AccessError } from '../../shared/errors.js';
import {
  certificationAccess,
  canSubmitNewCertification,
  certificationChange,
  certificationId,
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
  const context = async (actorId: string | undefined) => {
    // Exact resource decisions require current owners and reporting edges; the
    // compact actor projection intentionally omits them. Never return this roster.
    const state = actorId
        ? await (deps?.access ?? store)?.snapshot({ includeAudit: false })
        : undefined,
      actor = state?.people.find(p => p.id === actorId && p.active);
    if (
      !state ||
      !actor ||
      !can(state, actor, 'profile.view', true) ||
      !can(state, actor, 'skill.view', true)
    )
      throw new AccessError(403, 'Personal certification access is not assigned.');
    return { state, actor };
  };
  app.use('/api/certifications', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      let actor: string | undefined;
      if (demo?.subject(req)) {
        if (!demo.requestAllowed(req) || (req.method !== 'GET' && !demo.mutationAllowed(req)))
          throw new AccessError(403, 'Request unavailable.');
        actor = (await demo.person(req))?.id;
      } else {
        if (!deps?.resolveAccess) throw new AccessError(401, 'Sign in to continue.');
        let identity: Identity;
        try {
          identity = await deps.verify(req.headers.authorization);
        } catch {
          throw new AccessError(401, 'Sign in to continue.');
        }
        actor = await deps.resolveAccess(identity);
      }
      res.locals.certificationContext = await context(actor);
      if (!deps?.certifications)
        throw new AccessError(503, 'Certification storage is not configured.');
      next();
    } catch (e) {
      if (e instanceof AccessError) res.status(e.status).json({ error: { message: e.message } });
      else next(e);
    }
  });
  app.get('/api/certifications', async (req, res, next) => {
    try {
      const query = certificationQuery(req.query);
      let { state, actor } = res.locals.certificationContext as {
        state: LocalAccessState;
        actor: LocalPerson;
      };
      if (query.view === 'queue' && !canReviewAssigned(state, actor))
        throw new AccessError(403, 'Assigned certification review is unavailable.');
      const result = await deps!.certifications!.read(actor.id, query);
      ({ state, actor } = await context(actor.id));
      if (query.view === 'queue' && !canReviewAssigned(state, actor))
        throw new AccessError(403, 'Assigned certification review is unavailable.');
      // Do not deliver records if current reporting scope changed during the SQL read.
      if (
        query.view === 'queue' &&
        result.records.some(r => !certificationAccess(state, actor, r).canReview)
      )
        throw new AccessError(403, 'Review assignments changed. Refresh the queue.');
      if (query.view === 'mine' && result.records.some(r => r.personId !== actor.id))
        throw new AccessError(403, 'Personal certification scope changed.');
      res.json({
        ...result,
        page: query.page,
        pageSize: 25,
        canManage: can(state, actor, 'skill.claim', true),
        canSubmitNew: canSubmitNewCertification(state, actor),
        canReview: canReviewAssigned(state, actor),
        records: result.records.map(r => ({ ...r, ...certificationAccess(state, actor, r) })),
      });
    } catch (e) {
      if (e instanceof AccessError) res.status(e.status).json({ error: { message: e.message } });
      else next(e);
    }
  });
  app.post('/api/certifications', async (req, res, next) => {
    try {
      const change = certificationChange(req.body);
      const { state, actor } = await context(
        (res.locals.certificationContext as { actor: LocalPerson }).actor.id,
      );
      if (
        change.action === 'SAVE' ||
        change.action === 'SAVE_SUBMIT' ||
        change.action === 'SUBMIT'
      ) {
        if (!can(state, actor, 'skill.claim', true))
          throw new AccessError(403, 'Personal claim management is not assigned.');
        if (change.revision > 0) {
          const record = await deps!.certifications!.get(actor.id, change.id),
            fresh = await context(actor.id);
          const access = certificationAccess(fresh.state, fresh.actor, record);
          if (change.action === 'SUBMIT' ? !access.canSubmit : !access.canEdit)
            throw new AccessError(
              403,
              'Own editable certification required. Refresh your records.',
            );
        }
      } else {
        const record = await deps!.certifications!.get(actor.id, certificationId(change.id));
        const fresh = await context(actor.id);
        if (!certificationAccess(fresh.state, fresh.actor, record).canReview)
          throw new AccessError(403, 'Current assigned review is unavailable.');
      }
      await deps!.certifications!.change(actor.id, change);
      res.json({ saved: true });
    } catch (e) {
      if (e instanceof AccessError) res.status(e.status).json({ error: { message: e.message } });
      else next(e);
    }
  });
}
