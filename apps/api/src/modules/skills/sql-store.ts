import sql from 'mssql';
import { withRuntimeDatabase } from '../../shared/database.js';
import { AccessError } from '../../shared/errors.js';
import { catalogueChange, uuid, type CatalogueStore, type CatalogueState, type CatalogueQuery, type CatalogueSkill, type SkillLevel } from './skill-catalogue.js';
export class SqlCatalogueStore implements CatalogueStore {
 constructor(private accountId:string){if(!uuid.test(accountId))throw new Error('Catalogue requires a workspace UUID.');}
 async read(actorId:string,query:CatalogueQuery):Promise<CatalogueState> {
  try{return await withRuntimeDatabase(async pool=>{
   const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId)
    .input('query',sql.NVarChar(100),query.search).input('status',sql.VarChar(20),query.status).input('page',sql.Int,query.page).execute('dbo.ReadSkillCatalogue');
   const sets=result.recordsets as unknown as [sql.IRecordSet<{revision:number;canManage:boolean;total:number}>,sql.IRecordSet<Omit<CatalogueSkill,'levels'>>,sql.IRecordSet<SkillLevel&{skillId:string}>];
   return {...sets[0][0],page:query.page,pageSize:25,skills:sets[1].map(item=>({...item,id:item.id.toLowerCase(),levels:sets[2].filter(level=>level.skillId===item.id).map(({rank,name,description})=>({rank,name,description}))}))};
  });}catch(error){throw catalogueError(error);}
 }
 async save(actorId:string,input:unknown) {
  const change=catalogueChange(input);
  try{await withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId)
   .input('expected_revision',sql.Int,change.revision).input('target_id',sql.UniqueIdentifier,change.targetId).input('is_new',sql.Bit,change.isNew)
   .input('payload',sql.NVarChar(sql.MAX),JSON.stringify(change.payload)).execute('dbo.SaveSkillCatalogue'));
  }catch(error){throw catalogueError(error);}
 }
}
function catalogueError(error:unknown) {
 const number=(error as {number?:number})?.number;
 if(number===51003)return new AccessError(403,'Skill catalogue permission is not assigned.');
 if(number===51004)return new AccessError(404,'Workspace or skill is unavailable.');
 if(number===51009)return new AccessError(409,'Workspace changed. Reload the catalogue and review your draft before saving again.');
 if(number===51000)return new AccessError(400,(error as Error).message);
 if(number===2601||number===2627)return new AccessError(409,'A skill with this name already exists.');
 if(number===547)return new AccessError(400,'Skill definition is invalid.');
 return error;
}
