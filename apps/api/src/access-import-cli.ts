import { readFile,writeFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from './database.js';
import { type LocalAccessState,can } from './local-access-store.js';

// Explicit one-time developer operation. Runtime never imports or falls back to local JSON.
if(process.env.NODE_ENV!=='development'||process.env.DEV_DIRECT_LOGIN!=='true')throw new Error('Import is only available in explicit development mode.');
try {
 const state:LocalAccessState=JSON.parse(await readFile(new URL('../.local/dev-access.json',import.meta.url),'utf8'));
 const administrator=state.people.find(person=>can(state,person,'permissions.manage')&&can(state,person,'users.manage'));
 if(!administrator)throw new Error('Source requires an active administrator.');
 await withDatabase(async pool=>{
  const account=await pool.request().input('tenant',sql.UniqueIdentifier,process.env.ENTRA_TENANT_ID).query('SELECT account_id FROM dbo.Account WHERE entra_tenant_id=@tenant AND status=\'ACTIVE\';');
  const accountId=account.recordset[0]?.account_id;
  if(!accountId)throw new Error('Provision the development account before importing.');
  const transaction=new sql.Transaction(pool);await transaction.begin();
  try {
   const existing=await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).query('SELECT revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account;');
   if(existing.recordset.length)throw new Error('Workspace is already initialized. Import will not overwrite it.');
   await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).input('revision',sql.Int,state.revision+1).query('INSERT dbo.AccessWorkspace VALUES(@account,@revision);');
   for(const role of state.roles){
    await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).input('id',sql.UniqueIdentifier,role.id).input('name',sql.NVarChar(100),role.name).query('INSERT dbo.AccountRole VALUES(@account,@id,@name);');
    await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).input('id',sql.UniqueIdentifier,role.id).input('items',sql.NVarChar(sql.MAX),JSON.stringify(role.permissions)).query('INSERT dbo.AccountRolePermission SELECT @account,@id,permission,scope,effect,validUntil FROM OPENJSON(@items) WITH(permission varchar(100),scope varchar(30),effect varchar(5),validUntil datetime2(7));');
   }
   for(const person of state.people){
    await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).input('id',sql.UniqueIdentifier,person.id).input('name',sql.NVarChar(100),person.displayName).input('code',sql.NVarChar(40),person.employeeCode).input('active',sql.Bit,person.active).query('INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active) VALUES(@account,@id,@name,@code,@active);');
    await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).input('id',sql.UniqueIdentifier,person.id).input('items',sql.NVarChar(sql.MAX),JSON.stringify(person.roleIds)).query('INSERT dbo.AccessPersonRole SELECT @account,@id,CONVERT(uniqueidentifier,value) FROM OPENJSON(@items);');
    await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).input('id',sql.UniqueIdentifier,person.id).input('items',sql.NVarChar(sql.MAX),JSON.stringify(person.overrides)).query('INSERT dbo.AccessPersonOverride SELECT @account,@id,permission,scope,effect,validUntil FROM OPENJSON(@items) WITH(permission varchar(100),scope varchar(30),effect varchar(5),validUntil datetime2(7));');
   }
   for(const event of state.audit)await new sql.Request(transaction)
    .input('account',sql.UniqueIdentifier,accountId).input('revision',sql.Int,event.revision).input('actor',sql.UniqueIdentifier,event.actorId).input('action',sql.VarChar(50),event.action).input('target',sql.UniqueIdentifier,event.targetId).input('at',sql.DateTime2,new Date(event.at)).input('before',sql.NVarChar(sql.MAX),event.before?JSON.stringify(event.before):null).input('after',sql.NVarChar(sql.MAX),JSON.stringify(event.after??{historicalEvent:true})).query('INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,occurred_at,before_json,after_json) VALUES(@account,@revision,@actor,@action,@target,@at,@before,@after);');
   await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).input('revision',sql.Int,state.revision+1).input('actor',sql.UniqueIdentifier,administrator.id).input('after',sql.NVarChar(sql.MAX),JSON.stringify({roles:state.roles.length,people:state.people.length,sourceRevision:state.revision})).query("INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,after_json) VALUES(@account,@revision,@actor,'development.import',@account,@after);");
   await new sql.Request(transaction).input('account',sql.UniqueIdentifier,accountId).query("IF DATABASE_PRINCIPAL_ID(N'skill_management_runtime') IS NULL THROW 51000,'Restricted runtime user must be provisioned.',1; INSERT dbo.AccessRuntimeAccount VALUES(DATABASE_PRINCIPAL_ID(N'skill_management_runtime'),@account); GRANT EXECUTE ON dbo.ReadAccessWorkspace TO [skill_management_runtime]; GRANT EXECUTE ON dbo.SaveAccessChange TO [skill_management_runtime];");
   await transaction.commit();
  }catch(error){await transaction.rollback();throw error;}
  await writeFile(new URL('../.local/sql-import.json',import.meta.url),JSON.stringify({accountId,sourceRevision:state.revision,roles:state.roles.length,people:state.people.length},null,2));
  console.log(`Imported ${state.roles.length} roles and ${state.people.length} people. Existing history preserved. ACCESS_ACCOUNT_ID=${accountId}`);
 });
}catch(error){
 const number=error&&typeof error==='object'&&'number' in error?String(error.number):'IMPORT_REJECTED';
 console.error(`Access import failed (${number}). Check migration, source and existing workspace; no overwrite or credentials are printed.`);process.exitCode=1;
}
