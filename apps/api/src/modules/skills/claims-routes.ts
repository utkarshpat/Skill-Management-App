import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';
import { can, canReviewAssigned, effectiveClaimReview, effectiveAccess, type AccessStore } from '../access/index.js';

import { AccessError } from '../../shared/errors.js';
import { claimChange, claimCategory, claimResultSize, claimPage, claimSearch, claimTransition, teamQuery, reviewQuery, reviewIdentifier, type ClaimsStore } from './claims.js';

export interface ClaimsHttpDependencies {
  verify:(authorization:string|undefined)=>Promise<Identity>;
  resolveAccess?:(identity:Identity)=>Promise<string|undefined>;
  access?:AccessStore; claims?:ClaimsStore;
}
export function registerClaimsRoutes(app:Express, dependencies:ClaimsHttpDependencies|undefined, store?:AccessStore, demo?:DevelopmentSessions) {
  app.use(['/api/my-skills','/api/skill-reviews'],async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    let actor:string|undefined;
    if(demo?.subject(req)) {
      if(!demo.requestAllowed(req)||(req.method==='POST'&&!demo!.mutationAllowed(req))){res.sendStatus(403);return;}
      actor=(await demo.person(req))?.id;
    } else {
      let identity:Identity;
      try { if(!dependencies?.resolveAccess)throw new Error();identity=await dependencies.verify(req.headers.authorization); }
      catch { res.status(401).json({error:{code:'NOT_AUTHORIZED',message:'Sign in to continue.',requestId:res.locals.requestId}});return; }
      actor=await dependencies!.resolveAccess!(identity);
    }
    const state=await (dependencies?.access??store)?.snapshot({includeAudit:false}),person=state?.people.find(item=>item.id===actor&&item.active);
    const review=req.baseUrl==='/api/skill-reviews';
    if(!state||!person||!can(state,person,'profile.view',true)||(review?!canReviewAssigned(state,person):(!can(state,person,'skill.view',true)||((req.method==='POST'||req.path==='/catalogue')&&(!can(state,person,'skill.claim',true)||!can(state,person,'skill.view')))))){res.sendStatus(403);return;}
    res.locals.claimActor=person.id;next();
  });
  app.get('/api/my-skills/journey',async(req,res)=>{
    try {
      if(Object.keys(req.query).length)throw new AccessError(400,'Journey scope is resolved from your own learning plans.');
      const state=await (dependencies?.access??store)?.snapshot({includeAudit:false}),person=state?.people.find(p=>p.id===res.locals.claimActor&&p.active);
      if(!state||!person||!can(state,person,'learning.view',true))throw new AccessError(403,'Learning access is unavailable.');
      if(!dependencies?.claims?.journey)throw new AccessError(503,'Growth claim status is unavailable.');
      res.json(await dependencies.claims.journey(person.id));
    } catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
  });
  app.get('/api/my-skills',async(req,res)=>{
    try { if(!dependencies?.claims)throw new AccessError(503,'My Skills is not configured.');res.json(await dependencies.claims.read(res.locals.claimActor,claimPage(req.query.page))); }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_DRAFT_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.get('/api/my-skills/catalogue',async(req,res)=>{
    try { if(!dependencies?.claims)throw new AccessError(503,'My Skills is not configured.');res.json(await dependencies.claims.options(res.locals.claimActor,claimSearch(req.query.search),claimPage(req.query.page),claimCategory(req.query.category),claimResultSize(req.query.pageSize))); }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_DRAFT_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.post('/api/my-skills',async(req,res)=>{
    try { if(!dependencies?.claims)throw new AccessError(503,'My Skills is not configured.');await dependencies.claims.save(res.locals.claimActor,claimChange(req.body));res.json({saved:true}); }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_DRAFT_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.get('/api/skill-reviews',async(req,res)=>{
    try{if(!dependencies?.claims?.reviews)throw new AccessError(503,'Skill reviews are not configured.');const before=await (dependencies?.access??store)?.snapshot({includeAudit:false});if(!before)throw new AccessError(403,'Review access unavailable.');const revision=before.revision;const query=reviewQuery(req.query),data=await dependencies.claims.reviews(res.locals.claimActor,claimPage(req.query.page),query);const state=await (dependencies?.access??store)?.snapshot({includeAudit:false}),person=state?.people.find(p=>p.id===res.locals.claimActor&&p.active);if(!state||!person||!canReviewAssigned(state,person)||!can(state,person,'profile.view',true))throw new AccessError(403,'Review access changed.');if(state.revision!==revision)throw new AccessError(409,'Review assignments changed. Refresh before continuing.');res.json({...data,canRecommend:effectiveAccess(state,person,'learning.recommend','DIRECT_REPORTS').allowed,canViewTeam:Boolean(dependencies.claims.team&&can(state,person,'skill.view')),canReadHistory:Boolean(dependencies.claims.reviewDetail)});}
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_REVIEW_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  for(const path of ['/api/my-skills/submit','/api/skill-reviews/decision'])app.post(path,async(req,res)=>{
    try{
      if(!dependencies?.claims?.transition)throw new AccessError(503,'Skill reviews are not configured.');
      const change=claimTransition(req.body);
      if((path.endsWith('/submit'))!==(change.action==='SUBMIT'))throw new AccessError(400,'Choose a valid action for this page.');
      if(change.action!=='SUBMIT'){
        if(!dependencies.claims.reviewDetail)throw new AccessError(503,'Current claim access cannot be checked.');
        const access=dependencies.access??store,before=await access?.snapshot({includeAudit:false});
        if(!before)throw new AccessError(403,'Review access unavailable.');
        const detail=await dependencies.claims.reviewDetail(res.locals.claimActor,change.id,1);
        const after=await access!.snapshot({includeAudit:false}),actor=after.people.find(person=>person.id===res.locals.claimActor&&person.active);
        if(after.revision!==before.revision||detail.claim.revision!==change.revision)throw new AccessError(409,'Review records changed. Refresh before continuing.');
        if(!actor||!effectiveClaimReview(after,actor,detail.claim).allowed)throw new AccessError(403,'This claim is not currently available for your decision.');
      }
      // SQL rechecks exact resource authority and revision inside its transaction.
      await dependencies.claims.transition(res.locals.claimActor,change);res.json({saved:true});
    }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_REVIEW_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.get('/api/skill-reviews/team',async(req,res)=>{
    try{
      const query=teamQuery(req.query),access=dependencies?.access??store;
      const before=await access?.snapshot({includeAudit:false}),actor=before?.people.find(p=>p.id===res.locals.claimActor&&p.active);
      if(!before||!actor||!can(before,actor,'skill.view')||!canReviewAssigned(before,actor))throw new AccessError(403,'Team capability access is unavailable.');
      if(!dependencies?.claims?.team)throw new AccessError(503,'Team capability is not configured.');
      const revision=before.revision,data=await dependencies.claims.team(actor.id,query);
      const after=await access!.snapshot({includeAudit:false}),current=after.people.find(p=>p.id===actor.id&&p.active);
      if(!current||!can(after,current,'profile.view',true)||!can(after,current,'skill.view')||!canReviewAssigned(after,current))throw new AccessError(403,'Team access changed. Reload your workspace.');
      if(after.revision!==revision)throw new AccessError(409,'Team assignments or claims changed. Refresh to load current records.');
      res.json(data);
    }catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'TEAM_CAPABILITY_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.get('/api/skill-reviews/:id',async(req,res)=>{
    try{
      if(Object.keys(req.query).some(key=>key!=='page'))throw new AccessError(400,'Unsupported history selector.');
      const id=reviewIdentifier(req.params.id),page=claimPage(req.query.page),access=dependencies?.access??store;
      const before=await access?.snapshot({includeAudit:false});if(!before)throw new AccessError(403,'Review access unavailable.');const revision=before.revision;
      if(!dependencies?.claims?.reviewDetail)throw new AccessError(503,'Review history is not configured.');
      const data=await dependencies.claims.reviewDetail(res.locals.claimActor,id,page),after=await access!.snapshot({includeAudit:false}),person=after.people.find(p=>p.id===res.locals.claimActor&&p.active);
      if(!person||!canReviewAssigned(after,person)||!can(after,person,'profile.view',true))throw new AccessError(403,'Review access changed.');
      if(after.revision!==revision)throw new AccessError(409,'Review records changed. Refresh before continuing.');
      const reviewAccess=effectiveClaimReview(after,person,data.claim);
      if(!reviewAccess.allowed&&reviewAccess.reasonCode!=='NOT_AWAITING_REVIEW')throw new AccessError(404,'Assigned review unavailable.');
      res.json({...data,reviewAccess});
    }catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'SKILL_REVIEW_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
}
