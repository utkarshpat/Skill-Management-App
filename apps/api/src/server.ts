import { SqlOrganizationStore } from './modules/organization/sql-store.js';
import { createApp } from './app.js';
import { identityConfig, tokenVerifier } from './modules/identity/index.js';
import { ownProfile } from './modules/identity/index.js';
import { closeRuntimeDatabase } from './shared/database.js';
import { developmentLoginEnabled } from './modules/identity/index.js';
import { SqlAccessStore } from './modules/access/sql-access-store.js';
import {can} from './modules/access/index.js';
import {AssistantService,configuredProvider} from './modules/ai/index.js';
import { SqlCatalogueStore } from './modules/skills/sql-store.js';
import { SqlClaimsStore } from './modules/skills/sql-claims-store.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const config = identityConfig(process.env);
const access=process.env.ACCESS_ACCOUNT_ID?new SqlAccessStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const developmentStore = developmentLoginEnabled(process.env) ? access : undefined;
const organization=process.env.ACCESS_ACCOUNT_ID?new SqlOrganizationStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const claims=process.env.ACCESS_ACCOUNT_ID?new SqlClaimsStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const assistant=access?new AssistantService(access,organization,configuredProvider(process.env),claims):undefined;
const catalogue=process.env.ACCESS_ACCOUNT_ID?new SqlCatalogueStore(process.env.ACCESS_ACCOUNT_ID):undefined;
const server = createApp(config ? { verify: tokenVerifier(config),access,organization,assistant,catalogue,claims,resolveAccess:access?identity=>access.resolveIdentity(identity):undefined, profile:async identity=>{
  const id=await access?.resolveIdentity(identity);
  if(!id)return ownProfile(identity);
  const state=await access!.snapshot();const person=state.people.find(person=>person.id===id);
  if(!person||!can(state,person,'profile.view',true))return undefined;
  return {id:person.id,displayName:person.displayName,employeeCode:person.employeeCode,organization:'Development Workspace',status:person.active?'ACTIVE':'SUSPENDED',roles:state.roles.filter(role=>person.roleIds.includes(role.id)).map(role=>role.name),canManageAccess:can(state,person,'permissions.manage'),canViewSkills:can(state,person,'skill.view')||can(state,person,'skill.catalogue.manage')};
} } : undefined, { developmentStore }).listen(port, '127.0.0.1', () => {
  console.log(`Capability API: http://127.0.0.1:${port}`);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => server.close(() => { closeRuntimeDatabase().then(() => process.exit(0)).catch(() => process.exit(1)); }));
}
