import {SqlAccessStore} from './modules/access/sql-access-store.js';
import {can,type PermissionCode,type Assignment} from './modules/access/index.js';
import {closeRuntimeDatabase} from './shared/database.js';
// Explicit provisioning requested by the workspace owner. Never run at API startup.
try{
 const account=process.env.ACCESS_ACCOUNT_ID;if(!account)throw Error('Workspace is not configured.');
 const store=new SqlAccessStore(account),initial=await store.snapshot();
 const administrators=initial.people.filter(p=>p.active&&p.entraObjectId&&can(initial,p,'permissions.manage'));
 if(administrators.length!==1)throw Error('An unambiguous linked permission administrator is required.');
 for(const role of initial.roles){
  const additions:Assignment[]=[];
  for(const prefix of ['request','incident'] as const){
   if(!role.permissions.some(p=>p.permission===prefix+'.view'&&p.effect==='ALLOW'))continue;
   for(const suffix of ['assign','resolve']){const permission=(prefix+'.'+suffix) as PermissionCode;if(!role.permissions.some(p=>p.permission===permission))additions.push({permission,scope:'OWN',effect:'ALLOW'});}
  }
  if(!additions.length)continue;console.log(`${process.argv.includes('--apply')?'Applying':'Plan'} ${role.name}: ${additions.map(p=>p.permission+' OWN').join(', ')}`);
  if(process.argv.includes('--apply')){const current=await store.snapshot();await store.save(administrators[0].id,{kind:'role',id:role.id,revision:current.revision,name:role.name,permissions:[...role.permissions,...additions]});}
 }
 console.log('Existing explicit grants/denies and individual overrides are preserved. No organization-wide record access is granted.');
}catch(e){console.error(e instanceof Error?e.message:'Permission provisioning failed.');process.exitCode=1;}finally{await closeRuntimeDatabase();}
