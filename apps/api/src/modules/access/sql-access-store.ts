import sql from 'mssql';
import type {Identity} from '../identity/index.js';
import { withRuntimeDatabase } from '../../shared/database.js';
import { LocalAccessStore, AccessError, type AccessStore, type LocalAccessState, type Assignment } from './local-access-store.js';
import type {AuditQuery,AuditPage,AuditItem} from './audit.js';
import {validatePrimaryCapabilityChange,type PrimaryCapability,type PrimaryCapabilityDetails,type PrimaryCapabilityPage} from './primary-capability.js';
type PermissionRow = { permission:Assignment['permission'];scope:Assignment['scope'];effect:Assignment['effect'];validUntil:Date|null;reason:string|null };
type ResultSets = [
  sql.IRecordSet<{revision:number}>,
  sql.IRecordSet<{id:string;name:string}>,
  sql.IRecordSet<PermissionRow & {roleId:string}>,
  sql.IRecordSet<PrimaryCapabilityDetails & {id:string;displayName:string;employeeCode:string;jobTitle:string|null;grade:string|null;active:boolean;hasDirectReports:boolean;entraObjectId:string|null}>,
  sql.IRecordSet<{personId:string;roleId:string}>,
  sql.IRecordSet<PermissionRow & {personId:string}>,
  sql.IRecordSet<{actorId:string;action:string;targetId:string;at:Date;revision:number;before:string|null;after:string}>,
  sql.IRecordSet<{personId:string;managerId:string|null}>,
];

