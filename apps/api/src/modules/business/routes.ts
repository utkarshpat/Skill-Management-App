import { streamPrivateFile } from '../../shared/private-file-response.js';
import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { readActorAccess, type AccessStore } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import { businessQuery, businessChange, previewBusiness, type BusinessStore } from './business.js';
import { assertBusinessScope } from './sql-store.js';
import { businessCsv, businessXlsx } from './export.js';
import { businessWorkflow } from './workflows.js';
import { createHash } from 'node:crypto';
import { peopleSearchQuery } from './people-search.js';
import { coverageExport } from './coverage-export.js';
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
  app.post('/api/business/people-search', async (req, res, next) => {
    try {
      if (!deps?.business?.peopleSearch)
        throw new AccessError(503, 'People search is unavailable.');
      res.json(
        await deps.business.peopleSearch(res.locals.businessActor, peopleSearchQuery(req.body)),
      );
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/business/people-search/export', async (req, res, next) => {
    try {
      if (!deps?.business?.peopleSearch)
        throw new AccessError(503, 'People search is unavailable.');
      const { format, ...payload } = req.body ?? {};
      if (!['csv', 'xlsx'].includes(format)) throw new AccessError(400, 'Choose CSV or Excel.');
      const query = peopleSearchQuery(payload);
      const result = await deps.business.peopleSearch(res.locals.businessActor, query, true);
      const rows = result.rows.map(row => ({
        employee: row.employee,
        employeeCode: row.employeeCode,
        matched: row.matched,
        required: result.required,
        meetsAllRequirements: row.eligible,
        requirements: row.criteria
          .map(c => `${c.name}: ${c.criterion} — ${c.matched ? 'Matched' : 'Not established'}`)
          .join('; '),
      }));
      const data = {
        context: result.context,
        summary: {
          employees: result.total,
          certified: 0,
          skilled: 0,
          pending: 0,
          expired: 0,
          expiring: 0,
        },
        coverage: [],
        distribution: [],
        expiry: [],
        activity: [],
        rows,
        total: result.total,
        page: 1,
        pageSize: result.pageSize,
      };
      const q = businessQuery({ dataset: 'people', scopeId: query.scopeId });
      const reportOptions = {
        columns: [
          'employee',
          'employeeCode',
          'matched',
          'required',
          'meetsAllRequirements',
          'requirements',
        ],
        metadata: [
          ['Purpose', 'Skill and certification matching; staffing availability not assessed'],
          ['Requested people', String(query.headcount)],
          ['Meets all requirements', String(result.eligibleTotal)],
          ['Result filter', query.onlyEligible ? 'Full matches only' : 'Full and partial matches'],
          ...result.requirements.map(r => ['Requirement', `${r.name}: ${r.criterion}`]),
        ],
      };
      res.setHeader('Content-Disposition', `attachment; filename="people-matching.${format}"`);
      res.type(
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      await streamPrivateFile(
        res,
        Buffer.from(
          format === 'csv'
            ? businessCsv(data, q, reportOptions)
            : businessXlsx(data, q, reportOptions),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/business/records/:kind/:id/files', async (req, res, next) => {
    try {
      if (!deps?.business?.recordFiles)
        throw new AccessError(503, 'Scoped file viewing is unavailable.');
      const data = await deps.business.recordFiles(
        res.locals.businessActor,
        req.params.kind,
        req.params.id,
      );
      res.json({
        references: data.references,
        items: data.items.map(({ blobName: _private, ...item }) => item),
      });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/business/records/:kind/:id/files/:fileId', async (req, res, next) => {
    try {
      if (!deps?.business?.file) throw new AccessError(503, 'Scoped file viewing is unavailable.');
      const { item, data } = await deps.business.file(
        res.locals.businessActor,
        req.params.kind,
        req.params.id,
        req.params.fileId,
      );
      const safeTypes = [
        'image/webp',
        'application/pdf',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];
      if (!safeTypes.includes(item.mimeType))
        throw new AccessError(503, 'Unsupported stored file.');
      res.setHeader('Content-Type', item.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await streamPrivateFile(res, data);
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
      const { format, reportKind, ...filters } = req.query;
      if (format !== 'csv' && format !== 'xlsx') throw new AccessError(400, 'Choose CSV or XLSX.');
      const actor = res.locals.businessActor,
        query = businessQuery(filters),
        data = await deps!.business!.dashboard(actor, query, true);
      if (!reportKind && data.rows.length !== data.total)
        throw new AccessError(503, 'The complete filtered export is unavailable.');
      const report = reportKind ? coverageExport(data, reportKind) : { data, options: undefined };
      const body =
        format === 'csv'
          ? businessCsv(report.data, query, report.options)
          : Buffer.from(businessXlsx(report.data, query, report.options));
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
      await streamPrivateFile(res, Buffer.from(body));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/business/report', async (req, res, next) => {
    try {
      const actor = res.locals.businessActor;
      assertBusinessScope(res.locals.businessContext, await deps!.business!.context(actor), true);
      const query = businessQuery(req.query);
      const data = await deps!.business!.dashboard(actor, query, true);
      assertBusinessScope(data.context, await deps!.business!.context(actor), true);
      // Reports contain authorized aggregates, never the paginated employee rows.
      res.json({ ...data, rows: [], filters: query });
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
    if (command.operation === 'APPROVE_AMENDMENT' && details.targetChanged === true)
      throw new AccessError(
        409,
        'The catalogue entry changed after this request. Reject it with feedback and ask for a fresh request.',
      );
    if (
      ['PROPOSE', 'SAVE_DEMAND'].includes(command.operation) &&
      current.revision !== command.payload.revision
    )
      throw new AccessError(409, 'Configuration changed. Reload before previewing.');
    const receipt = createHash('sha256')
      .update(JSON.stringify({ actor, current: { ...current, asOf: undefined }, command, details }))
      .digest('hex');
    // Keep the public form contract for confirmation. SQL-normalized PROPOSE
    // fields are deliberately not accepted as caller input by businessWorkflow.
    return {
      receipt,
      command: { operation: command.operation, payload: input.payload as Record<string, unknown> },
      details,
      revision: current.revision,
    };
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
      const actor = res.locals.businessActor;
      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        Object.keys(req.body).some(key => !['operation', 'payload', 'previewReceipt'].includes(key))
      )
        throw new AccessError(400, 'Unsupported action arguments.');
      const command = businessWorkflow(req.body.operation, req.body.payload);
      if (['MASTERS', 'AMENDMENTS', 'AMENDMENT', 'DEMANDS', 'MATCHES'].includes(command.operation))
        throw new AccessError(400, 'Choose a change to confirm.');
      if (
        typeof req.body.previewReceipt !== 'string' ||
        !/^[0-9a-f]{64}$/.test(req.body.previewReceipt)
      )
        throw new AccessError(409, 'Preview this action before confirming.');
      const recovered = await deps!.business!.recoverWorkflow?.(
        actor,
        command.operation,
        command.payload,
      );
      if (recovered) {
        res.json(recovered);
        return;
      }
      const preview = await prepare(actor, req.body);
      if (req.body.previewReceipt !== preview.receipt)
        throw new AccessError(409, 'Review this current action before confirming.');
      res.json(
        await deps!.business!.workflow(actor, command.operation, {
          ...command.payload,
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
