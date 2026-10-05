import {readActorAccess} from '../access/index.js';
import type {Express} from 'express';
import type {Identity,DevelopmentSessions} from '../identity/index.js';
import {can,type AccessStore} from '../access/index.js';
import {AccessError} from '../../shared/errors.js';
import {learningChange,type LearningStore} from './learning.js';
import type {LearningPracticeService} from './practice.js';
import type {LearningPlannerService} from './planner.js';
import type {LearningRecoveryService} from './recovery.js';
export interface LearningDependencies {verify:(authorization:string|undefined)=>Promise<Identity>;resolveAccess?:(identity:Identity)=>Promise<string|undefined>;access?:AccessStore;learning?:LearningStore;practice?:LearningPracticeService;planner?:LearningPlannerService;recovery?:LearningRecoveryService}
export function registerLearningRoutes(app:Express,deps:LearningDependencies|undefined,store?:AccessStore,demo?:DevelopmentSessions){
 app.use('/api/learning',async(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');let actor:string|undefined;
  if(demo?.subject(req)){if(!demo.requestAllowed(req)||(req.method!=='GET'&&!demo.mutationAllowed(req))){res.sendStatus(403);return;}actor=(await demo.person(req))?.id;}
  else{try{if(!deps?.resolveAccess)throw Error();actor=await deps.resolveAccess(await deps.verify(req.headers.authorization));}catch{res.status(401).json({error:{message:'Sign in to continue.'}});return;}}
  const state=await readActorAccess(deps?.access??store,actor),person=state?.people.find(p=>p.id===actor&&p.active);
  if(!state||!person||!can(state,person,'learning.view',true)||(req.method!=='GET'&&!can(state,person,'learning.manage',true))){res.sendStatus(403);return;}
  res.locals.learningActor=person.id;next();
 });
 app.get('/api/learning',async(req,res)=>{try{if(!deps?.learning)throw new AccessError(503,'Learning storage is not configured.');res.json(await deps.learning.read(res.locals.learningActor));}catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}});
 app.post('/api/learning',async(req,res)=>{try{if(!deps?.learning)throw new AccessError(503,'Learning storage is not configured.');await deps.learning.change(res.locals.learningActor,learningChange(req.body));res.json({saved:true});}catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}});
 for(const action of ['preview','apply','advice'] as const)app.post('/api/learning/recovery/'+action,async(req,res)=>{
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{if(!deps?.recovery)throw new AccessError(503,'Learning recovery is not configured.');const actor=res.locals.learningActor,result=action==='preview'?await deps.recovery.preview(actor,req.body):action==='apply'?await deps.recovery.apply(actor,req.body):await deps.recovery.advice(actor,req.body,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]));if(!controller.signal.aborted)res.json(result);}
  catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
 });
 app.post('/api/learning/planner',async(req,res)=>{
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{if(!deps?.planner)throw new AccessError(503,'AI planning is not configured.');const result=await deps.planner.draft(res.locals.learningActor,req.body,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]));if(!controller.signal.aborted)res.json(result);}
  catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
 });
 app.get('/api/learning/practice',async(req,res)=>{try{if(!deps?.practice)throw new AccessError(503,'Learning practice storage is not configured.');if(Object.keys(req.query).some(k=>!['planId','taskId'].includes(k)))throw new AccessError(400,'Choose your own plan and task.');res.json(await deps.practice.read(res.locals.learningActor,req.query.planId,req.query.taskId));}catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}});
 app.get('/api/learning/practice/review',async(req,res)=>{try{if(!deps?.practice)throw new AccessError(503,'Learning practice storage is not configured.');if(Object.keys(req.query).some(k=>!['planId','taskId','id'].includes(k)))throw new AccessError(400,'Choose your own saved attempt.');res.json(await deps.practice.review(res.locals.learningActor,req.query.planId,req.query.taskId,req.query.id));}catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}});
 for(const action of ['session','quiz','attempt'] as const)app.post('/api/learning/practice/'+action,async(req,res)=>{
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{if(!deps?.practice)throw new AccessError(503,'Learning practice storage is not configured.');const body=req.body;
   const fields=action==='session'?['revision','notes','minutes','resources']:action==='quiz'?['count']:['id','quizId','answers'];
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['planId','taskId',...fields].includes(k)))throw new AccessError(400,'Only editable practice fields are accepted.');
   const {planId,taskId,...input}=body;const actor=res.locals.learningActor;
   const result=action==='quiz'?await deps.practice.quiz(actor,planId,taskId,input,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])):action==='session'?await deps.practice.session(actor,planId,taskId,input):await deps.practice.attempt(actor,planId,taskId,input);
   if(!controller.signal.aborted)res.json(result);
  }catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}
 });
}
