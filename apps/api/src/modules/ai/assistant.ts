import { AccessError } from '../../shared/errors.js';
import type { AccessStore } from '../access/index.js';
import type { ClaimsStore, CatalogueStore } from '../skills/index.js';
import { ToolRegistry, type ToolDefinition } from './tool-registry.js';
import type { OrganizationStore } from '../organization/index.js';
import { geminiProvider } from './gemini.js';
import { presentation, presentationTool } from './output.js';
import { assistantCapabilities, capabilityGreeting } from './capabilities.js';
import { ConversationMemory, coreInstructions, taskInstructions, taskSettings } from './context.js';
import { UsageMeter, type TokenUsage } from './usage.js';

export interface Message {role:'system'|'user'|'assistant'|'tool';content:string;tool_call_id?:string;tool_name?:string;tool_calls?:ToolCall[];providerParts?:unknown[]}
interface ToolCall {id:string;type:'function';function:{name:string;arguments:string}}
type Tool = ToolDefinition;
export interface GenerationOptions {maxOutputTokens:number;onUsage?:(usage:TokenUsage)=>void}
export interface Provider {name:string;complete:(messages:Message[],tools:Tool[],signal:AbortSignal,options?:GenerationOptions)=>Promise<{content:string;calls:ToolCall[];providerParts?:unknown[];usage?:TokenUsage}>}
export function conversation(input:unknown):Message[] {
 if(!input||typeof input!=='object')throw new AccessError(400,'Enter a message.');
 const messages=(input as {messages?:unknown}).messages;
 if(!Array.isArray(messages)||messages.length<1||messages.length>12)throw new AccessError(400,'Keep the conversation to 12 messages or start a new chat.');
 let size=0;
 const result=messages.map(item=>{if(!item||!['user','assistant'].includes(item.role)||typeof item.content!=='string'||!item.content.trim()||item.content.length>(item.role==='assistant'?12000:2000))throw new AccessError(400,'User messages must contain up to 2,000 characters; assistant history up to 12,000.');size+=item.content.length;return {role:item.role as 'user'|'assistant',content:item.content.trim()};});
 if(size>12000||result.at(-1)?.role!=='user')throw new AccessError(400,'Start a shorter conversation ending with your question.');
 return result;
}
export class AssistantService {
 private limits=new Map<string,{at:number;count:number}>();private active=new Set<string>();private daily={day:'',count:0};
 private registry:ToolRegistry;
 private memory=new ConversationMemory();
 constructor(private store:AccessStore,organization:OrganizationStore|undefined,private provider:Provider|undefined,claims?:ClaimsStore,private usageObserver?:(usage:ReturnType<UsageMeter['snapshot']>)=>void,catalogue?:CatalogueStore) { this.registry=new ToolRegistry(store,organization,claims,catalogue); }
 status(){return {configured:Boolean(this.provider),provider:this.provider?.name??null,mode:'read-only'};}
 async chat(actorId:string,input:unknown,signal=AbortSignal.timeout(35000)) {
  if(this.active.has(actorId))throw new AccessError(429,'A reply is already being generated.');
  this.active.add(actorId);
  const meter=new UsageMeter();
  try{
   let prepared:ReturnType<ConversationMemory['prepare']>|undefined;
   let request=input;
   if(input&&typeof input==='object'&&!('messages' in input)){
    const state=await this.store.snapshot(),person=state.people.find(item=>item.id===actorId);
    if(!person||!this.registry.permits(state,person,'own_profile'))throw new AccessError(403,'Assistant access is not assigned.');
    const policy=JSON.stringify({capabilities:assistantCapabilities(state,person),tools:this.registry.available(state,person)});
    prepared=this.memory.prepare(actorId,input,policy);request={messages:prepared.history};
   }
   const result=await this.respond(actorId,request,signal,meter);
   if(prepared){
    const fresh=await this.store.snapshot(),person=fresh.people.find(item=>item.id===actorId);
    if(!person||!this.registry.permits(fresh,person,'own_profile')||prepared.previous.policy!==JSON.stringify({capabilities:assistantCapabilities(fresh,person),tools:this.registry.available(fresh,person)}))throw new AccessError(403,'Access changed during this reply. Please ask again with your current permissions.');
    const artifact=result.artifact;
    const remembered=artifact?JSON.stringify({title:artifact.title,kind:artifact.kind,summary:artifact.summary,body:artifact.body,steps:artifact.steps}):result.reply;
    this.memory.commit(prepared,remembered);
   }
   return {...result,...(prepared?{conversationId:prepared.id,context:{compacted:prepared.compacted,memory:'process-local-excerpts'}}:{}),usage:meter.snapshot()};
  }finally{this.active.delete(actorId);try{this.usageObserver?.(meter.snapshot());}catch{/* Telemetry must not change authorization or a completed response. */}}
 }
 private async respond(actorId:string,input:unknown,signal:AbortSignal,meter:UsageMeter) {
  const history=conversation(input);
  if(!this.provider)throw new AccessError(503,'AI model is not connected yet. Configure the server-side provider to enable chat.');
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10);if(this.daily.day!==day)this.daily={day,count:0};
  const limit=this.limits.get(actorId);if(!limit||now-limit.at>=60000)this.limits.set(actorId,{at:now,count:0});
  if(this.limits.get(actorId)!.count>=10||this.daily.count>=500)throw new AccessError(429,'AI request limit reached. Please try again later.');
  const initial=await this.store.snapshot(),person=initial.people.find(item=>item.id===actorId);
  if(!person||!this.registry.permits(initial,person,'own_profile'))throw new AccessError(403,'Assistant access is not assigned.');
  this.limits.get(actorId)!.count++;this.daily.count++;
  const latestText=history.at(-1)!.content;
  const followup=/^(make it|change it|same|that|it |shorter|longer|isko|usko|aur\s+\d)/i.test(latestText);
  const preceding=history.filter(message=>message.role==='user').at(-2)?.content??'';
  const settings=taskSettings(followup?preceding+'\n'+latestText:latestText);
  const messages:Message[]=[{role:'system',content:coreInstructions+' '+taskInstructions(settings.kind)},...history];const sources:{label:string;url:string}[]=[];let executions=0;
  const recheck=async(name:string)=>{const state=await this.store.snapshot();const current=state.people.find(item=>item.id===actorId);if(!current||!this.registry.permits(state,current,name))throw new AccessError(403,'Current permission does not allow this assistant action.');return {state,person:current};};
   for(let round=0;round<3;round++) {
    const current=await recheck('own_profile');signal.throwIfAborted();
    const fullContext=assistantCapabilities(current.state,current.person);
    const requested=history.at(-1)!.content.toLowerCase();
    const context={...fullContext,guidance:fullContext.guidance.filter(guide=>guide.action.toLowerCase().split(/\s+/).some(word=>word.length>3&&requested.includes(word))).slice(0,2)};
    messages[0].content=messages[0].content.split('\nEffective capability context:')[0]+'\nEffective capability context: '+JSON.stringify(context);
    if(round===0&&/^(hello|hi|hey|hii)[!.\s]*$/i.test(history.at(-1)!.content)){await recheck('own_profile');return {reply:capabilityGreeting(context),sources,mode:'read-only'};}
    const available=[...this.registry.available(current.state,current.person),...(settings.kind==='answer'?[]:[presentationTool])];
    if(Buffer.byteLength(JSON.stringify({messages,available}),'utf8')>32000)throw new AccessError(422,'This task needs too much context. Start a new conversation or ask a smaller question.');
    const recordUsage=meter.begin();
    const answer=await this.provider.complete(messages,available,signal,{maxOutputTokens:settings.maxOutputTokens,onUsage:recordUsage});
    if(answer.usage)recordUsage(answer.usage);
    await recheck('own_profile');signal.throwIfAborted();
    if(!answer.calls.length){if(!answer.content.trim()||answer.content.length>12000)throw new AccessError(502,'AI returned an invalid answer.');return {reply:answer.content,sources,mode:'read-only'};}
    if(answer.calls.length>4||executions+answer.calls.length>4)throw new AccessError(422,'The request needs too many assistant actions. Please ask a smaller question.');
    const output=answer.calls.find(call=>call.function.name==='present_output');
    if(output){
      if(!available.some(tool=>tool.function.name==='present_output'))throw new AccessError(403,'This response type was not requested.');
      if(answer.calls.length!==1)throw new AccessError(422,'Read current facts before generating the final card. Please try again.');
      let payload:unknown;try{payload=JSON.parse(output.function.arguments);}catch{throw new AccessError(502,'AI returned an invalid card. Please try again.');}
      const artifact=presentation(payload);const outputContext=await recheck('own_profile');
      if(artifact.kind==='skill_draft'&&!assistantCapabilities(outputContext.state,outputContext.person).canDraftOwnSkill)throw new AccessError(403,'Current permissions do not allow a personal skill draft.');
      return {reply:artifact.summary,sources,mode:'read-only',artifact};
    }
    messages.push({role:'assistant',content:answer.content,tool_calls:answer.calls,providerParts:answer.providerParts});
    for(const call of answer.calls) {
     executions++;if(!available.some(tool=>tool.function.name===call.function.name))throw new AccessError(403,'Assistant tool is not permitted.');
     let args:unknown;try{args=JSON.parse(call.function.arguments);}catch{throw new AccessError(400,'Invalid assistant tool arguments.');}
     const {data,source}=await this.registry.execute(actorId,call.function.name,args,signal);
     if(!sources.some(item=>item.label===source.label&&item.url===source.url))sources.push(source);
     messages.push({role:'tool',content:JSON.stringify(data),tool_call_id:call.id,tool_name:call.function.name});
    }
   }
   throw new AccessError(422,'Please ask a more focused question.');
 }
}

