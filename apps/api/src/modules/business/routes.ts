import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { readActorAccess, type AccessStore } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import { businessQuery, businessChange, previewBusiness, type BusinessStore } from './business.js';
import { assertBusinessScope } from './sql-store.js';
import { businessCsv, businessXlsx } from './export.js';
import { businessWorkflow } from './workflows.js';
import { createHash } from 'node:crypto';
export interface BusinessDependencies {
  verify: (authorization: string | undefined) => Promise<Identity>;
  resolveAccess?: (identity: Identity) => Promise<string | undefined>;
  access?: AccessStore;
  business?: BusinessStore;
}
export function registerBusinessRoutes(
  app: Express,
  deps?: BusinessDependencies,
  store?: AccessStore,
  demo?: DevelopmentSessions,
) {
  app.use('/api/business', async (req, res, next) => {
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
      if (!actor) throw new AccessError(403, 'Workspace access unavailable.');
      const state = await readActorAccess(deps?.access ?? store, actor);
      if (!state?.people.some(p => p.id === actor && p.active))
        throw new AccessError(403, 'Active workspace required.');
      if (!deps?.business)
        throw new AccessError(503, 'Business Operations storage is not configured.');
      const context = await deps.business.context(actor);
      if (!context.canView && !context.canManage && !context.canAmend)
        throw new AccessError(
          403,
          'Business responsibility or current manager relationship is required.',
        );
      res.locals.businessActor = actor;
      res.locals.businessContext = context;
      next();
    } catch (error) {
      if (error instanceof AccessError)
        res.status(error.status).json({ error: { message: error.message } });
      else next(error);
    }
  });
  app.get('/api/business/context', async (_req, res) => {
    res.json(res.locals.businessContext);
  });
  app.get('/api/business/dashboard', async (req, res, next) => {
    try {
      res.json(await deps!.business!.dashboard(res.locals.businessActor, businessQuery(req.query)));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/business/administration', async (_req, res, next) => {
    try {
      res.json(await deps!.business!.administration(res.locals.businessActor));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/business/administration/preview', async (req, res, next) => {
    try {
      const actor = res.locals.businessActor;
      res.json(
        previewBusiness(
          actor,
          await deps!.business!.administration(actor),
          businessChange(req.body),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/business/administration', async (req, res, next) => {
    try {
      const actor = res.locals.businessActor,
        change = businessChange(req.body),
        preview = previewBusiness(actor, await deps!.business!.administration(actor), change);
      if (req.body.previewReceipt !== preview.receipt)
        throw new AccessError(409, 'Review the current change before saving.');
      await deps!.business!.change(actor, change);
      res.json({ saved: true });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/business/export', async (req, res, next) => {
    try {
      const { format, ...filters } = req.query;
      if (format !== 'csv' && format !== 'xlsx') throw new AccessError(400, 'Choose CSV or XLSX.');
      const actor = res.locals.businessActor,
        query = businessQuery(filters),
        data = await deps!.business!.dashboard(actor, query, true);
      if (data.rows.length !== data.total)
        throw new AccessError(503, 'The complete filtered export is unavailable.');
      const body =
        format === 'csv' ? businessCsv(data, query) : Buffer.from(businessXlsx(data, query));
      assertBusinessScope(data.context, await deps!.business!.context(actor), true);
      res.setHeader(
        'Content-Type',
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="business-${query.dataset}.${format}"`,
      );
      res.send(body);
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/business/workflow/:operation', async (req, res, next) => {
    try {
      const command = businessWorkflow(req.params.operation.toUpperCase(), req.query);
      if (!['MASTERS', 'AMENDMENTS', 'AMENDMENT', 'DEMANDS', 'MATCHES'].includes(command.operation))
        throw new AccessError(400, 'Read operation required.');
      res.json(
        await deps!.business!.workflow(
          res.locals.businessActor,
          command.operation,
          command.payload,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  const prepare = async (actor: string, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new AccessError(400, 'Choose a valid change to preview.');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !['operation', 'payload', 'previewReceipt'].includes(key)))
      throw new AccessError(400, 'Unsupported action arguments.');
    const command = businessWorkflow(input.operation, input.payload);
    if (['MASTERS', 'AMENDMENTS', 'AMENDMENT', 'DEMANDS', 'MATCHES'].includes(command.operation))
      throw new AccessError(400, 'Choose a change to preview.');
    const current = await deps!.business!.context(actor);
    if (
      (['PROPOSE'].includes(command.operation) && !current.canAmend) ||
      (command.operation === 'SAVE_DEMAND' && !current.canDemandCreate) ||
      (command.operation === 'SHORTLIST' && !current.canShortlist) ||
      (['APPROVE_AMENDMENT', 'REJECT_AMENDMENT'].includes(command.operation) && !current.canApprove)
    )
      throw new AccessError(403, 'Current authority does not permit this action.');
    const details = ['APPROVE_AMENDMENT', 'REJECT_AMENDMENT'].includes(command.operation)
      ? await deps!.business!.workflow(actor, 'AMENDMENT', { id: command.payload.id })
      : command.payload;
    if (
      ['PROPOSE', 'SAVE_DEMAND'].includes(command.operation) &&
      current.revision !== command.payload.revision
    )
      throw new AccessError(409, 'Configuration changed. Reload before previewing.');
    const receipt = createHash('sha256')
      .update(JSON.stringify({ actor, current: { ...current, asOf: undefined }, command, details }))
      .digest('hex');
    return { receipt, command, details, revision: current.revision };
  };
  app.post('/api/business/workflow/preview', async (req, res, next) => {
    try {
      res.json(await prepare(res.locals.businessActor, req.body));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/business/workflow', async (req, res, next) => {
    try {
      const actor = res.locals.businessActor,
        preview = await prepare(actor, req.body);
      if (req.body.previewReceipt !== preview.receipt)
        throw new AccessError(409, 'Review this current action before confirming.');
      res.json(
        await deps!.business!.workflow(actor, preview.command.operation, {
          ...preview.command.payload,
          accessRevision: preview.revision,
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  app.use(
    '/api/business',
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
