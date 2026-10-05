// Read-only parity + rollback fixtures. No production grants or audit rows persist.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sql from 'mssql';
import {withDatabase,withRuntimeDatabase,closeRuntimeDatabase} from '../src/shared/database.js';
import {SqlAccessStore} from '../src/modules/access/sql-access-store.js';
import {can} from '../src/modules/access/local-access-store.js';
const account=process.env.ACCESS_ACCOUNT_ID;assert.ok(account);
const sets=(result:{recordsets:unknown})=>result.recordsets as Record<string,unknown>[][];
await withDatabase(async pool=>{
 const tx=new sql.Transaction(pool);await tx.begin();let aborted=false;tx.on('rollback',()=>{aborted=true;});
 try {
  const installed=(await new sql.Request(tx).query('SELECT version FROM dbo.SchemaMigration')).recordset.map(row=>Number(row.version));
  for(const file of ['041_dashboard_top_skills.sql','042_skill_last_used.sql','043_own_organization_profile.sql','044_standard_proficiency.sql','045_person_employment.sql','046_own_skill_read_access.sql','047_bounded_growth_claims.sql','048_actor_access_context.sql','049_paginated_access_audit.sql'])if(!installed.includes(Number(file.slice(0,3))))for(const batch of (await readFile(new URL('../../../database/migrations/'+file,import.meta.url),'utf8')).split(/^GO\s*$/m))if(batch.trim())await new sql.Request(tx).batch(batch);
  await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).query("UPDATE p SET job_title=N'Rollback parity title',grade=N'Rollback grade' FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND p.person_id=(SELECT TOP(1) person_id FROM dbo.AccessPerson WHERE account_id=@account_id ORDER BY employee_code);");
  const full=(await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).execute('dbo.ReadAccessWorkspace')).recordsets as unknown as Record<string,unknown>[][];
  const actorRead=(id:unknown,notifications=false)=>new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,id).input('include_notifications',sql.Bit,notifications).execute('dbo.ReadActorAccessContext');
  for(const person of full[3]){
   const compact=(await actorRead(person.id)).recordsets as unknown as Record<string,unknown>[][];
   const roles=full[4].filter(r=>r.personId===person.id).map(r=>r.roleId);
   const expected=[full[0],full[1].filter(r=>roles.includes(r.id)),full[2].filter(r=>roles.includes(r.roleId)),[person],full[4].filter(r=>r.personId===person.id),full[5].filter(r=>r.personId===person.id),[]];
   const canonical=(rows:unknown[])=>rows.map(r=>JSON.stringify(r)).sort();for(let i=0;i<7;i++)assert.deepEqual(canonical(compact[i]),canonical(expected[i]));
  }
  assert.equal(sets(await actorRead('55555555-5555-4555-8555-555555555555'))[3].length,0);
  const notifications=sets(await actorRead(full[3][0].id,true))[6] as unknown as Record<string,unknown>[];
  assert.ok(notifications.length<=30&&notifications.every(e=>e.targetId===full[3][0].id&&e.action==='person.updated'));
  const admin=(await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).query("SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@account AND dbo.AccessCan(@account,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account,person_id,'audit.view',0)=1")).recordset[0];assert.ok(admin);
  const readAudit=(before:number|null=null,personId:string|null=null,actor=admin.id)=>new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('before',sql.Int,before).input('person_id',sql.UniqueIdentifier,personId).input('page_size',sql.Int,5).execute('dbo.ReadAccessAuditPage');
  const first=sets(await readAudit())[1] as unknown as Record<string,unknown>[];
  assert.ok(first.length<=6&&first.every(e=>e.before===null&&e.after===null));
  if(first.length>5){const next=sets(await readAudit(Number(first[4].revision)))[1] as unknown as Record<string,unknown>[];assert.ok(next.every(e=>Number(e.revision)<Number(first[4].revision)));}
  const own=sets(await readAudit(null,String(full[3][0].id)))[1] as unknown as Record<string,unknown>[];assert.ok(own.every(e=>e.targetId===full[3][0].id));
  // Permission revocation must be observed on the next SQL read, not hidden by a cache.
  await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('actor',sql.UniqueIdentifier,admin.id).query("UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@actor;");
  const revoked=sets(await actorRead(admin.id))[3][0];assert.equal(revoked.active,false);assert.equal(revoked.hasDirectReports,false);
  await assert.rejects(readAudit(),e=>(e as {number:number}).number===51003);
  console.log('PASS: every actor matches full grants/flags; notification bound; audit cursor/participant filter; revoked SQL access denied.');
 } finally {if(!aborted)await tx.rollback();}
 console.log('PASS: all schema/test changes rolled back.');
});

// Set ACTOR_ACCESS_INSTALLED_TESTS=1 only after reviewed migrations are installed.
// Installed-procedure checks run as the restricted runtime, never the setup identity.
if(process.env.ACTOR_ACCESS_INSTALLED_TESTS==='1'){
try {
 const store=new SqlAccessStore(account),state=await store.snapshot({includeAudit:false});
 for(const actor of state.people){const compact=await store.actorSnapshot(actor.id);assert.equal(compact.people.length,1);assert.deepEqual(compact.people[0],actor);assert.ok(compact.roles.every(r=>actor.roleIds.includes(r.id)));}
 const admin=state.people.find(p=>can(state,p,'audit.view'));assert.ok(admin);
 assert.ok((await store.auditPage(admin.id,{query:'',pageSize:5,details:false})).items.length<=5);
 const denied=state.people.find(p=>!can(state,p,'audit.view'));assert.ok(denied);
 await assert.rejects(store.auditPage(denied.id,{query:'',pageSize:5,details:false}),e=>(e as {status:number}).status===403);
 for(const procedure of ['dbo.ReadActorAccessContext','dbo.ReadAccessAuditPage'])await assert.rejects(withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,'55555555-5555-4555-8555-555555555555').input('actor_id',sql.UniqueIdentifier,admin.id).execute(procedure)),e=>(e as {number:number}).number===51003);
 console.log('PASS: restricted runtime actor parity, both procedure grants, audit denial and foreign-account isolation.');
} finally {await closeRuntimeDatabase();}

}
