import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase } from './database.js';
import { AccessError } from './local-access-store.js';

export type SkillStatus='DRAFT'|'PUBLISHED'|'ARCHIVED';
export interface SkillLevel { rank:number; name:string; description:string }
export interface CatalogueSkill { id:string; name:string; category:string; description:string; status:SkillStatus; levels:SkillLevel[] }
export interface CatalogueQuery { search:string; status:SkillStatus|''; page:number }
export interface CatalogueState { revision:number; canManage:boolean; total:number; page:number; pageSize:number; skills:CatalogueSkill[] }
export interface CatalogueStore { read(actorId:string,query:CatalogueQuery):Promise<CatalogueState>; save(actorId:string,input:unknown):Promise<void> }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses=['DRAFT','PUBLISHED','ARCHIVED'];
function text(value:unknown,max:number,required=true,compact=false):string {
 if(typeof value!=='string')throw new AccessError(400,'Enter valid skill fields.');
 const result=compact?value.trim().replace(/\s+/g,' '):value.trim();
 if(result.length>max||(required&&!result))throw new AccessError(400,'Check required fields and text lengths.');
 return result;
}
export function catalogueQuery(input:Record<string,unknown>):CatalogueQuery {
 const search=input.search===undefined?'':text(input.search,100,false,true);
 const status=input.status===undefined||input.status===''?'':input.status;
 const page=input.page===undefined?1:Number(input.page);
 if(typeof status!=='string'||(status&&!statuses.includes(status))||!Number.isSafeInteger(page)||page<1||page>100000)throw new AccessError(400,'Choose a valid catalogue filter or page.');
 return {search,status:status as CatalogueQuery['status'],page};
}
export function catalogueChange(input:unknown) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AccessError(400,'Invalid skill change.');
 const body=input as Record<string,unknown>;
 if(!Number.isSafeInteger(body.revision)||Number(body.revision)<1)throw new AccessError(400,'Reload the catalogue before saving.');
 if(typeof body.status!=='string'||!statuses.includes(body.status))throw new AccessError(400,'Choose a skill status.');
 if(body.id!==undefined&&(typeof body.id!=='string'||!uuid.test(body.id)))throw new AccessError(400,'Choose a valid skill.');
 const published=body.status==='PUBLISHED';
 if(!Array.isArray(body.levels)||body.levels.length<1||body.levels.length>8)throw new AccessError(400,'Define between one and eight proficiency levels.');
 const names=new Set<string>();
 const levels:SkillLevel[]=body.levels.map((item,index)=>{
  if(!item||typeof item!=='object'||item.rank!==index+1)throw new AccessError(400,'Keep proficiency levels in sequential order.');
  const name=text(item.name,60,true,true),description=text(item.description,1000,published);
  if(names.has(name.toLowerCase()))throw new AccessError(400,'Proficiency level names must be unique.');names.add(name.toLowerCase());
  return {rank:index+1,name,description};
 });
 return {revision:Number(body.revision),targetId:body.id===undefined?randomUUID():String(body.id).toLowerCase(),isNew:body.id===undefined,payload:{name:text(body.name,100,true,true),category:text(body.category,80,true,true),description:text(body.description,2000,published),status:body.status as SkillStatus,levels}};
}
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
