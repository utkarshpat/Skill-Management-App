import { raw, type Express } from 'express';
import type { EvidenceStore, EvidenceState } from './evidence.js';
import {
  can,
  canReviewAssigned,
  effectiveAccess,
  readActorAccess,
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

const certificateMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

export interface CertificationDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
  certifications?: CertificationStore;
  certificationImages?: EvidenceStore;
}
export function registerCertificationRoutes(
  app: Express,
  deps?: CertificationDependencies,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  const context = async (actorId: string | undefined, actorOnly = false) => {
    // Exact resource decisions require current owners and reporting edges; the
    // compact actor projection intentionally omits them. Never return this roster.
    const state = actorId
        ? actorOnly
          ? await readActorAccess(deps?.access ?? store, actorId)
          : await (deps?.access ?? store)?.snapshot({ includeAudit: false })
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
      // Initial admission needs only this actor. Exact record/manager decisions
      // still load fresh reporting context after the resource read below.
      res.locals.certificationContext = await context(actor, true);
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
        canRecommend: effectiveAccess(state, actor, 'learning.recommend', 'DIRECT_REPORTS').allowed,
        canViewRecommendations: can(state, actor, 'learning.view', true),
        canUploadImage: Boolean(deps?.certificationImages),
        records: result.records.map(r => {
          const access = certificationAccess(state, actor, r);
          return { ...r, ...access, canSubmit: access.canSubmit && r.hasImage === true };
        }),
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
          if (
            change.action === 'SUBMIT'
              ? !access.canSubmit
              : !access.canEdit || (change.action === 'SAVE_SUBMIT' && !access.canSubmit)
          )
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
      if (change.action === 'SUBMIT' || change.action === 'SAVE_SUBMIT') {
        if (!deps?.certificationImages)
          throw new AccessError(503, 'Certificate image storage is not configured.');
        if (change.revision === 0)
          throw new AccessError(
            400,
            'Save a draft and attach a certificate image before submitting.',
          );
        const image = await deps.certificationImages.read(actor.id, change.id);
        if (!image.items.length)
          throw new AccessError(400, 'Attach a certificate image before submitting.');
      }
      const revision = await deps!.certifications!.change(actor.id, change);
      res.json({ saved: true, revision: revision ?? change.revision + 1 });
    } catch (e) {
      if (e instanceof AccessError) res.status(e.status).json({ error: { message: e.message } });
      else next(e);
    }
  });
  const imageState = (state: EvidenceState) => ({
    ...state,
    items: state.items.map(({ blobName, ...item }) => item),
  });
  const imageContext = async (res: { locals: Record<string, any> }, id: unknown, write = false) => {
    const certification = certificationId(id),
      actorId = res.locals.certificationContext.actor.id;
    const record = await deps!.certifications!.get(actorId, certification);
    const fresh = await context(actorId),
      access = certificationAccess(fresh.state, fresh.actor, record);
    if (write ? !access.canEdit : record.personId !== actorId && !access.canReview)
      throw new AccessError(403, 'Certification image access is unavailable.');
    if (!deps?.certificationImages)
      throw new AccessError(503, 'Certificate image storage is not configured.');
    return { actor: fresh.actor.id, id: certification, images: deps.certificationImages };
  };
  app.get('/api/certifications/:id/image', async (req, res, next) => {
    try {
      const c = await imageContext(res, req.params.id);
      const state = await c.images.read(c.actor, c.id);
      await imageContext(res, c.id);
      res.json(imageState(state));
    } catch (e) {
      if (e instanceof AccessError) res.status(e.status).json({ error: { message: e.message } });
      else next(e);
    }
  });
  app.get('/api/certifications/:id/image/:image', async (req, res, next) => {
    try {
      const c = await imageContext(res, req.params.id);
      const imageId = certificationId(req.params.image),
        metadata = (await c.images.read(c.actor, c.id)).items.find(i => i.id === imageId);
      if (!metadata) throw new AccessError(404, 'Certificate file unavailable.');
      const data = await c.images.image(c.actor, c.id, imageId);
      await imageContext(res, c.id);
      res
        .setHeader('X-Content-Type-Options', 'nosniff')
        .type(metadata.mimeType ?? 'image/webp')
        .send(data);
    } catch (e) {
      if (e instanceof AccessError) res.status(e.status).json({ error: { message: e.message } });
      else next(e);
    }
  });
  for (const method of ['post', 'delete'] as const)
    app[method](
      '/api/certifications/:id/image',
      raw({ type: () => true, limit: 5 * 1024 * 1024 }),
      async (req, res, next) => {
        try {
          const c = await imageContext(res, req.params.id, true);
          const header = req.headers['x-certification-revision'],
            revision = Number(header);
          if (
            typeof header !== 'string' ||
            !/^[1-9]\d*$/.test(header) ||
            !Number.isSafeInteger(revision)
          )
            throw new AccessError(400, 'Save the certification draft first.');
          if (method === 'post' && !Buffer.isBuffer(req.body))
            throw new AccessError(400, 'Choose a supported certificate file up to 5 MB.');
          let fileName = 'certificate';
          const mimeType = String(req.headers['content-type'] ?? '')
            .split(';')[0]
            .trim();
          if (method === 'post') {
            if (!certificateMimeTypes.has(mimeType))
              throw new AccessError(400, 'Choose a supported certificate file up to 5 MB.');
            try {
              fileName = decodeURIComponent(
                String(req.headers['x-certificate-file-name'] ?? 'certificate'),
              );
            } catch {
              throw new AccessError(400, 'Certificate file name is invalid.');
            }
          }
          if (method === 'delete' && !c.images.remove)
            throw new AccessError(503, 'Image removal unavailable.');
          const state =
            method === 'post'
              ? await c.images.upload(c.actor, c.id, revision, req.body, {
                  mimeType,
                  fileName,
                })
              : await c.images.remove!(c.actor, c.id, revision);
          res.json(imageState(state));
        } catch (e) {
          if (e instanceof AccessError)
            res.status(e.status).json({ error: { message: e.message } });
          else next(e);
        }
      },
    );
}
