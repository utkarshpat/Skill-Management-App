import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withDatabase,closeRuntimeDatabase} from './shared/database.js';
import {SqlAccessStore} from './modules/access/sql-access-store.js';
import {validateEnterpriseSeed,seedPlan,seedPayload} from './modules/skills/enterprise-seed.js';

// Explicit operator provisioning only; never executed at startup or exposed over HTTP.
try{
 const account=process.env.ACCESS_ACCOUNT_ID,objectId=process.env.ROLE_PRESET_OWNER_OBJECT_ID,tenantId=process.env.ENTRA_TENANT_ID;
 if(process.env.NODE_ENV!=='development'||!account||!objectId||!tenantId||process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Use a configured development workspace and linked Microsoft owner; optional --apply commits the reviewed seed.');
 const actor=await new SqlAccessStore(account).resolveIdentity({tenantId,objectId});if(!actor)throw Error('Configured Microsoft owner is not linked.');
 const seed=validateEnterpriseSeed(JSON.parse(await readFile(new URL('../../../database/seeds/enterprise-catalogue-v1.json',import.meta.url),'utf8')));
 await withDatabase(async pool=>{
  const tx=new sql.Transaction(pool);await tx.begin();let aborted=false;tx.on('rollback',()=>{aborted=true;});
  try{
   const setup=(await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('actor',sql.UniqueIdentifier,actor).query("SELECT w.revision,dbo.AccessCan(@account,@actor,'skill.catalogue.manage',0) AS allowed FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account AND a.status='ACTIVE'; SELECT business_code AS businessCode,display_name AS name FROM dbo.SkillCatalogue WHERE account_id=@account;")).recordsets as sql.IRecordSet<{revision:number;allowed:boolean;businessCode:string|null;name:string}>[];
   if(!setup[0][0]?.allowed)throw Error('Current catalogue-management permission is required.');
   const plan=seedPlan(seed,setup[1]);console.log(`Catalogue plan: ${plan.create.length} new skills; ${plan.preserve.length} existing business codes preserved.`);
   if(process.argv.includes('--apply')){
    let revision=setup[0][0].revision;
    for(const skill of plan.create)await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('expected_revision',sql.Int,revision++).input('target_id',sql.UniqueIdentifier,randomUUID()).input('is_new',sql.Bit,true).input('payload',sql.NVarChar(sql.MAX),JSON.stringify(seedPayload(seed,skill))).execute('dbo.SaveSkillCatalogue');
    await tx.commit();console.log('Seed committed atomically through permission-checked, audited catalogue writes.');
   }else{await tx.rollback();console.log('Plan only. Add --apply to commit.');}
  }catch(error){if(!aborted)await tx.rollback();throw error;}
 });
}catch(error){const number=(error as {number?:number})?.number;console.error(number?`Seed rejected by SQL (${number}); transaction rolled back.`:error instanceof Error?error.message:'Seed failed.');process.exitCode=1;}
finally{await closeRuntimeDatabase();}
