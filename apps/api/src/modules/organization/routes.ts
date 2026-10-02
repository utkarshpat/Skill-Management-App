import type { Express } from 'express';
import { can } from '../access/index.js';
import { AccessError } from '../../shared/errors.js';
import type { OrganizationStore } from './organization.js';
export interface HttpDependencies { organization?: OrganizationStore; }
export function registerRoutes(app: Express, dependencies: HttpDependencies | undefined) {
  app.get('/api/access/organization',async(_req,res)=>{
    if(!dependencies?.organization||!res.locals.accessState||!res.locals.accessPerson||!can(res.locals.accessState,res.locals.accessPerson,'users.manage')){res.sendStatus(403);return;}
    res.json(await dependencies.organization.snapshot());
  });
  app.post('/api/access/organization',async(req,res)=>{
    if(!dependencies?.organization||!res.locals.accessState||!res.locals.accessPerson||!can(res.locals.accessState,res.locals.accessPerson,'users.manage')){res.sendStatus(403);return;}
    try { await dependencies.organization.save(res.locals.accessPerson.id,req.body);res.json({saved:true}); }
    catch(error){if(error instanceof AccessError){res.status(error.status).json({error:{code:'ORGANIZATION_CHANGE_REJECTED',message:error.message,requestId:res.locals.requestId}});return;}throw error;}
  });
}
