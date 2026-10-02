import assert from 'node:assert/strict';
import sql from 'mssql';
import { SqlAccessStore } from '../src/sql-access-store.js';
import { can } from '../src/local-access-store.js';
import { withRuntimeDatabase,closeRuntimeDatabase } from '../src/database.js';

// Explicit live integration check. No employee changes are written by this script.
const accountId=process.env.ACCESS_ACCOUNT_ID;
assert.ok(accountId,'Configure the development workspace account first.');
try {
 const state=await new SqlAccessStore(accountId).snapshot();
 assert.ok(state.roles.length&&state.people.length);
 const admin=state.people.find(person=>can(state,person,'permissions.manage')&&can(state,person,'users.manage'))!;
 assert.ok(admin,'Active permission administrator required.');
 const mapped=state.people.find(person=>person.entraObjectId);
 assert.ok(mapped?.entraObjectId,'Explicit Microsoft owner mapping required.');
 const tenantId=process.env.ENTRA_TENANT_ID;assert.ok(tenantId);
 const repository=new SqlAccessStore(accountId);
 assert.equal(await repository.resolveIdentity({tenantId,objectId:mapped.entraObjectId}),mapped.id);
 assert.equal(await repository.resolveIdentity({tenantId:'55555555-5555-4555-8555-555555555555',objectId:mapped.entraObjectId}),undefined);
 assert.equal(await repository.resolveIdentity({tenantId,objectId:'55555555-5555-4555-8555-555555555555'}),undefined);
 const denied=state.people.find(person=>person.overrides.some(item=>item.permission==='profile.view'&&item.effect==='DENY'&&item.scope==='OWN'));
 if(denied)assert.equal(can(state,denied,'profile.view',true),false);
 const sqlReject=async(account:string,actor:string,revision:number,number:number)=>{
  await assert.rejects(withRuntimeDatabase(pool=>pool.request()
   .input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('expected_revision',sql.Int,revision)
   .input('kind',sql.VarChar(10),'role').input('target_id',sql.UniqueIdentifier,state.roles[0].id)
   .input('is_new',sql.Bit,false).input('payload',sql.NVarChar(sql.MAX),'{}').execute('dbo.SaveAccessChange')),error=>(error as {number:number}).number===number);
 };
 await sqlReject(accountId,admin.id,state.revision-1,51009);
 await sqlReject(accountId,'55555555-5555-4555-8555-555555555555',state.revision,51003);
 await sqlReject('55555555-5555-4555-8555-555555555555',admin.id,state.revision,51003);
 const adminRole=state.roles.find(role=>admin.roleIds.includes(role.id)&&role.permissions.some(item=>item.permission==='permissions.manage'&&item.effect==='ALLOW'))!;
 await assert.rejects(withRuntimeDatabase(pool=>pool.request()
  .input('account_id',sql.UniqueIdentifier,accountId).input('actor_id',sql.UniqueIdentifier,admin.id).input('expected_revision',sql.Int,state.revision)
  .input('kind',sql.VarChar(10),'role').input('target_id',sql.UniqueIdentifier,adminRole.id).input('is_new',sql.Bit,false)
  .input('payload',sql.NVarChar(sql.MAX),JSON.stringify({...adminRole,permissions:[]})).execute('dbo.SaveAccessChange')),
  error=>(error as {number:number;message:string}).number===51000&&/at least one active/.test((error as Error).message));
 await assert.rejects(withRuntimeDatabase(pool=>pool.request().input('account_id',sql.UniqueIdentifier,'55555555-5555-4555-8555-555555555555').execute('dbo.ReadAccessWorkspace')),error=>(error as {number:number}).number===51003);
 for(const command of ['SELECT TOP 1 * FROM dbo.AccessPerson','UPDATE dbo.AccessAudit SET action=action'])await assert.rejects(withRuntimeDatabase(pool=>pool.request().query(command)),error=>(error as {number:number}).number===229);
 await closeRuntimeDatabase();
 const fresh=await new SqlAccessStore(accountId).snapshot();assert.equal(fresh.revision,state.revision);assert.deepEqual(fresh,state);
 console.log('SQL access checks passed: persisted state, current permissions, stale write denial, unauthorized actor denial, workspace isolation, direct table/audit modification denial and atomic rollback.');
}finally{await closeRuntimeDatabase();}
