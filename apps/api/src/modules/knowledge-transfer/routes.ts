import { readActorAccess } from '../access/index.js';
import type { Express } from 'express';
import type { AccessStore } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import type { KnowledgeTransferService } from './guide.js';
export interface KnowledgeDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
  knowledgeTransfer?: KnowledgeTransferService;
}
export function registerKnowledgeRoutes(
  app: Express,
  deps: KnowledgeDependencies | undefined,
  demo: DevelopmentSessions | undefined,
) {
  app.use('/api/knowledge-transfer', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!deps?.knowledgeTransfer) {
      res.status(404).json({ error: { message: 'The temporary handover workspace is disabled.' } });
      return;
    }
    let actor: string | undefined;
    if (demo?.subject(req)) {
      if (
        !demo.requestAllowed(req) ||
        (!['GET', 'HEAD'].includes(req.method) && !demo.mutationAllowed(req))
      ) {
        res.sendStatus(403);
        return;
      }
      actor = demo.subject(req);
      const person = (await readActorAccess(deps.access, actor))?.people.find(
        p => p.id === actor && p.active && !p.entraObjectId,
      );
      if (!person) {
        res.sendStatus(403);
        return;
      }
    } else {
      try {
        actor = await deps.resolveAccess?.(await deps.verify(req.headers.authorization));
      } catch {
        res.status(401).json({ error: { message: 'Sign in to read the project handover.' } });
        return;
      }
    }
    if (!actor) {
      res.sendStatus(403);
      return;
    }
    res.locals.knowledgeActor = actor;
    next();
  });
  app.get('/api/knowledge-transfer', async (_req, res) => {
    try {
      res.json(await deps!.knowledgeTransfer!.read(res.locals.knowledgeActor));
    } catch (e) {
      if (e instanceof AccessError) {
        res.status(e.status).json({ error: { message: e.message } });
        return;
      }
      throw e;
    }
  });
  app.post('/api/knowledge-transfer/explain', async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const result = await deps!.knowledgeTransfer!.explain(
        res.locals.knowledgeActor,
        req.body,
        AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
      );
      if (!controller.signal.aborted) res.json(result);
    } catch (e) {
      if (e instanceof AccessError) {
        if (!controller.signal.aborted)
          res
            .status(e.status)
            .json({ error: { message: e.message, requestId: res.locals.requestId } });
        return;
      }
      throw e;
    }
  });
}
