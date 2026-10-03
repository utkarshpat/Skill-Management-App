import { AccessError } from '../../shared/errors.js';
import { can, canReviewAssigned, type AccessStore, type LocalAccessState, type LocalPerson } from '../access/index.js';
import type { OrganizationStore } from '../organization/index.js';
import type {LearningStore} from '../learning/index.js';
import type { ClaimsStore, CatalogueStore } from '../skills/index.js';
import { assistantCapabilities } from './capabilities.js';

export interface ToolDefinition { type:'function'; function:{name:string;description:string;parameters:object} }
interface Source { label:string; url:string }
interface ToolContext { state:LocalAccessState; person:LocalPerson; signal:AbortSignal;args:Record<string,unknown> }
interface RegisteredTool {
  definition:ToolDefinition;
  permission:(state:LocalAccessState,person:LocalPerson)=>boolean;
  source:Source;
  validate?:(args:unknown)=>Record<string,unknown>;
  read:(context:ToolContext)=>Promise<object>;
}
const definition=(name:string,description:string):ToolDefinition=>({type:'function',function:{name,description,parameters:{type:'object',properties:{},additionalProperties:false}}});
function searchArguments(value:unknown,allowSkill=false):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccessError(400,'Enter valid search arguments.');
  const args=value as Record<string,unknown>;
  if(Object.keys(args).some(key=>!['search','page',...(allowSkill?['skillId']:[])].includes(key))||(args.search!==undefined&&(typeof args.search!=='string'||args.search.length>100))||(args.page!==undefined&&(!Number.isSafeInteger(args.page)||Number(args.page)<1||Number(args.page)>100)))throw new AccessError(400,'Choose a valid search and page.');
  if(args.skillId!==undefined&&(typeof args.skillId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.skillId)))throw new AccessError(400,'Choose a valid published skill.');
  return {search:typeof args.search==='string'?args.search.trim().replace(/\s+/g,' '):'',page:args.page??1,...(args.skillId!==undefined?{skillId:String(args.skillId).toLowerCase()}:{})};
}
const searchSchema={type:'object',additionalProperties:false,properties:{search:{type:'string',maxLength:100},page:{type:'integer',minimum:1,maximum:100}}};

