import { AccessError } from '../../shared/errors.js';
import { can, type AccessStore, type LocalAccessState, type LocalPerson } from '../access/index.js';
import type { OrganizationStore } from '../organization/index.js';
import type { ClaimsStore } from '../skills/index.js';

export interface ToolDefinition { type:'function'; function:{name:string;description:string;parameters:object} }
interface Source { label:string; url:string }
interface ToolContext { state:LocalAccessState; person:LocalPerson; signal:AbortSignal }
interface RegisteredTool {
  definition:ToolDefinition;
  permission:(state:LocalAccessState,person:LocalPerson)=>boolean;
  source:Source;
  read:(context:ToolContext)=>Promise<object>;
}
const definition=(name:string,description:string):ToolDefinition=>({type:'function',function:{name,description,parameters:{type:'object',properties:{},additionalProperties:false}}});

// Provider-independent tool registry and policy gateway. No tool can choose an actor,
// workspace, SQL query, URL or write action; the authenticated application supplies these.
export class ToolRegistry {
  private entries=new Map<string,RegisteredTool>();
  constructor(private access:AccessStore, organization?:OrganizationStore, claims?:ClaimsStore) {
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
    if(claims)this.entries.set('my_skills',{
      definition:definition('my_skills','Read the signed-in person’s first page of self-assessed skill drafts. Drafts are unverified; no other person can be selected.'),
      permission:()=>true,source:{label:'My skills · Self-assessed drafts',url:'/my-skills'},
      read:async({person})=>{const own=await claims.read(person.id,1);return {total:own.total,page:own.page,pageSize:own.pageSize,hasMore:own.total>own.pageSize,skills:own.claims.map(claim=>({skill:claim.skillName,proficiency:claim.levelName,status:'DRAFT',verification:'UNVERIFIED'})),source:'My skills · Self-assessed drafts'};},
    });
  }
  permits(state:LocalAccessState,person:LocalPerson,name:string):boolean {
    return person.active&&can(state,person,'profile.view',true)&&Boolean(this.entries.get(name)?.permission(state,person));
  }
  available(state:LocalAccessState,person:LocalPerson):ToolDefinition[] {
    return [...this.entries.values()].filter(tool=>this.permits(state,person,tool.definition.function.name)).map(tool=>tool.definition);
  }
  async execute(actorId:string,name:string,args:unknown,signal:AbortSignal):Promise<{data:object;source:Source}> {
    if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw new AccessError(400,'Assistant tools cannot choose another person or workspace.');
    const tool=this.entries.get(name);
    const check=async()=>{
      signal.throwIfAborted();
      const state=await this.access.snapshot(),person=state.people.find(item=>item.id===actorId);
      if(!tool||!person||!this.permits(state,person,name))throw new AccessError(403,'Current permission does not allow this assistant action.');
      return {state,person,signal};
    };
    const context=await check();
    const data=await tool!.read(context);
    await check(); // Revocation during retrieval must prevent context reaching the model.
    return {data,source:tool!.source};
  }
}
