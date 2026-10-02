import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase } from './database.js';
import { AccessError } from './local-access-store.js';

export type NodeKind = 'DELIVERY_UNIT' | 'DEPARTMENT' | 'TEAM';
export interface OrgNode { id:string; kind:NodeKind; name:string; parentId:string|null; active:boolean }
export interface OrgAssignment { personId:string; teamId:string|null; managerId:string|null }
export interface OrgPerson { id:string; displayName:string; employeeCode:string; active:boolean }
export interface OrganizationState { revision:number; nodes:OrgNode[]; assignments:OrgAssignment[]; people:OrgPerson[] }
export interface OrganizationStore { snapshot():Promise<OrganizationState>; save(actorId:string,input:unknown):Promise<void> }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function identifier(value:unknown,optional=false):string|null {
  if(optional&&(value===null||value===undefined||value===''))return null;
  if(typeof value!=='string'||!uuid.test(value))throw new AccessError(400,'Choose a valid workspace record.');
  return value.toLowerCase();
}
export function organizationChange(input:unknown) {
  if(!input||typeof input!=='object')throw new AccessError(400,'Invalid organization change.');
  const body=input as Record<string,unknown>;
  if(!Number.isSafeInteger(body.revision)||Number(body.revision)<1)throw new AccessError(400,'Reload the current organization before saving.');
  if(body.kind==='node') {
    if(!['DELIVERY_UNIT','DEPARTMENT','TEAM'].includes(String(body.type))||typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100||typeof body.active!=='boolean')throw new AccessError(400,'Enter a name, type and status.');
    const parentId=identifier(body.parentId,true);
    if((body.type==='DELIVERY_UNIT')!==(parentId===null))throw new AccessError(400,'Choose the parent for this level.');
    return {kind:'node',revision:Number(body.revision),targetId:body.id===undefined?randomUUID():identifier(body.id)!,isNew:body.id===undefined,payload:{type:body.type,name:body.name.trim(),parentId,active:body.active}};
  }
  if(body.kind==='assignment')return {kind:'assignment',revision:Number(body.revision),targetId:identifier(body.personId)!,isNew:false,payload:{teamId:identifier(body.teamId,true),managerId:identifier(body.managerId,true)}};
  throw new AccessError(400,'Unknown organization change.');
}

// Shared derivation for review routing. An absent edge ends the chain; broken,
// inactive, duplicate or circular edges fail closed instead of choosing a role.
export function reportingChain(state:OrganizationState,personId:string):OrgPerson[] {
  const seen=new Set([personId]);const chain:OrgPerson[]=[];
  if(!state.people.some(person=>person.id===personId&&person.active))throw new AccessError(400,'Active person unavailable.');
  let current=personId;
  for(let depth=0;depth<=200;depth++) {
    const edges=state.assignments.filter(item=>item.personId===current);
    if(edges.length>1)throw new AccessError(400,'Ambiguous reporting line.');
    const managerId=edges[0]?.managerId;
    if(!managerId)return chain;
    const manager=state.people.find(person=>person.id===managerId&&person.active);
    if(!manager||seen.has(managerId)||depth===200)throw new AccessError(400,'Reporting line needs administrator attention.');
    seen.add(managerId);chain.push(manager);current=managerId;
  }
  throw new AccessError(400,'Reporting chain is too deep.');
}

export class SqlOrganizationStore implements OrganizationStore {
  constructor(private accountId:string) { identifier(accountId); }
  async snapshot():Promise<OrganizationState> {
    return withRuntimeDatabase(async pool=>{
      const result=await pool.request().input('account_id',sql.UniqueIdentifier,this.accountId).execute('dbo.ReadOrganization');
      const sets=result.recordsets as unknown as [sql.IRecordSet<{revision:number}>,sql.IRecordSet<OrgNode>,sql.IRecordSet<OrgAssignment>,sql.IRecordSet<OrgPerson>];
      return {revision:sets[0][0].revision,nodes:sets[1].map(row=>({...row,id:row.id.toLowerCase(),parentId:row.parentId?.toLowerCase()??null})),assignments:sets[2].map(row=>({personId:row.personId.toLowerCase(),teamId:row.teamId?.toLowerCase()??null,managerId:row.managerId?.toLowerCase()??null})),people:sets[3].map(row=>({...row,id:row.id.toLowerCase()}))};
    });
  }
  async save(actorId:string,input:unknown) {
    const change=organizationChange(input);
    try {
      await withRuntimeDatabase(pool=>pool.request()
        .input('account_id',sql.UniqueIdentifier,this.accountId).input('actor_id',sql.UniqueIdentifier,actorId)
        .input('expected_revision',sql.Int,change.revision).input('kind',sql.VarChar(20),change.kind)
        .input('target_id',sql.UniqueIdentifier,change.targetId).input('is_new',sql.Bit,change.isNew)
        .input('payload',sql.NVarChar(sql.MAX),JSON.stringify(change.payload)).execute('dbo.SaveOrganizationChange'));
    } catch(error) {
      const number=(error as {number?:number}).number;
      if(number===51009)throw new AccessError(409,'Configuration changed. Reload and try again.');
      if(number===51003)throw new AccessError(403,'Organization administration is not assigned.');
      if(number===51004)throw new AccessError(404,'Workspace record unavailable.');
      if(number===51000)throw new AccessError(400,(error as Error).message);
      if([2601,2627].includes(number??0))throw new AccessError(400,'This name already exists under the selected parent.');
      if(number===547)throw new AccessError(400,'Choose records from this workspace.');
      throw error;
    }
  }
}
