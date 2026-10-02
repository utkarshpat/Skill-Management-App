import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { can, type AccessStore } from '../access/index.js';
import { localRequest, localMutation } from '../../shared/http-security.js';
import { AccessError } from '../../shared/errors.js';
import { claimChange, claimPage, claimSearch, type ClaimsStore } from './claims.js';

export interface ClaimsHttpDependencies {
  verify:(authorization:string|undefined)=>Promise<Identity>;
  resolveAccess?:(identity:Identity)=>Promise<string|undefined>;
  access?:AccessStore; claims?:ClaimsStore;
}
export function registerClaimsRoutes(app:Express, dependencies:ClaimsHttpDependencies|undefined, store?:AccessStore, demo?:DevelopmentSessions) {
  app.use('/api/my-skills',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    let actor:string|undefined;
    if(demo?.subject(req)) {
      if(!localRequest(req)||(req.method==='POST'&&!localMutation(req))){res.sendStatus(403);return;}
      actor=(await demo.person(req))?.id;
    } else {
      let identity:Identity;
      try { if(!dependencies?.resolveAccess)throw new Error();identity=await dependencies.verify(req.headers.authorization); }
      catch { res.status(401).json({error:{code:'NOT_AUTHORIZED',message:'Sign in to continue.',requestId:res.locals.requestId}});return; }
      actor=await dependencies!.resolveAccess!(identity);
    }
    const state=await (dependencies?.access??store)?.snapshot(),person=state?.people.find(item=>item.id===actor&&item.active);
    if(!state||!person||!can(state,person,'profile.view',true)||((req.method==='POST'||req.path==='/catalogue')&&(!can(state,person,'skill.claim',true)||!can(state,person,'skill.view')))){res.sendStatus(403);return;}
    res.locals.claimActor=person.id;next();
  });
  app.get('/api/my-skills',async(req,res)=>{
    try { if(!dependencies?.claims)throw new AccessError(503,'My Skills is not configured.');res.json(await dependencies.claims.read(res.locals.claimActor,claimPage(req.query.page))); }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_DRAFT_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.get('/api/my-skills/catalogue',async(req,res)=>{
    try { if(!dependencies?.claims)throw new AccessError(503,'My Skills is not configured.');res.json(await dependencies.claims.options(res.locals.claimActor,claimSearch(req.query.search),claimPage(req.query.page))); }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_DRAFT_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.post('/api/my-skills',async(req,res)=>{
    try { if(!dependencies?.claims)throw new AccessError(503,'My Skills is not configured.');await dependencies.claims.save(res.locals.claimActor,claimChange(req.body));res.json({saved:true}); }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_DRAFT_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
}