export class SqlAccessStore implements AccessStore {
  readonly storage = 'azure-sql' as const;
  constructor(private accountId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) throw new Error('ACCESS_ACCOUNT_ID must be a UUID.');
  }
  async snapshot(options:{includeAudit?:boolean;auditPersonId?:string}={}): Promise<LocalAccessState> {
    return withRuntimeDatabase(async pool => {
      const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('include_audit',sql.Bit,options.includeAudit??true).input('audit_person_id',sql.UniqueIdentifier,options.auditPersonId??null).execute('dbo.ReadAccessWorkspace');
      const sets=result.recordsets as unknown as ResultSets;
      return this.decode(sets);
    });
  }
  private decode(sets:ResultSets,actorOnly=false):LocalAccessState {
      const assignment=(row:PermissionRow):Assignment => ({ permission:row.permission,scope:row.scope,effect:row.effect,...(row.validUntil ? {validUntil:row.validUntil.toISOString()} : {}),...(row.reason?{reason:row.reason}:{}) });
      const group=<T>(rows:T[],key:(row:T)=>string)=>{const groups=new Map<string,T[]>();for(const row of rows){const id=key(row);const list=groups.get(id)??[];list.push(row);groups.set(id,list);}return groups;};
      const permissions=group([...sets[2]],row=>row.roleId),roles=group([...sets[4]],row=>row.personId),overrides=group([...sets[5]],row=>row.personId);
      return {
        revision:sets[0][0].revision,
        reporting:actorOnly?undefined:sets[7].map(row=>({personId:row.personId.toLowerCase(),managerId:row.managerId?.toLowerCase()??null})),
        roles:sets[1].map(row=>({id:row.id.toLowerCase(),name:row.name,permissions:(permissions.get(row.id)??[]).map(assignment)})),
        people:sets[3].map(row=>({id:row.id.toLowerCase(),displayName:row.displayName,employeeCode:row.employeeCode,jobTitle:row.jobTitle,grade:row.grade,primaryCapabilityId:row.primaryCapabilityId===undefined?undefined:row.primaryCapabilityId?.toLowerCase()??null,primaryCapabilityName:row.primaryCapabilityName,primaryCapabilityStatus:row.primaryCapabilityStatus,active:row.active,hasDirectReports:Boolean(row.hasDirectReports),...(row.entraObjectId?{entraObjectId:row.entraObjectId.toLowerCase()}:{}),roleIds:(roles.get(row.id)??[]).map(item=>item.roleId.toLowerCase()),overrides:(overrides.get(row.id)??[]).map(assignment)})),
        audit:sets[6].map(row=>({actorId:row.actorId.toLowerCase(),action:row.action,targetId:row.targetId.toLowerCase(),at:row.at.toISOString(),revision:row.revision,...(row.before?{before:JSON.parse(row.before)}:{}),after:JSON.parse(row.after)})),
      };
  }
  async actorSnapshot(actorId:string,options:{includeAudit?:boolean}={}) {
    return withRuntimeDatabase(async pool=>{
      const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('include_notifications',sql.Bit,options.includeAudit??false).execute('dbo.ReadActorAccessContext');
      return this.decode(result.recordsets as unknown as ResultSets,true);
    });
  }
  async person(id: string) { return (await this.actorSnapshot(id)).people.find(person=>person.id===id&&person.active); }
  async primaryCapabilities(actorId:string,query:{search:string;page:number;id?:string}):Promise<PrimaryCapabilityPage>{
    try{return await withRuntimeDatabase(async pool=>{
      const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('query',sql.NVarChar(100),query.search).input('page',sql.Int,query.page).input('skill_id',sql.UniqueIdentifier,query.id??null).execute('dbo.ReadPrimaryCapabilities');
      const sets=result.recordsets as unknown as [{total:number;page:number;pageSize:number}[],PrimaryCapability[]];
      return {...sets[0][0],items:sets[1].map(item=>({...item,id:item.id.toLowerCase()}))};
    });}catch(error){
      const number=error&&typeof error==='object'&&'number' in error?Number(error.number):undefined;
      if(number===51003)throw new AccessError(403,'People and access administration are required.');
      if(number===51004)throw new AccessError(404,'Your workspace is unavailable.');
      if(number===51000)throw new AccessError(400,'Invalid capability search.');
      throw error;
    }
  }
  async auditPage(actorId:string,query:AuditQuery):Promise<AuditPage> {
    return withRuntimeDatabase(async pool=>{
      try {
        const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId).input('before',sql.Int,query.before??null).input('person_id',sql.UniqueIdentifier,query.personId??null).input('query',sql.NVarChar(100),query.query).input('page_size',sql.Int,query.pageSize).input('include_details',sql.Bit,query.details).execute('dbo.ReadAccessAuditPage');
        const sets=result.recordsets as unknown as [{revision:number}[],(Omit<AuditItem,'at'|'before'|'after'>&{at:Date;before:string|null;after:string|null})[]];
        const hasMore=sets[1].length>query.pageSize,items=sets[1].slice(0,query.pageSize).map(e=>({...e,actorId:e.actorId.toLowerCase(),targetId:e.targetId.toLowerCase(),at:e.at.toISOString(),before:e.before?JSON.parse(e.before):undefined,after:e.after?JSON.parse(e.after):undefined}));
        return {items,hasMore,nextCursor:hasMore?items.at(-1)!.revision:null,revision:sets[0][0].revision};
      } catch(error) {if(error&&typeof error==='object'&&'number' in error&&Number(error.number)===51003)throw new AccessError(403,'Activity viewing is not assigned.');throw error;}
    });
  }
  async resolveIdentity(identity:Identity) {
    return withRuntimeDatabase(async pool=>{
      const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).input('tenant_id',sql.UniqueIdentifier,identity.tenantId).input('object_id',sql.UniqueIdentifier,identity.objectId).execute('dbo.ResolveAccessIdentity');
      return result.recordset[0]?.id?.toLowerCase() as string|undefined;
    });
  }
  async save(actorId: string,input: unknown) {
    // Reuse the validated permission model, then recheck authority/revision inside the SQL transaction.
    const current=await this.snapshot({includeAudit:false});
    const candidate=await LocalAccessStore.fromState(current).save(actorId,input);
    await validatePrimaryCapabilityChange(this,current,actorId,input);
    const event=candidate.audit.at(-1)!;
    const payload=event.action.startsWith('role.') ? candidate.roles.find(role=>role.id===event.targetId)! : candidate.people.find(person=>person.id===event.targetId)!;
    try {
      await withRuntimeDatabase(pool=>pool.request()
        .input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId)
        .input('expected_revision',sql.Int,current.revision).input('kind',sql.VarChar(10),event.action.split('.')[0])
        .input('target_id',sql.UniqueIdentifier,event.targetId).input('is_new',sql.Bit,event.action.endsWith('.created'))
        .input('payload',sql.NVarChar(sql.MAX),JSON.stringify(payload)).execute('dbo.SaveAccessChange'));
    } catch(error) {
      const number=error && typeof error==='object' && 'number' in error ? Number(error.number) : undefined;
      if(number===51009)throw new AccessError(409,'Configuration changed. Reload and try again.');
      if(number===51003)throw new AccessError(403,'Permission administration is not allowed.');
      if(number===51004)throw new AccessError(404,'Workspace or record is unavailable.');
      if(number===51010)throw new AccessError(400,'Choose a currently published capability from this workspace. Reload and preview again.');
      if([51000,2601,2627,547].includes(number??0))throw new AccessError(400,'Access change rejected. Check assignments and keep an active administrator.');
      throw error;
    }
    return this.snapshot({includeAudit:false});
  }
}
