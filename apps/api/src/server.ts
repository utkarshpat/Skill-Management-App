import {SqlAiBudget} from './modules/ai/budget.js';
import {KnowledgeTransferService} from './modules/knowledge-transfer/index.js';
import {SqlRecommendationStore} from './modules/recommendations/index.js';
import { SqlOrganizationStore } from './modules/organization/sql-store.js';
import { createApp } from './create-app.js';
import {SqlWorkflowStore} from './modules/workflows/index.js';
import { identityConfig, tokenVerifier } from './modules/identity/index.js';
import { ownProfile } from './modules/identity/index.js';
import { closeRuntimeDatabase } from './shared/database.js';
import { developmentLoginEnabled, hostedDemoConfig } from './modules/identity/index.js';
import { SqlAccessStore } from './modules/access/sql-access-store.js';
import {can} from './modules/access/index.js';
import {AssistantService,configuredProvider} from './modules/ai/index.js';
import { SqlCatalogueStore } from './modules/skills/sql-store.js';
import { SqlClaimsStore } from './modules/skills/sql-claims-store.js';
import { SqlConversationsStore } from './modules/ai/conversations.js';
import {SqlLearningStore,SqlPracticeStore,LearningPracticeService,LearningPlannerService,LearningRecoveryService,SqlRecoveryStore,type QuizGenerator} from './modules/learning/index.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const config = identityConfig(process.env);
const access=process.env.ACCESS_ACCOUNT_ID?new SqlAccessStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const hostedDemo = hostedDemoConfig(process.env);
const developmentStore = hostedDemo || developmentLoginEnabled(process.env) ? access : undefined;
const organization=process.env.ACCESS_ACCOUNT_ID?new SqlOrganizationStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const claims=process.env.ACCESS_ACCOUNT_ID?new SqlClaimsStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const catalogue=process.env.ACCESS_ACCOUNT_ID?new SqlCatalogueStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const learning=process.env.ACCESS_ACCOUNT_ID?new SqlLearningStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const recommendations=process.env.ACCESS_ACCOUNT_ID?new SqlRecommendationStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const workflows=process.env.ACCESS_ACCOUNT_ID?new SqlWorkflowStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const provider=configuredProvider(process.env),aiBudget=access?new SqlAiBudget(process.env.ACCESS_ACCOUNT_ID!):undefined;
const knowledgeTransfer=access&&aiBudget&&process.env.KNOWLEDGE_TRANSFER_ENABLED!=='false'?new KnowledgeTransferService(access,aiBudget,provider):undefined;
const assistant=access?new AssistantService(access,organization,provider,claims,usage=>console.info(JSON.stringify({event:'ai.usage',...usage})) ,catalogue,process.env.ACCESS_ACCOUNT_ID?new SqlConversationsStore(process.env.ACCESS_ACCOUNT_ID):undefined,learning,workflows,aiBudget!):undefined;
const learningGenerator:QuizGenerator|undefined=assistant?async(actor,prompt,signal)=>{const result=await assistant.chat(actor,{messages:[{role:'user',content:prompt}]},signal);return {artifact:result.artifact,reply:result.reply,provider:assistant.status().provider??'AI'};}:undefined;
const practice=learning&&process.env.ACCESS_ACCOUNT_ID?new LearningPracticeService(learning,new SqlPracticeStore(process.env.ACCESS_ACCOUNT_ID),learningGenerator):undefined;
const planner=learning?new LearningPlannerService(learning,learningGenerator):undefined;
const recovery=learning&&process.env.ACCESS_ACCOUNT_ID?new LearningRecoveryService(learning,new SqlRecoveryStore(process.env.ACCESS_ACCOUNT_ID),learningGenerator):undefined;
const app = createApp(config ? { verify: tokenVerifier(config),access,organization,assistant,knowledgeTransfer,catalogue,claims,learning,practice,planner,recovery,workflows,recommendations,resolveAccess:access?identity=>access.resolveIdentity(identity):undefined, profile:async identity=>{
  const id=await access?.resolveIdentity(identity);
  if(!id)return ownProfile(identity);
  const state=await access!.snapshot({includeAudit:false});const person=state.people.find(person=>person.id===id);
  if(!person||!can(state,person,'profile.view',true))return undefined;
  return {id:person.id,displayName:person.displayName,employeeCode:person.employeeCode,organization:'Development Workspace',status:person.active?'ACTIVE':'SUSPENDED',roles:state.roles.filter(role=>person.roleIds.includes(role.id)).map(role=>role.name),canManageAccess:can(state,person,'permissions.manage'),canViewSkills:can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage')};
} } : undefined, { developmentStore, hostedDemo });
// Vercel owns the listener and lifecycle; local/Azure Node hosting keeps its server.
export default app;
if (process.env.VERCEL !== '1') {
  const host = process.env.HOST ?? '127.0.0.1';
  const server = app.listen(port, host, () => {
    console.log(`Capability API: http://${host}:${port}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => server.close(() => { closeRuntimeDatabase().then(() => process.exit(0)).catch(() => process.exit(1)); }));
  }
}
