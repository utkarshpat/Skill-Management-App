import { AccessError } from '../../shared/errors.js';

export interface SkillClaim {
  id: string; revision: number; skillId: string; skillName: string; category: string;
  definitionRevision: number; rank: number; levelName: string; levelDescription: string;
  experienceMonths: number; lastUsedOn?: string|null; description: string; status: 'DRAFT'|'SUBMITTED'|'CHANGES_REQUESTED'|'APPROVED'|'REJECTED'; updatedAt: string;
  projects?: string; evidence?: string; feedback?: string; reviewerId?: string; personId?:string; personName?: string;
}
export interface ClaimOption {
  description?:string; businessCode?:string|null;
  id: string; name: string; category: string; definitionRevision: number;
  levels: { rank: number; name: string; description: string }[];
}
export interface ClaimState { claims: SkillClaim[]; total: number; page: number; pageSize: number; canClaim: boolean; categories?:string[]; summary?:{pending:number;approved:number;changes:number;rejected:number} }
export interface ClaimOptions { skills: ClaimOption[]; total: number; page: number; pageSize: number }
export interface TopReviewedSkill {id:string;skillName:string;category:string;rank:number;levelName:string;maxRank:number|null}
export interface OwnSkillSummary {total:number;verified:number;pending:number;draft:number;changesRequested:number;rejected:number;topSkills?:TopReviewedSkill[]}
export interface ClaimsStore {
  team?(actorId:string,query:ReturnType<typeof teamQuery>):Promise<TeamCapability>;
  summary?(actorId:string):Promise<OwnSkillSummary>;
  journey?(actorId:string):Promise<ClaimState>;
  read(actorId: string, page: number): Promise<ClaimState>;
  options(actorId: string, search: string, page: number, category?:string,pageSize?:number): Promise<ClaimOptions>;
  save(actorId: string, input: unknown): Promise<void>;
  transition?(actorId: string, input: ReturnType<typeof claimTransition>): Promise<void>;
  reviews?(actorId: string, page: number,query?:ReturnType<typeof reviewQuery>): Promise<ClaimState>;
  reviewDetail?(actorId:string,id:string,page:number):Promise<ReviewDetail>;
  notifications?(actorId: string): Promise<{id:string;at:string;title:string;body:string;href:string}[]>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ReviewDetail {claim:SkillClaim;history:{revision:number;action:string;at:string;actorName:string;feedback:string}[];total:number;page:number;pageSize:number}
export function reviewIdentifier(value:unknown){if(typeof value!=='string'||!uuid.test(value))throw new AccessError(400,'Choose a valid claim.');return value.toLowerCase();}
export function reviewQuery(input:Record<string,unknown>){
 if(Object.keys(input).some(key=>!['search','page','category','status','person'].includes(key)))throw new AccessError(400,'Unsupported review selector.');
 const status=input.status??'SUBMITTED';if(typeof status!=='string'||!['SUBMITTED','APPROVED','CHANGES_REQUESTED','REJECTED','ALL'].includes(status))throw new AccessError(400,'Choose a valid review status.');
 return {search:claimSearch(input.search),category:claimCategory(input.category),status,person:input.person===undefined?undefined:reviewIdentifier(input.person)};
}
export interface TeamCapability {total:number;page:number;pageSize:number;scope:'DIRECT_REPORTS';people:{id:string;name:string;employeeCode:string;reviewed:number;pending:number}[];skills:{personId:string;skillName:string;category:string;rank:number;levelName:string;status:'APPROVED'|'SUBMITTED'}[];analytics?:{members:number;reviewed:number;pending:number;coverage:{skillName:string;rank:number;people:number;memberIds:string[]}[];levels:{rank:number;count:number;memberIds:string[]}[];categories:{category:string;count:number}[]}}
export function teamQuery(input:Record<string,unknown>){
 if(Object.keys(input).some(key=>!['search','page','person'].includes(key)))throw new AccessError(400,'Unsupported team selector.');
 const person=input.person;if(person!==undefined&&(typeof person!=='string'||!uuid.test(person)))throw new AccessError(400,'Choose a valid team member.');
 return {search:claimSearch(input.search),page:claimPage(input.page),person:typeof person==='string'?person.toLowerCase():undefined};
}
export function claimPage(value: unknown): number {
  if(value!==undefined&&typeof value!=='string'&&typeof value!=='number')throw new AccessError(400,'Choose a valid page.');
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AccessError(400, 'Choose a valid page.');
  return page;
}
export function claimResultSize(value:unknown):number {const size=value===undefined?25:Number(value);if((value!==undefined&&typeof value!=='string'&&typeof value!=='number')||!Number.isInteger(size)||size<1||size>25)throw new AccessError(400,'Choose a valid result size.');return size;}
export function claimCategory(value:unknown):string {if(value===undefined)return '';if(typeof value!=='string'||value.length>80)throw new AccessError(400,'Choose a valid category.');return value.trim();}
export function claimSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 100) throw new AccessError(400, 'Search using up to 100 characters.');
  return value.trim();
}
export function claimChange(input: unknown, at=new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AccessError(400, 'Invalid skill draft.');
  const body = input as Record<string, unknown>;
  const fields = new Set(['id','revision','skillId','definitionRevision','rank','experienceMonths','lastUsedOn','description','projects','evidence']);
  if (Object.keys(body).some(key => !fields.has(key))) throw new AccessError(400, 'Only editable skill draft fields are accepted.');
  if (typeof body.id !== 'string' || !uuid.test(body.id) || typeof body.skillId !== 'string' || !uuid.test(body.skillId)) throw new AccessError(400, 'Choose a valid skill draft.');
  for (const [key, min, max] of [['revision',0,2147483646],['definitionRevision',1,2147483646],['rank',1,8],['experienceMonths',0,600]] as const) {
    if (!Number.isSafeInteger(body[key]) || Number(body[key]) < min || Number(body[key]) > max) throw new AccessError(400, 'Check proficiency, experience and draft version.');
  }
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.trim().length > 2000) throw new AccessError(400, 'Describe your experience using up to 2,000 characters.');
  const projects=claimText(body.projects,2000), evidence=claimText(body.evidence,2000);
  let lastUsedOn:string|null|undefined;
  if(Object.hasOwn(body,'lastUsedOn')){
    if(body.lastUsedOn===null)lastUsedOn=null;
    else {
      const value=body.lastUsedOn;
      if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')throw new AccessError(400,'Choose a valid last-used date or leave it blank.');
      const parsed=new Date(value+'T00:00:00Z');
      if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value||!Number.isFinite(at.getTime())||value>at.toISOString().slice(0,10))throw new AccessError(400,'Last used must be a real date on or before today (UTC).');
      lastUsedOn=value;
    }
  }
  return { id: body.id.toLowerCase(), revision: Number(body.revision), skillId: body.skillId.toLowerCase(), definitionRevision: Number(body.definitionRevision), rank: Number(body.rank), experienceMonths: Number(body.experienceMonths), description: body.description.trim(),projects,evidence,...(lastUsedOn!==undefined?{lastUsedOn}:{}) };
}
function claimText(value:unknown,max:number) {if(value===undefined)return '';if(typeof value!=='string'||value.length>max)throw new AccessError(400,`Use up to ${max} characters.`);return value.trim();}
export function claimTransition(input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new AccessError(400,'Invalid review action.');
  const body=input as Record<string,unknown>;
  if(Object.keys(body).some(key=>!['id','revision','action','feedback'].includes(key))||typeof body.id!=='string'||!uuid.test(body.id)||!Number.isSafeInteger(body.revision)||Number(body.revision)<1||Number(body.revision)>2147483646||!['SUBMIT','APPROVE','REQUEST_CHANGES','REJECT'].includes(String(body.action)))throw new AccessError(400,'Check the claim and current version.');
  const feedback=claimText(body.feedback,2000);
  if(body.action!=='SUBMIT'&&!feedback)throw new AccessError(400,'Provide feedback for this review.');
  return {id:body.id.toLowerCase(),revision:Number(body.revision),action:body.action as 'SUBMIT'|'APPROVE'|'REQUEST_CHANGES'|'REJECT',feedback};
}
