import {readActorAccess} from './actor-context.js';
import {auditQuery,readAuditPage} from './audit.js';
import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';

import { can, type AccessStore } from './local-access-store.js';
import { AccessError } from '../../shared/errors.js';
import { rolePresets } from './role-presets.js';
import { actionRegistry,effectiveAccessSummary } from './effective-access.js';
import { previewAccessChange,recheckAccessChange } from './access-preview.js';

export interface HttpDependencies { verify: (authorization: string | undefined) => Promise<Identity>; resolveAccess?: (identity: Identity) => Promise<string | undefined>; access?: AccessStore; }
export function registerRoutes(app: Express, dependencies: HttpDependencies | undefined, store?: AccessStore, demo?: DevelopmentSessions) {
  app.use('/api/dev-access', async (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    if (!demo || !store || !demo.requestAllowed(req)) { res.sendStatus(404); return; }
    const state=req.path==='/audit'?await readActorAccess(store,demo.subject(req)):await store.snapshot({includeAudit:false}); const person=state?.people.find(person=>person.id===demo.subject(req)&&person.active&&!person.entraObjectId);
    if (!state||!person) { res.sendStatus(401); return; }
    if (!can(state,person,'permissions.manage')) { res.sendStatus(403); return; }
    res.locals.demoPersonId=person.id; res.locals.accessState=state; res.locals.accessPerson=person; next();
  });
  const auditHandler:import('express').RequestHandler=async(req,res)=>{
    try {const access=req.path.startsWith('/api/dev-access/')?store:dependencies?.access;
      if(!access)throw new AccessError(503,'Activity storage is unavailable.');
      const person=res.locals.accessPerson,state=res.locals.accessState;
      if(!can(state,person,'audit.view'))throw new AccessError(403,'Activity viewing is not assigned.');
      res.json(await readAuditPage(access,person.id,auditQuery(req.query)));
    } catch(error) {if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
  };
  app.get('/api/dev-access/audit',auditHandler);
  app.get('/api/dev-access', (req,res) => {
    const state=res.locals.accessState; const person=res.locals.accessPerson;
    res.json({ ...state, reporting:undefined, storage:store!.storage, currentPerson:person,authentication:'local-demo',audit:can(state,person,'audit.view') ? state.audit : [], presets:rolePresets, catalogue:actionRegistry, canManageUsers:can(state,person,'users.manage'),canViewSkills:can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage'),canViewAudit:can(state,person,'audit.view') });
  });
  app.get('/api/dev-access/effective/:id',(req,res)=>{
    const person=res.locals.accessState.people.find((item:{id:string})=>item.id===req.params.id);
    if(!person){res.sendStatus(404);return;}res.json(effectiveAccessSummary(res.locals.accessState,person));
  });
  async function validatePrimary(access:AccessStore|undefined,state:import('./local-access-store.js').LocalAccessState,actorId:string,body:Record<string,unknown>){
    if(body.kind!=='person'||body.primaryCapabilityId===undefined||body.primaryCapabilityId===null)return;
    const current=state.people.find(p=>p.id===body.id);
    if(current?.primaryCapabilityId===body.primaryCapabilityId)return {id:current.primaryCapabilityId,name:current.primaryCapabilityName??current.primaryCapabilityId};
    if(typeof body.primaryCapabilityId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.primaryCapabilityId))throw new AccessError(400,'Choose a valid primary capability.');
    if(!access?.primaryCapabilities)throw new AccessError(503,'Published capability storage is unavailable.');
    const capability=(await access.primaryCapabilities(actorId,'',body.primaryCapabilityId)).find(p=>p.id.toLowerCase()===String(body.primaryCapabilityId).toLowerCase());
    if(!capability)throw new AccessError(400,'Choose a currently published primary capability.');
    return capability;
  }
  async function primaryPreview(access:AccessStore|undefined,state:import('./local-access-store.js').LocalAccessState,actorId:string,body:Record<string,unknown>){
    const capability=await validatePrimary(access,state,actorId,body);
    const preview=await previewAccessChange(state,actorId,body);
    return {...preview,after:capability&&preview.kind==='person'?{...preview.after,primaryCapabilityName:capability.name}:preview.after};
  }
  const primaryHandler:import('express').RequestHandler=async(req,res)=>{
    try{
      if(!can(res.locals.accessState,res.locals.accessPerson,'users.manage'))throw new AccessError(403,'People administration is not assigned.');
      const access=req.path.startsWith('/api/dev-access/')?store:dependencies?.access;
      if(!access?.primaryCapabilities)throw new AccessError(503,'Published capability storage is unavailable.');
      const query=req.query.q??'';
      if(typeof query!=='string'||query.length>80||Object.keys(req.query).some(k=>k!=='q'))throw new AccessError(400,'Search with up to 80 characters.');
      res.json({items:await access.primaryCapabilities(res.locals.accessPerson.id,query.trim())});
    }catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
  };
  app.get('/api/dev-access/primary-capabilities',primaryHandler);
  app.post('/api/dev-access/preview',async(req,res)=>{
    if(!demo!.mutationAllowed(req)){res.sendStatus(403);return;}
    try{res.json(await primaryPreview(store,res.locals.accessState,res.locals.demoPersonId,req.body??{}));}
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
  });
  app.post('/api/dev-access', async (req,res) => {
    if (!demo!.mutationAllowed(req)) { res.sendStatus(403); return; }
    try { await validatePrimary(store,res.locals.accessState,res.locals.demoPersonId,req.body??{}); await recheckAccessChange(await store!.snapshot({includeAudit:false}),res.locals.demoPersonId,req.body); await store!.save(res.locals.demoPersonId,req.body); res.json({saved:true}); }
    catch (error) { if (error instanceof AccessError) { res.status(error.status).json({error:{code:'ACCESS_CHANGE_REJECTED',message:error.message,requestId:res.locals.requestId}}); return; } throw error; }
  });
  app.use('/api/access',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    let identity:Identity;
    try{if(!dependencies?.resolveAccess||!dependencies.access)throw new Error();identity=await dependencies.verify(req.headers.authorization);}
    catch{res.status(401).json({error:{code:'NOT_AUTHORIZED',message:'Microsoft sign-in is required.'}});return;}
    const id=await dependencies.resolveAccess(identity);const state=req.path==='/audit'?await readActorAccess(dependencies.access,id):await dependencies.access.snapshot({includeAudit:false});
    const person=state?.people.find(person=>person.id===id&&person.active);
    if(!state||!person||!can(state,person,'permissions.manage')){res.status(403).json({error:{code:'ACCESS_DENIED',message:'Permission administration is not assigned.'}});return;}
    res.locals.accessState=state;res.locals.accessPerson=person;next();
  });
  app.get('/api/access/audit',auditHandler);
  app.get('/api/access/primary-capabilities',primaryHandler);
  app.get('/api/access',(_req,res)=>{
    const state=res.locals.accessState;const person=res.locals.accessPerson;
    res.json({...state,reporting:undefined,storage:dependencies!.access!.storage,currentPerson:person,authentication:'microsoft',audit:can(state,person,'audit.view')?state.audit:[],presets:rolePresets, catalogue:actionRegistry,canManageUsers:can(state,person,'users.manage'),canViewSkills:can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage'),canViewAudit:can(state,person,'audit.view')});
  });
  app.get('/api/access/effective/:id',(req,res)=>{
    const person=res.locals.accessState.people.find((item:{id:string})=>item.id===req.params.id);
    if(!person){res.sendStatus(404);return;}res.json(effectiveAccessSummary(res.locals.accessState,person));
  });
  app.post('/api/access/preview',async(req,res)=>{
    try{res.json(await primaryPreview(dependencies?.access,res.locals.accessState,res.locals.accessPerson.id,req.body??{}));}
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
  });
  app.post('/api/access',async(req,res)=>{
    try{await validatePrimary(dependencies?.access,res.locals.accessState,res.locals.accessPerson.id,req.body??{});await recheckAccessChange(await dependencies!.access!.snapshot({includeAudit:false}),res.locals.accessPerson.id,req.body);await dependencies!.access!.save(res.locals.accessPerson.id,req.body);res.json({saved:true});}
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'ACCESS_CHANGE_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });

}
