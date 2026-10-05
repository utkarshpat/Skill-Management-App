import sql from 'mssql';
import type {Identity} from '../identity/index.js';
import { withRuntimeDatabase } from '../../shared/database.js';
import { LocalAccessStore, AccessError, type AccessStore, type LocalAccessState, type Assignment } from './local-access-store.js';
type PermissionRow = { permission:Assignment['permission'];scope:Assignment['scope'];effect:Assignment['effect'];validUntil:Date|null;reason:string|null };
type ResultSets = [
  sql.IRecordSet<{revision:number}>,
  sql.IRecordSet<{id:string;name:string}>,
  sql.IRecordSet<PermissionRow & {roleId:string}>,
  sql.IRecordSet<{id:string;displayName:string;employeeCode:string;jobTitle:string|null;grade:string|null;active:boolean;hasDirectReports:boolean;entraObjectId:string|null}>,
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
      const assignment=(row:PermissionRow):Assignment => ({ permission:row.permission,scope:row.scope,effect:row.effect,...(row.validUntil ? {validUntil:row.validUntil.toISOString()} : {}),...(row.reason?{reason:row.reason}:{}) });
      const group=<T>(rows:T[],key:(row:T)=>string)=>{const groups=new Map<string,T[]>();for(const row of rows){const id=key(row);const list=groups.get(id)??[];list.push(row);groups.set(id,list);}return groups;};
      const permissions=group([...sets[2]],row=>row.roleId),roles=group([...sets[4]],row=>row.personId),overrides=group([...sets[5]],row=>row.personId);
      return {
        revision:sets[0][0].revision,
        reporting:sets[7].map(row=>({personId:row.personId.toLowerCase(),managerId:row.managerId?.toLowerCase()??null})),
        roles:sets[1].map(row=>({id:row.id.toLowerCase(),name:row.name,permissions:(permissions.get(row.id)??[]).map(assignment)})),
        people:sets[3].map(row=>({id:row.id.toLowerCase(),displayName:row.displayName,employeeCode:row.employeeCode,jobTitle:row.jobTitle,grade:row.grade,active:row.active,hasDirectReports:Boolean(row.hasDirectReports),...(row.entraObjectId?{entraObjectId:row.entraObjectId.toLowerCase()}:{}),roleIds:(roles.get(row.id)??[]).map(item=>item.roleId.toLowerCase()),overrides:(overrides.get(row.id)??[]).map(assignment)})),
        audit:sets[6].map(row=>({actorId:row.actorId.toLowerCase(),action:row.action,targetId:row.targetId.toLowerCase(),at:row.at.toISOString(),revision:row.revision,...(row.before?{before:JSON.parse(row.before)}:{}),after:JSON.parse(row.after)})),
      };
    });
  }
  async person(id: string) { return (await this.snapshot({includeAudit:false})).people.find(person=>person.id===id&&person.active); }
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
      if([51000,2601,2627,547].includes(number??0))throw new AccessError(400,'Access change rejected. Check assignments and keep an active administrator.');
      throw error;
    }
    return this.snapshot();
  }
}
