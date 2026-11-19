import { createHmac, randomBytes } from 'node:crypto';
import type { Express } from 'express';
import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import { verifyRequestIdentity } from '../../shared/request-identity.js';
import { readSqlJson } from '../../shared/sql-json.js';
import { certificationId } from './certifications.js';
import type { CertificationDependencies } from './certification-routes.js';

type Operation = 'LIST' | 'PREVIEW' | 'SAVE' | 'ANALYTICS';

export class SqlCapabilityLeads {
  constructor(private account: string) {}

  async run<T>(actor: string, operation: Operation, payload: object = {}): Promise<T> {
    try {
      return await withRuntimeDatabase(async pool => {
        const request = pool
          .request()
          .input('account_id', sql.UniqueIdentifier, this.account)
          .input('actor_id', sql.UniqueIdentifier, actor);
        const result =
          operation === 'ANALYTICS'
            ? await request.execute('dbo.ReadCapabilityLeadAnalytics')
            : await request
                .input('operation', sql.VarChar(10), operation)
                .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
                .execute('dbo.CapabilityLeadAdministration');
        const data = readSqlJson<{ schemaVersion?: number } & T>(result.recordset[0].json);
        if (operation === 'LIST' && data.schemaVersion !== 109)
          throw new AccessError(503, 'Issuer assignments require migration 109.');
        return data as T;
      });
    } catch (error) {
      const number = (error as { number?: number }).number;
      if (number === 2812 || number === 208)
        throw new AccessError(503, 'Issuer assignments require migration 109.');
      if (number === 51003) throw new AccessError(403, 'Issuer access is unavailable.');
      if (number === 51004) throw new AccessError(404, 'Issuer assignment is unavailable.');
      if (number === 51009)
        throw new AccessError(409, 'Workspace changed. Refresh and review again.');
      if (number === 51000)
        throw new AccessError(400, 'Check the issuer, person and organization scope.');
      throw error;
    }
  }
}

const previewKey = process.env.ENTRA_WEB_CLIENT_SECRET || randomBytes(32);
export interface CapabilityLeadDependencies extends CertificationDependencies {
  capabilityLeads?: SqlCapabilityLeads;
}

export function registerCapabilityLeadRoutes(app: Express, deps?: CapabilityLeadDependencies) {
  const leads = deps?.capabilityLeads;
  if (!leads || !deps?.resolveAccess) return;
  const base = '/api/capability-leads';
  app.use(base, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const identity = await verifyRequestIdentity(req, deps.verify).catch(() => {
      throw new AccessError(401, 'Sign in to continue.');
    });
    const actor = await deps.resolveAccess!(identity);
    if (!actor) throw new AccessError(403, 'Workspace access is unavailable.');
    res.locals.leadActor = actor;
    next();
  });
  app.get(base, async (req, res) => {
    const personId =
      req.query.personId === undefined ? undefined : certificationId(req.query.personId);
    res.json(await leads.run(res.locals.leadActor, 'LIST', { personId }));
  });
  app.get(base + '/analytics', async (_req, res) => {
    res.json(await leads.run(res.locals.leadActor, 'ANALYTICS'));
  });
  for (const operation of ['PREVIEW', 'SAVE'] as const) {
    app.post(base + '/' + operation.toLowerCase(), async (req, res) => {
      const body = req.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 1 ||
        typeof body.active !== 'boolean' ||
        typeof body.allIssuers !== 'boolean' ||
        !Array.isArray(body.issuerIds) ||
        body.issuerIds.length > 200 ||
        body.allIssuers !== (body.issuerIds.length === 0) ||
        typeof body.reason !== 'string' ||
        !body.reason.trim() ||
        body.reason.length > 1000 ||
        !['ALLOW', 'DENY'].includes(body.effect) ||
        !['DELIVERY_UNIT', 'PORTFOLIO', 'DEPARTMENT', 'PROJECT'].includes(body.scopeKind)
      )
        throw new AccessError(400, 'Choose a valid Business Analytics assignment.');
      const actor: string = res.locals.leadActor;
      const command = {
        revision: body.revision,
        id: certificationId(body.id),
        personId: certificationId(body.personId),
        allIssuers: body.allIssuers,
        issuerIds: [...new Set<string>(body.issuerIds.map(certificationId))].sort(),
        scopeId: certificationId(body.scopeId),
        scopeKind: body.scopeKind,
        effect: body.effect,
        active: body.active,
        reason: body.reason.trim(),
      };
      const receipt = createHmac('sha256', previewKey)
        .update(JSON.stringify({ actor, command }))
        .digest('hex');
      if (operation === 'SAVE' && body.receipt !== receipt)
        throw new AccessError(409, 'Preview this exact assignment before saving.');
      const result = await leads.run(actor, operation, command);
      res.json(
        operation === 'PREVIEW'
          ? { receipt, change: command, ...(result as object) }
          : { saved: true },
      );
    });
  }
}
