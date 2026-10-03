import {AccessError} from '../../shared/errors.js';
export interface LearningTask {id:string;title:string;plannedDate:string;estimatedMinutes:number;actualMinutes?:number;notes?:string;completedAt?:string}
export interface LearningPlan {id:string;revision:number;title:string;goal:string;timezone:string;dailyMinutes:number;targetDate:string;status:'ACTIVE'|'PAUSED'|'ARCHIVED';focus?:string;skillId?:string;skillName?:string;tasks:LearningTask[]}
export type LearningChange={action:'CREATE';id:string;revision:0;title:string;goal:string;timezone:string;dailyMinutes:number;targetDate:string;focus?:string;skillId?:string;tasks:LearningTask[]}|{action:'LOG'|'RESCHEDULE'|'PAUSE'|'RESUME'|'ARCHIVE';id:string;revision:number;taskId?:string;plannedDate?:string;actualMinutes?:number;notes?:string};
export interface LearningStore {read(actor:string):Promise<{plans:LearningPlan[];canManage:boolean}>;change(actor:string,change:LearningChange):Promise<void>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message:string):never{throw new AccessError(400,message);}
function text(value:unknown,max:number,label:string){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail('Check '+label+'.');return value.trim();}
function integer(value:unknown,min:number,max:number){if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)fail('Check duration or revision.');return Number(value);}
export function date(value:unknown){if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(new Date(value+'T12:00:00Z').getTime())||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Choose a valid date.');return value;}
export function timezone(value:unknown){if(typeof value!=='string'||value.length>80)fail('Choose a valid timezone.');try{new Intl.DateTimeFormat('en',{timeZone:value}).format();}catch{fail('Choose a valid timezone.');}return value;}
export function learningChange(input:unknown):LearningChange{
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Check the learning action.');const v=input as Record<string,unknown>;
 if(typeof v.id!=='string'||!uuid.test(v.id))fail('Invalid plan ID.');const revision=integer(v.revision,0,1000000);
 const action=v.action;
 const allowed=action==='CREATE'?['action','id','revision','title','goal','timezone','dailyMinutes','targetDate','tasks','focus','skillId']:action==='LOG'?['action','id','revision','taskId','actualMinutes','notes']:action==='RESCHEDULE'?['action','id','revision','taskId','plannedDate']:['action','id','revision'];
 if(Object.keys(v).some(key=>!allowed.includes(key)))fail('Only editable learning fields are accepted.');
 if(action==='CREATE'){
  if(revision!==0||!Array.isArray(v.tasks)||v.tasks.length<1||v.tasks.length>60)fail('Create a plan with 1–60 tasks.');
  if(v.focus!==undefined&&!['General','Backend','Frontend','Cloud','System Design','Data & AI','Professional'].includes(String(v.focus)))fail('Choose a learning focus.');if(v.skillId!==undefined&&(typeof v.skillId!=='string'||!uuid.test(v.skillId)))fail('Choose a published skill.');
  const ids=new Set<string>();const targetDate=date(v.targetDate);
  const tasks=v.tasks.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))fail('Check each task.');const t=item as Record<string,unknown>;if(Object.keys(t).some(key=>!['id','title','plannedDate','estimatedMinutes'].includes(key))||typeof t.id!=='string'||!uuid.test(t.id)||ids.has(t.id))fail('Check task IDs and editable fields.');ids.add(t.id);const plannedDate=date(t.plannedDate);if(plannedDate>targetDate)fail('Tasks must fit before the target date.');return {id:t.id,title:text(t.title,160,'task title'),plannedDate,estimatedMinutes:integer(t.estimatedMinutes,1,480)};});
  const dailyMinutes=integer(v.dailyMinutes,5,480);
  for(const day of new Set(tasks.map(t=>t.plannedDate)))if(tasks.filter(t=>t.plannedDate===day).reduce((n,t)=>n+t.estimatedMinutes,0)>dailyMinutes)fail('Daily tasks exceed your available time.');
  return {action,id:v.id,revision:0,title:text(v.title,160,'plan title'),goal:text(v.goal,2000,'goal'),timezone:timezone(v.timezone),dailyMinutes,targetDate,tasks,...(v.focus?{focus:String(v.focus)}:{}),...(v.skillId?{skillId:String(v.skillId)}:{})};
 }
 if(!['LOG','RESCHEDULE','PAUSE','RESUME','ARCHIVE'].includes(String(action))||revision<1)fail('Choose a valid learning action.');
 const base={action:action as 'LOG'|'RESCHEDULE'|'PAUSE'|'RESUME'|'ARCHIVE',id:v.id,revision};
 if(action==='LOG'||action==='RESCHEDULE'){if(typeof v.taskId!=='string'||!uuid.test(v.taskId))fail('Choose a task.');if(action==='RESCHEDULE')return {...base,taskId:v.taskId,plannedDate:date(v.plannedDate)};if(v.notes!==undefined&&typeof v.notes!=='string')fail('Check notes.');const notes=typeof v.notes==='string'?v.notes.trim():'';if(notes.length>2000)fail('Notes must be at most 2,000 characters.');return {...base,taskId:v.taskId,actualMinutes:integer(v.actualMinutes,1,480),notes};}
 return base;
}
