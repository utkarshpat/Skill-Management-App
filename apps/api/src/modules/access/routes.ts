import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { localMutation, localRequest } from '../../shared/http-security.js';
import { can, type AccessStore } from './local-access-store.js';
import { AccessError } from '../../shared/errors.js';
import { rolePresets } from './role-presets.js';
import { permissionCatalogue } from './access-catalogue.js';

export interface HttpDependencies { verify: (authorization: string | undefined) => Promise<Identity>; resolveAccess?: (identity: Identity) => Promise<string | undefined>; access?: AccessStore; }
export function registerRoutes(app: Express, dependencies: HttpDependencies | undefined, store?: AccessStore, demo?: DevelopmentSessions) {
  app.use('/api/dev-access', async (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    if (!demo || !store || !localRequest(req)) { res.sendStatus(404); return; }
    const state=await store.snapshot(); const person=state.people.find(person=>person.id===demo.subject(req)&&person.active&&!person.entraObjectId);
    if (!person) { res.sendStatus(401); return; }
    if (!can(state,person,'permissions.manage')) { res.sendStatus(403); return; }
    res.locals.demoPersonId=person.id; res.locals.accessState=state; res.locals.accessPerson=person; next();
  });
  app.get('/api/dev-access', (req,res) => {
    const state=res.locals.accessState; const person=res.locals.accessPerson;
    res.json({ ...state, storage:store!.storage, audit:can(state,person,'audit.view') ? state.audit : [], presets:rolePresets, catalogue:permissionCatalogue.map(([code,label]) => ({code,label})), canManageUsers:can(state,person,'users.manage'),canViewSkills:can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage') });
  });
  app.post('/api/dev-access', async (req,res) => {
    if (!localMutation(req)) { res.sendStatus(403); return; }
    try { await store!.save(res.locals.demoPersonId,req.body); res.json({saved:true}); }
    catch (error) { if (error instanceof AccessError) { res.status(error.status).json({error:{code:'ACCESS_CHANGE_REJECTED',message:error.message,requestId:res.locals.requestId}}); return; } throw error; }
  });
  app.use('/api/access',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    let identity:Identity;
    try{if(!dependencies?.resolveAccess||!dependencies.access)throw new Error();identity=await dependencies.verify(req.headers.authorization);}
    catch{res.status(401).json({error:{code:'NOT_AUTHORIZED',message:'Microsoft sign-in is required.'}});return;}
    const id=await dependencies.resolveAccess(identity);const state=await dependencies.access.snapshot();
    const person=state.people.find(person=>person.id===id&&person.active);
    if(!person||!can(state,person,'permissions.manage')){res.status(403).json({error:{code:'ACCESS_DENIED',message:'Permission administration is not assigned.'}});return;}
    res.locals.accessState=state;res.locals.accessPerson=person;next();
  });
  app.get('/api/access',(_req,res)=>{
    const state=res.locals.accessState;const person=res.locals.accessPerson;
    res.json({...state,storage:dependencies!.access!.storage,currentPerson:person,authentication:'microsoft',audit:can(state,person,'audit.view')?state.audit:[],presets:rolePresets, catalogue:permissionCatalogue.map(([code,label])=>({code,label})),canManageUsers:can(state,person,'users.manage'),canViewSkills:can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage')});
  });
  app.post('/api/access',async(req,res)=>{
    try{await dependencies!.access!.save(res.locals.accessPerson.id,req.body);res.json({saved:true});}
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'ACCESS_CHANGE_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });

}
