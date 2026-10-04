import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';

import { can, type AccessStore } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import type { AssistantService } from './assistant.js';

export interface HttpDependencies { verify: (authorization: string | undefined) => Promise<Identity>; resolveAccess?: (identity: Identity) => Promise<string | undefined>; access?: AccessStore; assistant?: AssistantService; }
export function registerRoutes(app: Express, dependencies: HttpDependencies | undefined, store?: AccessStore, demo?: DevelopmentSessions) {
  app.use('/api/assistant',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    const access=dependencies?.access??store;let actor:string|undefined;
    if(demo?.subject(req)){
      if(!demo.requestAllowed(req)||(!['GET','HEAD'].includes(req.method)&&!demo!.mutationAllowed(req))){res.sendStatus(403);return;}
      actor=(await demo.person(req))?.id;
    }else{
      try{if(!dependencies?.resolveAccess)throw new Error();actor=await dependencies.resolveAccess(await dependencies.verify(req.headers.authorization));}
      catch{res.status(401).json({error:{code:'NOT_AUTHORIZED',message:'Sign in to continue.',requestId:res.locals.requestId}});return;}
    }
    const state=await access?.snapshot(),person=state?.people.find(item=>item.id===actor&&item.active);
    if(!state||!person||!can(state,person,'profile.view',true)){res.sendStatus(403);return;}
    res.locals.assistantActor=person.id;next();
  });
  app.get('/api/assistant',(_req,res)=>res.json(dependencies?.assistant?.status()??{configured:false,provider:null,mode:'read-only'}));
  const navigationHandler:import('express').RequestHandler=async(req,res)=>{
   try{if(!dependencies?.assistant)throw new AccessError(503,'Assistant is unavailable.');res.json(await dependencies.assistant.navigation(res.locals.assistantActor,req.method==='POST'?req.body:undefined));}
   catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'ASSISTANT_ACTION_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  };
  app.get('/api/assistant/navigation',navigationHandler);
  app.post('/api/assistant/navigation',navigationHandler);
  const historyHandler:import('express').RequestHandler=async(req,res)=>{
   try{if(!dependencies?.assistant)throw new AccessError(503,'Assistant history is unavailable.');
    res.json(await dependencies.assistant.history(res.locals.assistantActor,req.params.id?String(req.params.id):undefined,req.method==='DELETE'));
   }catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'ASSISTANT_HISTORY_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  };
  app.get('/api/assistant/conversations',historyHandler);
  app.get('/api/assistant/conversations/:id',historyHandler);
  app.delete('/api/assistant/conversations/:id',historyHandler);
  app.post('/api/assistant/skill-review',async(req,res)=>{
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{if(!dependencies?.assistant)throw new AccessError(503,'Assistant is unavailable.');const result=await dependencies.assistant.reviewAssistance(res.locals.assistantActor,req.body,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]));if(!controller.signal.aborted)res.json(result);}
    catch(e){if(e instanceof AccessError){res.status(e.status).json({error:{message:e.message}});return;}throw e;}
  });
  app.post('/api/assistant/workflow-draft',async(req,res)=>{
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{if(!dependencies?.assistant)throw new AccessError(503,'Assistant is unavailable.');const result=await dependencies.assistant.workflowDraft(res.locals.assistantActor,req.body,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]));if(!controller.signal.aborted)res.json(result);}
    catch(e){if(e instanceof AccessError){res.status(e.status).json({error:{message:e.message}});return;}throw e;}
  });
  app.post('/api/assistant',async(req,res)=>{
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{
      if(!dependencies?.assistant)throw new AccessError(503,'AI model is not connected yet.');
      const result=await dependencies.assistant.chat(res.locals.assistantActor,req.body,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]));
      if(!controller.signal.aborted)res.json(result);
    }catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'ASSISTANT_REQUEST_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
}
