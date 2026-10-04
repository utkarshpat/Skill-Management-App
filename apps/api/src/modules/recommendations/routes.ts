import type {Express,Request,Response} from 'express';
import type {Identity,DevelopmentSessions} from '../identity/index.js';
import {can,effectiveAccess,type AccessStore} from '../access/index.js';
import {AccessError} from '../../shared/errors.js';
import {recommendationAccess,sendRecommendation,recommendationResponse,type RecommendationStore} from './recommendations.js';
export interface RecommendationDependencies{verify:(authorization:string|undefined)=>Promise<Identity>;resolveAccess?:(identity:Identity)=>Promise<string|undefined>;access?:AccessStore;recommendations?:RecommendationStore}
export function registerRecommendationRoutes(app:Express,deps:RecommendationDependencies|undefined,store?:AccessStore,demo?:DevelopmentSessions){
 app.use('/api/recommendations',async(req,res,next)=>{res.setHeader('Cache-Control','no-store');let actor:string|undefined;
 if(demo?.subject(req)){if(!demo.requestAllowed(req)||(req.method!=='GET'&&!demo.mutationAllowed(req))){res.sendStatus(403);return;}actor=(await demo.person(req))?.id;}
 else{try{if(!deps?.resolveAccess)throw Error();actor=await deps.resolveAccess(await deps.verify(req.headers.authorization));}catch{res.status(401).json({error:{message:'Sign in to continue.'}});return;}}
 const state=await(deps?.access??store)?.snapshot(),person=state?.people.find(p=>p.id===actor&&p.active);
 if(!state||!person||!can(state,person,'profile.view',true)){res.sendStatus(403);return;}res.locals.recommendationActor=person;res.locals.recommendationState=state;next();});
 async function handler(req:Request,res:Response,action:'LIST'|'OPTIONS'|'SEND'|'RESPOND'){
 try{if(!deps?.recommendations)throw new AccessError(503,'Recommendation storage is not configured.');const actor=res.locals.recommendationActor,state=res.locals.recommendationState;let value;
 if(action==='SEND'){const input=sendRecommendation(req.body),decision=recommendationAccess(state,actor,input.personId);if(!decision.allowed)throw new AccessError(403,'Recommendation denied: '+decision.reasonCode);value=await deps.recommendations.send(actor.id,input);}
 else if(action==='RESPOND'){if(!can(state,actor,'learning.view',true)||!can(state,actor,'learning.manage',true))throw new AccessError(403,'Personal learning management is not assigned.');value=await deps.recommendations.respond(actor.id,recommendationResponse(req.body));}
 else if(action==='OPTIONS'){if(!effectiveAccess(state,actor,'learning.recommend','DIRECT_REPORTS').allowed)throw new AccessError(403,'Direct report recommendations are unavailable.');if(Object.keys(req.query).some(k=>k!=='search')||typeof(req.query.search??'')!=='string'||String(req.query.search??'').length>100)throw new AccessError(400,'Check the recipient search.');value=await deps.recommendations.options(actor.id,String(req.query.search??''));}
 else{const view=req.query.view??'received',page=Number(req.query.page??1),id=req.query.id;if(Object.keys(req.query).some(k=>!['view','page','id'].includes(k))||typeof view!=='string'||!['received','sent'].includes(view)||!Number.isSafeInteger(page)||page<1||page>1000||(id!==undefined&&(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))))throw new AccessError(400,'Check recommendation filters.');if(view==='sent'?!effectiveAccess(state,actor,'learning.recommend','DIRECT_REPORTS').allowed:!can(state,actor,'learning.view',true))throw new AccessError(403,'Recommendations are unavailable.');value=await deps.recommendations.read(actor.id,view as 'received'|'sent',page,id as string|undefined);}
 if(req.method==='GET'){const current=await(deps?.access??store)!.snapshot(),person=current.people.find(p=>p.id===actor.id&&p.active);if(!person||!can(current,person,'profile.view',true))throw new AccessError(403,'Access changed. Reload your workspace.');if(current.revision!==state.revision)throw new AccessError(409,'Access or recommendations changed. Refresh before continuing.');}
 res.json(value);
 }catch(e){if(e instanceof AccessError){res.status(e.status).json({error:{message:e.message}});return;}throw e;}}
 app.get('/api/recommendations',(req,res)=>handler(req,res,'LIST'));app.get('/api/recommendations/people',(req,res)=>handler(req,res,'OPTIONS'));app.post('/api/recommendations',(req,res)=>handler(req,res,'SEND'));app.post('/api/recommendations/respond',(req,res)=>handler(req,res,'RESPOND'));
}
