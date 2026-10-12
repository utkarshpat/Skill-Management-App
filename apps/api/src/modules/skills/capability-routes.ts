import { raw, type Express, type RequestHandler } from 'express';
import { AccessError } from '../../shared/errors.js';
import { can, readActorAccess, type AccessStore } from '../access/index.js';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { certificationId } from './certifications.js';
import {
  capabilityCommand,
  capabilityIntake,
  capabilityDecision,
  type CapabilitySubmissionStore,
} from './capability-submissions.js';
import { prepareCertificateFile } from './evidence.js';
export interface CapabilityDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
  capabilitySubmissions?: CapabilitySubmissionStore;
  certificateAutofill?: (
    actor: string,
    file: { data: Buffer; mimeType: string; fileName: string },
    signal: AbortSignal,
  ) => Promise<unknown>;
}
export function registerCapabilityRoutes(
  app: Express,
  deps?: CapabilityDependencies,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  app.use('/api/capability-submissions', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      let id: string | undefined;
      if (demo?.subject(req)) {
        if (!demo.requestAllowed(req) || (req.method !== 'GET' && !demo.mutationAllowed(req)))
          throw new AccessError(403, 'Request unavailable.');
        id = (await demo.person(req))?.id;
      } else {
        if (!deps?.resolveAccess) throw new AccessError(401, 'Sign in to continue.');
        let identity: Identity;
        try {
          identity = await deps.verify(req.headers.authorization);
        } catch {
          throw new AccessError(401, 'Sign in to continue.');
        }
        id = await deps.resolveAccess(identity);
      }
      const state = await readActorAccess(deps?.access ?? store, id),
        actor = state?.people.find(p => p.id === id && p.active);
      if (!state || !actor || !can(state, actor, 'profile.view', true))
        throw new AccessError(403, 'Personal capability access unavailable.');
      if (!deps?.capabilitySubmissions)
        throw new AccessError(503, 'Combined capability storage unavailable.');
      res.locals.capabilityActor = id;
      res.locals.capabilityState = state;
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/capability-submissions', async (req, res, next) => {
    try {
      if (
        Object.keys(req.query).some(k => k !== 'view') ||
        (req.query.view && !['mine', 'queue'].includes(String(req.query.view)))
      )
        throw new AccessError(400, 'Invalid submission filters.');
      res.json(
        await deps!.capabilitySubmissions!.run(
          res.locals.capabilityActor,
          req.query.view === 'queue' ? 'QUEUE' : 'MINE',
          {},
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/capability-submissions/availability', (_req, res) =>
    res.json({
      aiAvailable:
        Boolean(deps?.certificateAutofill) &&
        can(
          res.locals.capabilityState,
          res.locals.capabilityState.people.find((p: any) => p.id === res.locals.capabilityActor),
          'skill.claim',
          true,
        ) &&
        can(
          res.locals.capabilityState,
          res.locals.capabilityState.people.find((p: any) => p.id === res.locals.capabilityActor),
          'skill.view',
          false,
        ),
      fileAvailable: deps?.capabilitySubmissions?.storageConfigured !== false,
    }),
  );
  app.get('/api/capability-submissions/options', async (_req, res, next) => {
    try {
      res.json(await deps!.capabilitySubmissions!.run(res.locals.capabilityActor, 'OPTIONS', {}));
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/capability-submissions/intake', async (req, res, next) => {
    try {
      res.json(
        await deps!.capabilitySubmissions!.run(
          res.locals.capabilityActor,
          'INTAKE',
          capabilityIntake(req.body),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post(
    '/api/capability-submissions/:id/staged/:cert',
    raw({ type: () => true, limit: '5mb' }),
    async (req, res, next) => {
      try {
        if (!deps?.capabilitySubmissions?.stage)
          throw new AccessError(503, 'Draft file storage unavailable.');
        const revision = Number(req.headers['x-submission-revision']);
        if (!Number.isSafeInteger(revision) || revision < 1 || !Buffer.isBuffer(req.body))
          throw new AccessError(400, 'Save the intake draft before uploading.');
        let name: string;
        try {
          name = decodeURIComponent(
            String(req.headers['x-certificate-file-name'] ?? 'certificate'),
          );
        } catch {
          throw new AccessError(400, 'Invalid certificate filename.');
        }
        const result = await deps.capabilitySubmissions.stage(
          res.locals.capabilityActor,
          certificationId(req.params.id),
          certificationId(req.params.cert),
          revision,
          req.body,
          String(req.headers['content-type'] ?? '').split(';')[0],
          name,
        );
        res.json({
          ...result,
          items: result.items.map(({ blobName: _private, ...item }: any) => item),
        });
      } catch (e) {
        next(e);
      }
    },
  );
  app.get('/api/capability-submissions/:id/staged/:cert', async (req, res, next) => {
    try {
      if (!deps?.capabilitySubmissions?.stagedFiles)
        throw new AccessError(503, 'Draft file storage unavailable.');
      const result = await deps.capabilitySubmissions.stagedFiles(
        res.locals.capabilityActor,
        certificationId(req.params.id),
        certificationId(req.params.cert),
      );
      res.json({
        ...result,
        items: result.items.map(({ blobName: _private, ...item }: any) => item),
      });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/capability-submissions/:id/staged/:cert/:file', async (req, res, next) => {
    try {
      if (!deps?.capabilitySubmissions?.stagedFile)
        throw new AccessError(503, 'Draft file storage unavailable.');
      const { data, item } = await deps.capabilitySubmissions.stagedFile(
        res.locals.capabilityActor,
        certificationId(req.params.id),
        certificationId(req.params.cert),
        certificationId(req.params.file),
      );
      if (
        ![
          'image/webp',
          'application/pdf',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ].includes(item.mimeType)
      )
        throw new AccessError(503, 'Unsupported stored draft file.');
      res.setHeader('Content-Type', item.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
      );
      res.send(data);
    } catch (e) {
      next(e);
    }
  });
  app.post(
    '/api/capability-submissions/autofill',
    raw({ type: () => true, limit: '5mb' }),
    async (req, res, next) => {
      try {
        if (!deps?.certificateAutofill)
          throw new AccessError(503, 'AI autofill is unavailable. Continue with manual entry.');
        const mime = String(req.headers['content-type'] ?? '').split(';')[0];
        const actor = res.locals.capabilityState.people.find(
          (p: any) => p.id === res.locals.capabilityActor,
        );
        if (
          !can(res.locals.capabilityState, actor, 'skill.claim', true) ||
          !can(res.locals.capabilityState, actor, 'skill.view', false)
        )
          throw new AccessError(403, 'Certificate assistance unavailable.');
        let name: string;
        try {
          name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'certificate'));
        } catch {
          throw new AccessError(400, 'Invalid certificate filename.');
        }
        const file = await prepareCertificateFile(req.body, mime, name);
        const abort = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) abort.abort();
        });
        res.json(
          await deps.certificateAutofill(
            res.locals.capabilityActor,
            { data: file.data, mimeType: file.mimeType, fileName: file.fileName },
            AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.get('/api/capability-submissions/links/:kind/:id', async (req, res, next) => {
    try {
      if (!['SKILL', 'CERTIFICATION'].includes(req.params.kind))
        throw new AccessError(400, 'Choose a record kind.');
      res.json(
        await deps!.capabilitySubmissions!.run(res.locals.capabilityActor, 'LINKS', {
          kind: req.params.kind,
          id: certificationId(req.params.id),
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/capability-submissions/:id', async (req, res, next) => {
    try {
      res.json(
        await deps!.capabilitySubmissions!.run(res.locals.capabilityActor, 'GET', {
          id: certificationId(req.params.id),
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/capability-submissions/:id/files/:record', async (req, res, next) => {
    try {
      if (!deps?.capabilitySubmissions?.files)
        throw new AccessError(503, 'Submitted file viewing unavailable.');
      const result = await deps.capabilitySubmissions.files(
        res.locals.capabilityActor,
        certificationId(req.params.id),
        certificationId(req.params.record),
      );
      res.json({ items: result.items.map(({ blobName: _private, ...item }: any) => item) });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/capability-submissions/:id/files/:record/:file', async (req, res, next) => {
    try {
      if (!deps?.capabilitySubmissions?.file)
        throw new AccessError(503, 'Submitted file viewing unavailable.');
      const { data, item } = await deps.capabilitySubmissions.file(
        res.locals.capabilityActor,
        certificationId(req.params.id),
        certificationId(req.params.record),
        certificationId(req.params.file),
      );
      if (
        ![
          'image/webp',
          'application/pdf',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ].includes(item.mimeType)
      )
        throw new AccessError(503, 'Unsupported stored file.');
      res.setHeader('Content-Type', item.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
      );
      res.send(data);
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/capability-submissions', async (req, res, next) => {
    try {
      res.json(
        await deps!.capabilitySubmissions!.run(
          res.locals.capabilityActor,
          'SAVE',
          capabilityCommand(req.body),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  const transition =
    (operation: 'SUBMIT' | 'REROUTE' | 'PUBLISH_LINKS'): RequestHandler =>
    async (req, res, next) => {
      try {
        if (
          !req.body ||
          Object.keys(req.body).some(
            k => !['id', 'revision', 'skills', 'certifications'].includes(k),
          ) ||
          !Number.isSafeInteger(req.body.revision) ||
          req.body.revision < 1
        )
          throw new AccessError(400, 'Invalid submission revision.');
        const records = (value: unknown) => {
          if (!Array.isArray(value) || value.length > 10)
            throw new AccessError(400, 'Invalid submission records.');
          return value.map(v => {
            if (
              !v ||
              Object.keys(v).some(k => !['id', 'revision'].includes(k)) ||
              !Number.isSafeInteger(v.revision) ||
              v.revision < 1
            )
              throw new AccessError(400, 'Invalid record revision.');
            return { id: certificationId(v.id), revision: v.revision };
          });
        };
        res.json(
          await deps!.capabilitySubmissions!.run(res.locals.capabilityActor, operation, {
            id: certificationId(req.body.id),
            revision: req.body.revision,
            skills: records(req.body.skills),
            certifications: records(req.body.certifications),
          }),
        );
      } catch (e) {
        next(e);
      }
    };
  app.post('/api/capability-submissions/submit', transition('SUBMIT'));
  app.post('/api/capability-submissions/reroute', transition('REROUTE'));
  app.post('/api/capability-submissions/publish-links', transition('PUBLISH_LINKS'));
  app.post('/api/capability-submissions/decision', async (req, res, next) => {
    try {
      res.json(
        await deps!.capabilitySubmissions!.run(
          res.locals.capabilityActor,
          'DECIDE',
          capabilityDecision(req.body),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.use(
    '/api/capability-submissions',
    (
      error: unknown,
      _req: unknown,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      if (error instanceof AccessError)
        res.status(error.status).json({ error: { message: error.message } });
      else next(error);
    },
  );
}
