import { SqlAccessStore } from './sql-access-store.js';
import { can } from './local-access-store.js';
import { closeRuntimeDatabase } from './database.js';
import { rolePresets } from './role-presets.js';

// Explicit local provisioning. Uses the same validated, audited SQL write path
// as the administrator UI; never assigns people or overwrites customized roles.
try {
  const account=process.env.ACCESS_ACCOUNT_ID;
  const objectId=process.env.ROLE_PRESET_OWNER_OBJECT_ID;
  const tenantId=process.env.ENTRA_TENANT_ID;
  if(process.env.NODE_ENV!=='development'||!account||!objectId||!tenantId) throw new Error('Development workspace and explicit Microsoft owner identity required.');
  const store=new SqlAccessStore(account);
  const actor=await store.resolveIdentity({tenantId,objectId});
  if(!actor)throw new Error('Owner identity is not linked.');
  for(const preset of rolePresets) {
    const state=await store.snapshot();
    const person=state.people.find(person=>person.id===actor);
    if(!person||!can(state,person,'permissions.manage'))throw new Error('Current administrator permission required.');
    if(state.roles.some(role=>role.name.toLowerCase()===preset.name.toLowerCase())) { console.log(`Preserved existing role: ${preset.name}`); continue; }
    await store.save(actor,{kind:'role',revision:state.revision,name:preset.name,permissions:preset.permissions});
    console.log(`Created ${preset.name}: ${preset.permissions.length} assignments; ${preset.pending.length} scoped proposals pending organization setup.`);
  }
} catch(error) {
  console.error(error instanceof Error?error.message:'Preset provisioning failed.');process.exitCode=1;
} finally { await closeRuntimeDatabase(); }
