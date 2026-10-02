import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Identity } from './auth.js';
import type { Profile } from './profile.js';
import { createDevelopmentSessions, localMutation, localRequest } from './development-login.js';
import { type AccessStore, AccessError, can } from './local-access-store.js';
import { permissionCatalogue } from './access-catalogue.js';

export function createApp(dependencies?: { verify: (authorization: string | undefined) => Promise<Identity>; profile: (identity: Identity) => Promise<Profile | undefined> }, options: { developmentStore?: AccessStore } = {}) {
  const app = express();
  const store = options.developmentStore;
  const demo = store ? createDevelopmentSessions(store) : undefined;
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.use('/api/dev-login', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!demo || !localRequest(req)) { res.sendStatus(404); return; }
    next();
  });
  app.get('/api/dev-login', async (req, res) => res.json({ people: (await store!.snapshot()).people.filter(person => person.active).map(person => ({ id:person.id,displayName:person.displayName,employeeCode:person.employeeCode })), signedIn: Boolean(await demo!.person(req)), mode:'local-demo' }));
  app.post('/api/dev-login', async (req, res) => {
    if (!localMutation(req)) { res.sendStatus(403); return; }
    const id = req.body?.personId;
    const value = typeof id === 'string' ? await demo!.issue(id) : undefined;
    if (!value) { res.status(400).json({ error: { code: 'INVALID_DEMO_PERSON', message: 'Choose an available demo person.' } }); return; }
    demo!.revoke(req);
    res.cookie(demo!.cookieName, value, { httpOnly: true, sameSite: 'strict', path: '/api', maxAge: demo!.lifetime });
    res.json({ mode: 'local-demo' });
  });
  app.delete('/api/dev-login', (req, res) => {
    if (!localMutation(req)) { res.sendStatus(403); return; }
    demo!.revoke(req); res.clearCookie(demo!.cookieName, { path: '/api', httpOnly: true, sameSite: 'strict' }); res.sendStatus(204);
  });
  app.use('/api/dev-access', async (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    if (!demo || !store || !localRequest(req)) { res.sendStatus(404); return; }
    const state=await store.snapshot(); const person=state.people.find(person=>person.id===demo.subject(req)&&person.active);
    if (!person) { res.sendStatus(401); return; }
    if (!can(state,person,'permissions.manage')) { res.sendStatus(403); return; }
    res.locals.demoPersonId=person.id; res.locals.accessState=state; res.locals.accessPerson=person; next();
  });
  app.get('/api/dev-access', (req,res) => {
    const state=res.locals.accessState; const person=res.locals.accessPerson;
    res.json({ ...state, storage:store!.storage, audit:can(state,person,'audit.view') ? state.audit : [], catalogue:permissionCatalogue.map(([code,label]) => ({code,label})), canManageUsers:can(state,person,'users.manage') });
  });
  app.post('/api/dev-access', async (req,res) => {
    if (!localMutation(req)) { res.sendStatus(403); return; }
    try { await store!.save(res.locals.demoPersonId,req.body); res.json({saved:true}); }
    catch (error) { if (error instanceof AccessError) { res.status(error.status).json({error:{code:'ACCESS_CHANGE_REJECTED',message:error.message,requestId:res.locals.requestId}}); return; } throw error; }
  });

  // Liveness only: this must never imply SQL or organizational SSO is ready.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', service: 'capability-api', version: '0.1.0' });
  });

  app.get('/api/me', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const demoProfile = await demo?.profile(req);
    if (demoProfile) { res.json({ profile: demoProfile, mode: 'local-demo' }); return; }
    if (demo?.subject(req)) { res.status(403).json({error:{code:'ACCESS_NOT_PROVISIONED',message:'Profile view permission is not assigned.',requestId:res.locals.requestId}}); return; }
    let identity: Identity;
    try {
      if (!dependencies) throw new Error('Identity unavailable');
      identity = await dependencies.verify(req.headers.authorization);
    } catch {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: { code: 'NOT_AUTHORIZED', message: 'Please sign in again.', requestId: res.locals.requestId } });
      return;
    }
    const profile = await dependencies!.profile(identity);
    if (!profile) {
      res.status(403).json({ error: { code: 'ACCESS_NOT_PROVISIONED', message: 'Your workspace access is not available. Contact your administrator.', requestId: res.locals.requestId } });
      return;
    }
    res.json({ profile });
  });
  // Other workflows remain closed until their authorization is implemented.
  app.use('/api', (_req, res) => {
    res.status(401).json({ error: { code: 'NOT_AUTHORIZED', message: 'Organizational sign-in is required.', requestId: res.locals.requestId } });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId } });
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const malformed = error instanceof SyntaxError && 'body' in error;
    const tooLarge = error?.type === 'entity.too.large';
    res.status(malformed ? 400 : tooLarge ? 413 : 500).json({
      error: {
        code: malformed || tooLarge ? 'VALIDATION' : 'INTERNAL_ERROR',
        message: malformed ? 'Invalid JSON body.' : tooLarge ? 'Request body is too large.' : 'An unexpected error occurred.',
        requestId: res.locals.requestId,
      },
    });
  };
  app.use(errorHandler);
  return app;
}
