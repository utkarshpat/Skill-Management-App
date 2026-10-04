import {can,canReviewAssigned,type LocalAccessState,type LocalPerson} from '../access/index.js';
import type {ClaimsStore} from '../skills/index.js';
import type {LearningStore,LearningPlan} from '../learning/index.js';
import type {WorkflowStore} from '../workflows/index.js';
import {AccessError} from '../../shared/errors.js';

export interface DashboardSources {claims?:ClaimsStore;learning?:LearningStore;workflows?:WorkflowStore;aiConfigured?:boolean}
export type CardId='attention'|'learning'|'capability'|'requests';
export interface DashboardItem {id:string;title:string;description:string;href:string;label:string;priority:number;urgency?:string;groupId?:string}
interface AttentionGroup {id:string;title:string;description:string;href:string;label:string;tone:'blue'|'amber'|'red'|'teal';count:number|null}
export function dashboardPolicy(state:LocalAccessState,person:LocalPerson){return JSON.stringify([person.active,canReviewAssigned(state,person),...['profile.view','skill.view','skill.claim','learning.view','learning.manage','request.view','request.create','request.assign','request.resolve','incident.view','incident.create','incident.assign','incident.resolve'].map(code=>can(state,person,code,true)),can(state,person,'skill.view'),can(state,person,'permissions.manage')]);}
const registry=[
 {id:'attention' as const,title:'Needs your attention',description:'Work you can move forward',priority:100,size:'wide'},
 {id:'learning' as const,title:'Today’s learning',description:'Your next step towards your goal',priority:90,size:'medium'},
 {id:'capability' as const,title:'My capability',description:'Reviewed skills and claims, kept distinct',priority:80,size:'medium'},
 {id:'requests' as const,title:'My requests',description:'Track what you have raised',priority:70,size:'wide'},
];
export function dashboardManifest(state:LocalAccessState,person:LocalPerson,sources:DashboardSources){
 const own=(code:string)=>can(state,person,code,true);
 const skill=own('profile.view')&&own('skill.view')&&Boolean(sources.claims?.summary);
 const learning=own('learning.view')&&Boolean(sources.learning);
 const requests=(own('request.view')||own('incident.view'))&&Boolean(sources.workflows);
 const reviews=own('profile.view')&&canReviewAssigned(state,person)&&Boolean(sources.claims?.reviews);
 const assigned=requests&&['request','incident'].some(kind=>own(kind+'.view')&&(own(kind+'.assign')||own(kind+'.resolve')));
 const allowed={attention:reviews||assigned||(learning&&own('learning.manage')),learning,capability:skill,requests};
 const actions=[
  ...(skill&&own('skill.claim')&&can(state,person,'skill.view')?[{id:'skill',label:'Add skill',href:'/my-skills?action=add'}]:[]),
  ...(learning&&own('learning.manage')?[{id:'learning',label:'Create learning plan',href:'/learning?action=create'}]:[]),
  ...(requests&&['request','incident'].some(kind=>own(kind+'.view')&&own(kind+'.create'))?[{id:'request',label:'Raise request',href:'/requests?action=create'}]:[]),
  ...(own('permissions.manage')?[{id:'administration',label:'Open administration',href:'/access?view=overview'}]:[]),
 ];
 const ai=own('profile.view')&&Boolean(sources.aiConfigured);
 const details:Record<string,{description:string;assistance?:{label:string;prompt?:string;href?:string}}>={
  skill:{description:'Choose a published skill and describe your experience.',assistance:{label:'Draft with AI',prompt:'Help me prepare my own skill claim. Read my_skills and ask which published skill and practical experience I want to describe. Prepare a skill_draft for explicit review. Do not save or submit it.'}},
  learning:{description:'Turn a goal into a daily learning plan.',assistance:{label:'Plan with AI',href:'/learning?action=planner'}},
  request:{description:'Choose a recipient and ask for help or report an issue.',assistance:{label:'Prepare with AI',prompt:own('request.view')&&own('request.create')?'Help me prepare a request_draft for review. Ask what help I need and who should receive it. Do not submit or assign anything.':'Help me prepare an incident_draft for review. Ask about the issue, its impact and who should receive it. Do not submit or assign anything.'}},
  administration:{description:'Open your permitted administration workspace.',assistance:{label:'Guide me',prompt:'Explain my current authorized administration actions. Ask which task I want to do and guide me through its review steps. Do not change access or records.'}},
 };
 return {revision:state.revision,actorId:person.id,cards:registry.filter(card=>allowed[card.id]).map(card=>({...card,endpoint:'/api/dashboard/'+card.id,scope:card.id==='attention'?{kind:'ASSIGNED_OR_OWN',actorId:person.id}:{kind:'OWN',actorId:person.id}})),actions:actions.map(a=>({...a,description:details[a.id].description,...(ai?{assistance:details[a.id].assistance}:{})})),ai};
}
function learningSummary(plans:LearningPlan[],at:Date){
 const active=plans.filter(p=>p.status==='ACTIVE');
 const all=active.flatMap(plan=>{const today=new Intl.DateTimeFormat('en-CA',{timeZone:plan.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);return plan.tasks.map(task=>({plan,task,today}));});
 const urgency=(x:typeof all[number])=>x.task.plannedDate<x.today?100:x.task.plannedDate===x.today?80:40;
 const pending=all.filter(x=>!x.task.completedAt).sort((a,b)=>urgency(b)-urgency(a)||a.task.plannedDate.localeCompare(b.task.plannedDate)||a.plan.id.localeCompare(b.plan.id)||a.task.id.localeCompare(b.task.id));
 const items=pending.map(({plan,task,today})=>({id:task.id,title:task.title,description:plan.title+' · '+task.plannedDate+' · '+task.estimatedMinutes+' min',href:'/learning?plan='+plan.id+'&task='+task.id,label:'Open task',priority:task.plannedDate<today?100:task.plannedDate===today?80:40}));
 const completed=all.filter(x=>x.task.completedAt).length;
 const next=pending[0],nextTask=next?{id:next.task.id,planId:next.plan.id,title:next.task.title,planTitle:next.plan.title,skillName:next.plan.skillName,plannedDate:next.task.plannedDate,timezone:next.plan.timezone,estimatedMinutes:next.task.estimatedMinutes,due:next.task.plannedDate<next.today?'OVERDUE' as const:next.task.plannedDate===next.today?'TODAY' as const:'UPCOMING' as const,daysOverdue:Math.max(0,Math.round((Date.parse(next.today)-Date.parse(next.task.plannedDate))/86400000)),planCompleted:next.plan.tasks.filter(t=>t.completedAt).length,planTotal:next.plan.tasks.length,href:'/learning?plan='+next.plan.id+'&task='+next.task.id}:null;
 return {activePlans:active.length,completed,total:all.length,progress:all.length?Math.round(completed/all.length*100):0,loggedMinutes:all.reduce((sum,x)=>sum+(x.task.completedAt?x.task.actualMinutes??0:0),0),overdue:pending.filter(x=>x.task.plannedDate<x.today).length,today:pending.filter(x=>x.task.plannedDate===x.today).length,nextTask,items:items.slice(0,3),overdueItems:items.filter(x=>x.priority===100).slice(0,3)};
}
export async function loadDashboardCard(id:CardId,actor:string,state:LocalAccessState,person:LocalPerson,sources:DashboardSources,at=new Date(),requestStatus=''){
 if(!dashboardManifest(state,person,sources).cards.some(c=>c.id===id))throw new AccessError(403,'This dashboard card is no longer available.');
 if(id==='learning'){const data=await sources.learning!.read(actor);return {...learningSummary(data.plans,at),canManage:data.canManage};}
 if(id==='capability'){
  const [summary,recent]=await Promise.all([sources.claims!.summary!(actor),sources.claims!.read(actor,1)]);
  return {...summary,canClaim:recent.canClaim&&can(state,person,'skill.claim',true)&&can(state,person,'skill.view'),recentClaims:recent.claims.slice(0,3).map(c=>({id:c.id,skillName:c.skillName,category:c.category,rank:c.rank,levelName:c.levelName,status:c.status,updatedAt:c.updatedAt,href:'/my-skills?claim='+c.id}))};
 }
 if(id==='requests'){
  const data=await sources.workflows!.list(actor,1,false,{query:'',kind:'',status:requestStatus,category:'',priority:''});
  if(!data.summary)throw new AccessError(503,'Request summary is unavailable.');
  return {submitted:data.summary.submitted,inProgress:data.summary.inProgress??0,resolved:data.summary.resolved??0,cancelled:data.summary.cancelled,total:data.summary.total,previewTotal:data.total,canCreate:['request','incident'].some(kind=>can(state,person,kind+'.view',true)&&can(state,person,kind+'.create',true)),recentRecords:data.items.slice(0,3).map(r=>({id:r.id,reference:r.reference??r.kind,kind:r.kind,title:r.title,status:r.status,priority:r.priority,recipientName:r.recipientName,updatedAt:r.updatedAt})),items:data.items.slice(0,3).map(r=>({id:r.id,title:r.title,description:(r.reference??r.kind)+' · '+r.status.replaceAll('_',' ').toLowerCase()+' · '+r.recipientName,href:'/requests?record='+r.id,label:'View',priority:0}))};
 }
 const jobs:{id:string;load:()=>Promise<{count:number;items:DashboardItem[]}>}[]=[];
 if(can(state,person,'profile.view',true)&&canReviewAssigned(state,person)&&sources.claims?.reviews)jobs.push({id:'reviews',load:async()=>{const data=await sources.claims!.reviews!(actor,1);return {count:data.total,items:data.claims.slice(0,3).map(c=>({id:c.id,title:c.skillName,description:(c.personName??'Assigned claim')+' · '+c.levelName,href:'/skill-reviews?claim='+c.id,label:'Review',priority:90}))};}});
 if(can(state,person,'learning.view',true)&&can(state,person,'learning.manage',true)&&sources.learning)jobs.push({id:'learning',load:async()=>{const data=learningSummary((await sources.learning!.read(actor)).plans,at);return {count:data.overdue,items:data.overdueItems};}});
 for(const kind of ['REQUEST','INCIDENT'] as const){const code=kind.toLowerCase();if(!sources.workflows||!can(state,person,code+'.view',true))continue;
  for(const status of ['SUBMITTED','IN_PROGRESS'] as const){if(!can(state,person,code+(status==='SUBMITTED'?'.assign':'.resolve'),true))continue;
   jobs.push({id:code+'-'+status,load:async()=>{const data=await sources.workflows!.list(actor,1,true,{query:'',kind,status,category:'',priority:''});return {count:data.total,items:data.items.slice(0,3).map(r=>({id:r.id,title:r.title,description:(r.reference??kind)+' · '+r.requesterName+' · '+(status==='SUBMITTED'?'Ready to start':'In progress'),href:'/requests?record='+r.id,label:'Open',priority:r.priority==='HIGH'?110:status==='SUBMITTED'?75:85}))};}});
  }
 }
 const results=await Promise.allSettled(jobs.map(job=>job.load()));
 const failed:string[]=[],items:DashboardItem[]=[],groups:AttentionGroup[]=[];let total=0;
 results.forEach((r,i)=>{const key=jobs[i].id,isLearning=key==='learning',isReview=key==='reviews',incident=key.startsWith('incident'),started=key.endsWith('IN_PROGRESS');
  const group:AttentionGroup={id:key,count:r.status==='fulfilled'?r.value.count:null,title:isReview?'Skill reviews':isLearning?'Overdue learning':(incident?'Incidents':'Requests')+(started?' in progress':' to start'),description:isReview?'Claims waiting for your review':isLearning?'Unfinished tasks from active plans':'Assigned to you · '+(started?'Work already started':'Ready for triage'),href:isReview?'/skill-reviews':isLearning?'/learning?tab=backlog':'/requests?inbox=true&kind='+(incident?'INCIDENT':'REQUEST')+'&status='+(started?'IN_PROGRESS':'SUBMITTED'),label:isReview?'Review claims':isLearning?'Open backlog':started?'Continue work':'Start work',tone:isReview?'blue':isLearning?'amber':incident?'red':'teal'};
  groups.push(group);
  if(r.status==='fulfilled'){total+=r.value.count;items.push(...r.value.items.map(item=>({...item,groupId:key,urgency:isLearning?'Overdue':isReview?'Awaiting review':item.priority===110?'High priority':started?'In progress':'Needs triage'})));}else if(r.reason instanceof AccessError&&r.reason.status===403)throw r.reason;else failed.push(key);
 });
 return {total,partial:failed.length>0,failedSources:failed,groups,items:items.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)).slice(0,6)};
}
