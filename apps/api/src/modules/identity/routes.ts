import type { Express } from 'express';
import type { Identity } from './auth.js';
import type { Profile } from './profile.js';
import { createDevelopmentSessions } from './development-login.js';
import { localMutation, localRequest } from '../../shared/http-security.js';
import type { AccessStore } from '../access/index.js';
import { workspaceFor } from './workspace.js';
import { notificationsFor } from './notifications.js';
import { can } from '../access/index.js';
type DevelopmentSessions = ReturnType<typeof createDevelopmentSessions>;
export interface HttpDependencies { verify: (authorization: string | undefined) => Promise<Identity>; profile: (identity: Identity) => Promise<Profile | undefined>; resolveAccess?: (identity: Identity) => Promise<string | undefined>; access?: AccessStore; }
export function registerRoutes(app: Express, dependencies: HttpDependencies | undefined, store?: AccessStore, demo?: DevelopmentSessions) {
  app.use('/api/dev-login', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!demo || !localRequest(req)) { res.sendStatus(404); return; }
    next();
  });
  app.get('/api/dev-login', async (req, res) => {
    const state = await store!.snapshot();
    res.json({ people: state.people.filter(person => person.active&&!person.entraObjectId).map(person => ({ id:person.id,displayName:person.displayName,employeeCode:person.employeeCode,roles:state.roles.filter(role=>person.roleIds.includes(role.id)).map(role=>role.name) })), signedIn: Boolean(await demo!.person(req)), mode:'local-demo' });
  });
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
  app.get(['/api/workspace','/api/notifications'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let actor: string | undefined;
    if (demo?.subject(req)) {
      actor = (await demo.person(req))?.id;
    } else {
      let identity: Identity;
      try {
        if (!dependencies?.resolveAccess) throw new Error();
        identity = await dependencies.verify(req.headers.authorization);
      } catch {
        res.setHeader('WWW-Authenticate', 'Bearer');
        res.status(401).json({ error: { code: 'NOT_AUTHORIZED', message: 'Sign in to continue.', requestId: res.locals.requestId } }); return;
      }
      actor = await dependencies!.resolveAccess!(identity);
    }
    const state = await (dependencies?.access ?? store)?.snapshot();
    const person = state?.people.find(item => item.id === actor && item.active);
    if (!state || !person) {
      res.status(403).json({ error: { code: 'ACCESS_NOT_PROVISIONED', message: 'Workspace access is not assigned.', requestId: res.locals.requestId } }); return;
    }
    if(req.path==='/api/notifications'){
      if(!can(state,person,'profile.view',true)){res.sendStatus(403);return;}
      res.json(notificationsFor(state,person));return;
    }
    res.json({ ...workspaceFor(state, person), authentication: demo?.subject(req) ? 'local-demo' : 'microsoft' });
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
}
