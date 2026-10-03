import type {Express} from 'express';
import type {Identity,DevelopmentSessions} from '../identity/index.js';
import {can,type AccessStore} from '../access/index.js';
import {AccessError} from '../../shared/errors.js';
import {learningChange,type LearningStore} from './learning.js';
export interface LearningDependencies {verify:(authorization:string|undefined)=>Promise<Identity>;resolveAccess?:(identity:Identity)=>Promise<string|undefined>;access?:AccessStore;learning?:LearningStore}
export function registerLearningRoutes(app:Express,deps:LearningDependencies|undefined,store?:AccessStore,demo?:DevelopmentSessions){
 app.use('/api/learning',async(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');let actor:string|undefined;
  if(demo?.subject(req)){if(!demo.requestAllowed(req)||(req.method!=='GET'&&!demo.mutationAllowed(req))){res.sendStatus(403);return;}actor=(await demo.person(req))?.id;}
  else{try{if(!deps?.resolveAccess)throw Error();actor=await deps.resolveAccess(await deps.verify(req.headers.authorization));}catch{res.status(401).json({error:{message:'Sign in to continue.'}});return;}}
  const state=await(deps?.access??store)?.snapshot(),person=state?.people.find(p=>p.id===actor&&p.active);
  if(!state||!person||!can(state,person,'learning.view',true)||(req.method!=='GET'&&!can(state,person,'learning.manage',true))){res.sendStatus(403);return;}
  res.locals.learningActor=person.id;next();
 });
 app.get('/api/learning',async(req,res)=>{try{if(!deps?.learning)throw new AccessError(503,'Learning storage is not configured.');res.json(await deps.learning.read(res.locals.learningActor));}catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}});
 app.post('/api/learning',async(req,res)=>{try{if(!deps?.learning)throw new AccessError(503,'Learning storage is not configured.');await deps.learning.change(res.locals.learningActor,learningChange(req.body));res.json({saved:true});}catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{message:error.message}});return;}throw error;}});
}
