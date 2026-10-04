import { createHash } from 'node:crypto';
import { AccessError, LocalAccessStore, type LocalAccessState } from './local-access-store.js';
import { effectiveAccessSummary } from './effective-access.js';

// A revision-bound review receipt, never an authorization token. Save rechecks
// validation/authority and SQL checks revision again inside its transaction.
export async function previewAccessChange(state:LocalAccessState,actorId:string,input:unknown){
  if(!input||typeof input!=='object')throw new AccessError(400,'Invalid access change.');
  const {previewReceipt:_receipt,...body}=input as Record<string,unknown>;
  const candidate=await LocalAccessStore.fromState(state).save(actorId,body);
  const event=candidate.audit.at(-1)!;
  const affected=candidate.people.filter(person=>body.kind==='person'?(person.id===event.targetId||person.hasDirectReports!==state.people.find(old=>old.id===person.id)?.hasDirectReports):person.roleIds.includes(event.targetId));
  const receipt=createHash('sha256').update(JSON.stringify({actorId,body,revision:state.revision,roles:state.roles,people:state.people,reporting:state.reporting})).digest('hex');
  const impacts=affected.map(person=>{
    const before=state.people.find(old=>old.id===person.id);
    const oldDecisions=before?effectiveAccessSummary(state,before).decisions:[];
    const after=effectiveAccessSummary(candidate,person);
    return {personId:person.id,displayName:person.displayName,changes:after.decisions.filter(next=>{
      const old=oldDecisions.find(item=>item.action===next.action&&item.resolvedScope.kind===next.resolvedScope.kind);
      return !old||old.allowed!==next.allowed||old.reasonCode!==next.reasonCode||JSON.stringify(old.sources)!==JSON.stringify(next.sources);
    }),unsupportedAssignments:after.unsupportedAssignments};
  });
  return {receipt,revision:state.revision,targetId:body.id??null,kind:body.kind,before:event.before??null,after:event.after,impacts};
}
export async function recheckAccessChange(state:LocalAccessState,actorId:string,input:unknown){
  const preview=await previewAccessChange(state,actorId,input);
  if((input as Record<string,unknown>).previewReceipt!==preview.receipt)throw new AccessError(409,'Preview this exact change against the current configuration before saving.');
  return preview;
}