export function configuredProvider(env:NodeJS.ProcessEnv,transport:typeof fetch=fetch):Provider|undefined {
 const name=env.AI_PROVIDER || (env.GEMINI_API||env.GEMINI_API_KEY?'gemini':undefined),model=env.AI_MODEL || (name==='gemini'?'gemini-3.8-flash':undefined);if(!name||!model)return undefined;
 if(name==='gemini'){const key=env.GEMINI_API||env.GEMINI_API_KEY||env.AI_API_KEY;return key?geminiProvider(key,model,transport):undefined;}
 if(!['ollama','azure','openai'].includes(name))throw new Error('Unknown AI provider.');
 let endpoint:string,headers:Record<string,string>={'Content-Type':'application/json'};
 if(name==='ollama') {const url=new URL(env.AI_ENDPOINT??'http://127.0.0.1:11434');if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||!['http:','https:'].includes(url.protocol))throw new Error('Ollama must use a local endpoint.');endpoint=new URL('/api/chat',url).toString();}
 else {
  if(!env.AI_API_KEY)return undefined;
  const url=new URL(name==='openai'?'https://api.openai.com/v1/':env.AI_ENDPOINT??'');
  if(url.protocol!=='https:'||url.username||url.password||(name==='azure'&&!/^[a-z0-9-]+\.(openai|services\.ai)\.azure\.com$/.test(url.hostname)))throw new Error('Use the approved HTTPS model endpoint.');
  endpoint=new URL(name==='openai'?'/v1/chat/completions':'/openai/v1/chat/completions',url).toString();headers={...headers,...(name==='azure'?{'api-key':env.AI_API_KEY}:{Authorization:`Bearer ${env.AI_API_KEY}`})};
 }
 return {name,async complete(messages,available,signal){
  try {
   const body=name==='ollama'?{model,stream:false,options:{num_predict:800},messages:messages.map(message=>({...message,tool_calls:message.tool_calls?.map(call=>({function:{name:call.function.name,arguments:JSON.parse(call.function.arguments)}}))})),tools:available}:{model,max_completion_tokens:800,store:false,messages:messages.map(({tool_name,...message})=>message),tools:available};
   const response=await transport(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal,redirect:'error'});
   if(!response.ok)throw new Error('Provider failure');const data=await response.json();const message=name==='ollama'?data.message:data.choices?.[0]?.message;
   if(!message||(!message.content&&!message.tool_calls?.length))throw new Error('Missing provider answer');
   const calls:ToolCall[]=(message.tool_calls??[]).map((call:{id?:string;function:{name:string;arguments:string|object}},index:number)=>{if(typeof call.function?.name!=='string')throw new Error('Invalid tool call');return {id:call.id??`tool-${index}`,type:'function',function:{name:call.function.name,arguments:typeof call.function.arguments==='string'?call.function.arguments:JSON.stringify(call.function.arguments)}};});
   return {content:typeof message.content==='string'?message.content:'',calls};
  }catch(error){if(signal.aborted)throw new AccessError(504,'AI took too long. Please try again.');throw new AccessError(502,'AI provider is unavailable. Check its connection and try again.');}
 }};
}
