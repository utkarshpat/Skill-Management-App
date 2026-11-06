import type { Express, Request, RequestHandler } from 'express';
import { can } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import { previewOrganization } from './preview.js';
import type { OrganizationStore } from './organization.js';
export interface HttpDependencies {
  organization?: OrganizationStore;
}
export function registerRoutes(
  app: Express,
  dependencies: HttpDependencies | undefined,
  demo?: { mutationAllowed(req: Request): boolean },
) {
  const requireDemoMutation: RequestHandler = (req, res, next) => {
    if (!demo?.mutationAllowed(req)) {
      res.sendStatus(403);
      return;
    }
    next();
  };
  const previewHandler: RequestHandler = async (req, res) => {
    if (
      !dependencies?.organization ||
      !res.locals.accessState ||
      !res.locals.accessPerson ||
      !can(res.locals.accessState, res.locals.accessPerson, 'users.manage')
    ) {
      res.sendStatus(403);
      return;
    }
    try {
      res.json(
        previewOrganization(
          await dependencies.organization.snapshot(),
          res.locals.accessPerson.id,
          req.body,
        ),
      );
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({ error: { message: error.message } });
        return;
      }
      throw error;
    }
  };
  const saveHandler: RequestHandler = async (req, res) => {
    if (
      !dependencies?.organization ||
      !res.locals.accessState ||
      !res.locals.accessPerson ||
      !can(res.locals.accessState, res.locals.accessPerson, 'users.manage')
    ) {
      res.sendStatus(403);
      return;
    }
    try {
      const preview = previewOrganization(
        await dependencies.organization.snapshot(),
        res.locals.accessPerson.id,
        req.body,
      );
      if (req.body.previewReceipt !== preview.receipt)
        throw new AccessError(
          409,
          'Review the current reporting or membership change before saving.',
        );
      await dependencies.organization.save(res.locals.accessPerson.id, req.body);
      res.json({ saved: true });
    } catch (error) {
      if (error instanceof AccessError) {
        res.status(error.status).json({
          error: {
            code: 'ORGANIZATION_CHANGE_REJECTED',
            message: error.message,
            requestId: res.locals.requestId,
          },
        });
        return;
      }
      throw error;
    }
  };
  app.get(['/api/access/organization', '/api/dev-access/organization'], async (_req, res) => {
    if (
      !dependencies?.organization ||
      !res.locals.accessState ||
      !res.locals.accessPerson ||
      !can(res.locals.accessState, res.locals.accessPerson, 'users.manage')
    ) {
      res.sendStatus(403);
      return;
    }
    res.json(await dependencies.organization.snapshot());
  });
  app.post('/api/access/organization/preview', previewHandler);
  app.post('/api/dev-access/organization/preview', requireDemoMutation, previewHandler);
  app.post('/api/access/organization', saveHandler);
  app.post('/api/dev-access/organization', requireDemoMutation, saveHandler);
}
