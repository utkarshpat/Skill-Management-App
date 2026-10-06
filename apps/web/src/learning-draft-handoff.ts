import type {LearningPlanDraftInput} from './learning-plan-draft';
// Ephemeral, single-use handoff. Nothing is stored across sign-out or reload.
export class LearningDraftHandoff {
 private pending?:{actorId:string;ticket:string;draft:LearningPlanDraftInput;expires:number};
 offer(actorId:string,draft:LearningPlanDraftInput,now=Date.now()){
  if(!actorId)throw Error('Learning identity is unavailable.');
  const ticket=crypto.randomUUID();this.pending={actorId,ticket,draft:structuredClone(draft),expires:now+300_000};return ticket;
 }
 take(actorId:string,ticket:string,now=Date.now()){
  const pending=this.pending;this.pending=undefined;
  return pending&&pending.actorId===actorId&&pending.ticket===ticket&&now<pending.expires?pending.draft:undefined;
 }
 clear(){this.pending=undefined;}
}
export const learningDraftHandoff=new LearningDraftHandoff();
