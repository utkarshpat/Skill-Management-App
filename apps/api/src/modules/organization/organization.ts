import { randomUUID } from 'node:crypto';
import { AccessError } from '../../shared/errors.js';

export type NodeKind = 'DELIVERY_UNIT' | 'DEPARTMENT' | 'TEAM';
export interface OrgNode { id:string; kind:NodeKind; name:string; parentId:string|null; active:boolean }
export interface OrgAssignment { personId:string; teamId:string|null; departmentId?:string|null; managerId:string|null }
export interface OrgPerson { id:string; displayName:string; employeeCode:string; active:boolean }
export interface OrganizationState { revision:number; nodes:OrgNode[]; assignments:OrgAssignment[]; people:OrgPerson[] }
export interface OrganizationStore { snapshot():Promise<OrganizationState>; save(actorId:string,input:unknown):Promise<void> }
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function identifier(value:unknown,optional=false):string|null {
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
  if(body.kind==='assignment') {
    const teamId=identifier(body.teamId,true),departmentId=identifier(body.departmentId,true);
    if(teamId&&departmentId)throw new AccessError(400,'Choose either a department or a team.');
    return {kind:'assignment',revision:Number(body.revision),targetId:identifier(body.personId)!,isNew:false,payload:{teamId,departmentId,managerId:identifier(body.managerId,true)}};
  }
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