// Provider-independent tool registry and policy gateway. No tool can choose an actor,
// workspace, SQL query, URL or write action; the authenticated application supplies these.
export class ToolRegistry {
  private entries=new Map<string,RegisteredTool>();
  constructor(private access:AccessStore, organization?:OrganizationStore, claims?:ClaimsStore,catalogue?:CatalogueStore,learning?:LearningStore) {
    this.entries.set('workspace_guide',{
      definition:definition('workspace_guide','Get current permitted pages, action guides and explicitly pending workflows. Role labels never authorize actions.'),
      permission:()=>true,source:{label:'Your permitted workspace actions',url:'/workspace'},
      read:async({state,person})=>assistantCapabilities(state,person),
    });
    this.entries.set('own_profile',{
      definition:definition('own_profile','Read the signed-in person’s own current profile and role labels.'),
      permission:()=>true,source:{label:'My profile',url:'/'},
      read:async({state,person})=>({displayName:person.displayName,employeeCode:person.employeeCode,roles:state.roles.filter(role=>person.roleIds.includes(role.id)).map(role=>role.name),source:'My profile'}),
    });
    if(organization)this.entries.set('workspace_summary',{
      definition:definition('workspace_summary','Read workspace people, role and department counts, if administration is permitted.'),
      permission:(state,person)=>can(state,person,'permissions.manage')&&can(state,person,'users.manage'),source:{label:'Workspace summary',url:'/access?view=overview'},
      read:async({state})=>{const structure=await organization.snapshot();return {people:state.people.length,activePeople:state.people.filter(item=>item.active).length,roles:state.roles.length,departments:structure.nodes.filter(node=>node.active&&node.kind==='DEPARTMENT').length,source:'Workspace summary'};},
    });
    if(learning)this.entries.set('my_learning',{
      definition:definition('my_learning','Read a compact summary of your own learning plans and pending tasks. Cannot select another person, log completion or save a plan.'),
      permission:(state,person)=>can(state,person,'learning.view',true),source:{label:'Your learning plans',url:'/learning'},
      read:async({person})=>{const result=await learning.read(person.id);return {totalPlans:result.plans.length,canManage:result.canManage,plans:result.plans.slice(0,5).map(plan=>({title:plan.title,status:plan.status,timezone:plan.timezone,targetDate:plan.targetDate,dailyMinutes:plan.dailyMinutes,completed:plan.tasks.filter(task=>task.completedAt).length,totalTasks:plan.tasks.length,pendingTasks:plan.tasks.filter(task=>!task.completedAt).slice(0,5).map(task=>({title:task.title,plannedDate:task.plannedDate,estimatedMinutes:task.estimatedMinutes}))})),hasMore:result.plans.length>5,source:'Your learning plans'};},
    });
    if(claims)this.entries.set('my_skills',{
      definition:definition('my_skills','Read the signed-in person’s first page of self-assessed skill drafts. Drafts are unverified; no other person can be selected.'),
      permission:(state,person)=>can(state,person,'skill.view',true),source:{label:'My skills · Self-assessed drafts',url:'/my-skills'},
      read:async({person})=>{const own=await claims.read(person.id,1);return {total:own.total,page:own.page,pageSize:own.pageSize,hasMore:own.total>own.pageSize,skills:own.claims.map(claim=>({skill:claim.skillName,proficiency:claim.levelName,status:claim.status,verification:claim.status==='APPROVED'?'MANAGER_REVIEWED':'UNVERIFIED'})),source:'My skills · Self-assessed drafts'};},
    });
    if(claims?.reviews)this.entries.set('assigned_skill_reviews',{
      definition:definition('assigned_skill_reviews','Read a compact summary of your pending assigned skill reviews, limited to your current direct reports. Cannot choose another reviewer or approve anything.'),
      permission:(state,person)=>canReviewAssigned(state,person),source:{label:'Assigned skill reviews',url:'/skill-reviews'},
      read:async({person})=>{const queue=await claims.reviews!(person.id,1);return {total:queue.total,page:queue.page,hasMore:queue.total>queue.pageSize,claims:queue.claims.slice(0,10).map(claim=>({skill:claim.skillName,person:claim.personName,proficiency:claim.levelName,status:claim.status})),source:'Assigned skill reviews'};},
    });
    if(catalogue)this.entries.set('catalogue_search',{
      definition:{type:'function',function:{name:'catalogue_search',description:'Search published skills by name/category, 25 compact results per page. No drafts/archived skills or arbitrary people. Use full proficiency criteria before suggesting a level.',parameters:searchSchema}},
      validate:args=>searchArguments(args),
      permission:(state,person)=>can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage'),source:{label:'Published skill catalogue',url:'/skills'},
      read:async({person,args})=>{const result=await catalogue.read(person.id,{search:String(args.search),page:Number(args.page),status:'PUBLISHED'});return {revision:result.revision,total:result.total,page:result.page,pageSize:result.pageSize,hasMore:result.page*result.pageSize<result.total,skills:result.skills.filter(skill=>skill.status==='PUBLISHED').map(skill=>({id:skill.id,name:skill.name,category:skill.category,proficiencyLevels:skill.levels.length})),source:'Published skill catalogue'};},
    });
    if(claims)this.entries.set('skill_claim_options',{
      definition:{type:'function',function:{name:'skill_claim_options',description:'Search published skills eligible for your own skill draft (5 options/page). Pass an option skillId with the same search/page to read that skill’s full proficiency criteria. Never invent levels or personal experience. This does not save anything.',parameters:{...searchSchema,properties:{...searchSchema.properties,skillId:{type:'string',format:'uuid'}}}}},
      validate:args=>searchArguments(args,true),
      permission:(state,person)=>assistantCapabilities(state,person).canDraftOwnSkill,source:{label:'My skills · Published choices and criteria',url:'/my-skills'},
      read:async({person,args})=>{const result=await claims.options(person.id,String(args.search),Number(args.page));const selected=args.skillId?result.skills.find(skill=>skill.id.toLowerCase()===args.skillId):undefined;if(args.skillId&&!selected)throw new AccessError(404,'Skill is unavailable in these published choices. Search again.');return {total:result.total,page:result.page,pageSize:result.pageSize,hasMore:result.page*result.pageSize<result.total,skills:result.skills.map(skill=>({id:skill.id,name:skill.name,category:skill.category,proficiencyLevels:skill.levels.length})),...(selected?{selectedSkill:{id:selected.id,name:selected.name,category:selected.category,definitionRevision:selected.definitionRevision,levels:selected.levels.map(level=>({rank:level.rank,name:level.name,description:level.description}))}}:{}),source:'My skills · Published choices and criteria'};},
    });
  }
  permits(state:LocalAccessState,person:LocalPerson,name:string):boolean {
    return person.active&&can(state,person,'profile.view',true)&&Boolean(this.entries.get(name)?.permission(state,person));
  }
  available(state:LocalAccessState,person:LocalPerson):ToolDefinition[] {
    return [...this.entries.values()].filter(tool=>this.permits(state,person,tool.definition.function.name)).map(tool=>tool.definition);
  }
  async execute(actorId:string,name:string,args:unknown,signal:AbortSignal):Promise<{data:object;source:Source}> {
    const tool=this.entries.get(name);
    if(!args||typeof args!=='object'||Array.isArray(args)||(!tool?.validate&&Object.keys(args).length))throw new AccessError(400,'Assistant tools cannot choose another person or workspace.');
    const validated=tool?.validate?tool.validate(args):{};
    const check=async()=>{
      signal.throwIfAborted();
      const state=await this.access.snapshot(),person=state.people.find(item=>item.id===actorId);
      if(!tool||!person||!this.permits(state,person,name))throw new AccessError(403,'Current permission does not allow this assistant action.');
      return {state,person,signal,args:validated};
    };
    const context=await check();
    const data=await tool!.read(context);
    await check(); // Revocation during retrieval must prevent context reaching the model.
    return {data,source:tool!.source};
  }
}
