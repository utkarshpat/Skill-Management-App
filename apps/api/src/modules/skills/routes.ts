import {readActorAccess} from '../access/index.js';
import type { Express } from 'express';
import type { Identity, DevelopmentSessions } from '../identity/index.js';

import { can, type AccessStore } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import { catalogueQuery, type CatalogueStore } from './skill-catalogue.js';

export interface HttpDependencies { verify: (authorization: string | undefined) => Promise<Identity>; resolveAccess?: (identity: Identity) => Promise<string | undefined>; access?: AccessStore; catalogue?: CatalogueStore; }
export function registerRoutes(app: Express, dependencies: HttpDependencies | undefined, store?: AccessStore, demo?: DevelopmentSessions) {
  // Catalogue authorization is independent of permission-administration access.
  app.use('/api/skills',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    let actor:string|undefined;
    if(demo?.subject(req)){
      if(!demo.requestAllowed(req)||(req.method==='POST'&&!demo!.mutationAllowed(req))){res.sendStatus(403);return;}
      actor=(await demo.person(req))?.id;
    }else{
      let identity:Identity;
      try{if(!dependencies?.resolveAccess)throw new Error();identity=await dependencies.verify(req.headers.authorization);}
      catch{res.status(401).json({error:{code:'NOT_AUTHORIZED',message:'Sign in to continue.',requestId:res.locals.requestId}});return;}
      actor=await dependencies!.resolveAccess!(identity);
    }
    const state=await readActorAccess(dependencies?.access??store,actor),person=state?.people.find(item=>item.id===actor&&item.active);
    if(!state||!person||!(req.method==='POST'?can(state,person,'skill.catalogue.manage'):can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage'))){res.sendStatus(403);return;}
    res.locals.catalogueActor=person.id;next();
  });
  app.get('/api/skills',async(req,res)=>{
    try{if(!dependencies?.catalogue)throw new AccessError(503,'Skill catalogue is not configured.');res.json(await dependencies.catalogue.read(res.locals.catalogueActor,catalogueQuery(req.query)));}
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'CATALOGUE_REQUEST_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
  app.post('/api/skills',async(req,res)=>{
    try{if(!dependencies?.catalogue)throw new AccessError(503,'Skill catalogue is not configured.');await dependencies.catalogue.save(res.locals.catalogueActor,req.body);res.json({saved:true});}
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'CATALOGUE_CHANGE_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
}
