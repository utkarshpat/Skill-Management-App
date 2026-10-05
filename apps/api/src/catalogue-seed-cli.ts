import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withDatabase,closeRuntimeDatabase} from './shared/database.js';
import {SqlAccessStore} from './modules/access/sql-access-store.js';
import {validateEnterpriseSeed,seedPlan,seedPayload,alignmentPlan} from './modules/skills/enterprise-seed.js';
import type {CatalogueSkill} from './modules/skills/skill-catalogue.js';

// Explicit operator provisioning only; never executed at startup or exposed over HTTP.
try{
 const account=process.env.ACCESS_ACCOUNT_ID,objectId=process.env.ROLE_PRESET_OWNER_OBJECT_ID,tenantId=process.env.ENTRA_TENANT_ID;
 if(process.env.NODE_ENV!=='development'||!account||!objectId||!tenantId||process.argv.slice(2).some(arg=>arg!=='--apply'&&arg!=='--align-existing'))throw Error('Use a configured development workspace and linked Microsoft owner; --align-existing previews current five-level mappings and optional --apply commits.');
 const align=process.argv.includes('--align-existing');
 const actor=await new SqlAccessStore(account).resolveIdentity({tenantId,objectId});if(!actor)throw Error('Configured Microsoft owner is not linked.');
 const seed=validateEnterpriseSeed(JSON.parse(await readFile(new URL('../../../database/seeds/enterprise-catalogue-v1.json',import.meta.url),'utf8')));
 await withDatabase(async pool=>{
  const tx=new sql.Transaction(pool);await tx.begin();let aborted=false;tx.on('rollback',()=>{aborted=true;});
  try{
   const setup=(await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('actor',sql.UniqueIdentifier,actor).query("SELECT w.revision,dbo.AccessCan(@account,@actor,'skill.catalogue.manage',0) AS allowed FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account AND a.status='ACTIVE'; IF dbo.AccessCan(@account,@actor,'skill.catalogue.manage',0)=1 SELECT s.skill_id AS id,s.business_code AS businessCode,s.display_name AS name,s.category,s.description,s.status,JSON_QUERY((SELECT rank,display_name AS name,description FROM dbo.SkillProficiencyLevel l WHERE l.account_id=s.account_id AND l.skill_id=s.skill_id ORDER BY rank FOR JSON PATH)) AS levels FROM dbo.SkillCatalogue s WHERE s.account_id=@account ORDER BY s.display_name,s.skill_id;")).recordsets as [sql.IRecordSet<{revision:number;allowed:boolean}>,sql.IRecordSet<Omit<CatalogueSkill,'levels'>&{levels:string}>];
   if(!setup[0][0]?.allowed)throw Error('Current catalogue-management permission is required.');
   const existing=setup[1].map(row=>({...row,businessCode:row.businessCode??null,levels:JSON.parse(row.levels) as CatalogueSkill['levels']}));
   const plan=align?{create:[],preserve:[]}:seedPlan(seed,existing),changes=align?alignmentPlan(existing):[];
   console.log(align?`Alignment plan: ${changes.length} definitions to align; ${existing.length-changes.length} already aligned. Historical claims and prior definitions remain unchanged.`:`Catalogue plan: ${plan.create.length} new skills; ${plan.preserve.length} existing business codes preserved.`);
   for(const change of changes)console.log(`${change.payload.businessCode??change.payload.name}: ${change.before.join(' / ')} -> ${change.payload.levels.map(level=>level.name).join(' / ')}`);
   if(process.argv.includes('--apply')){
    const installed=await new sql.Request(tx).query('SELECT version FROM dbo.SchemaMigration WHERE version=44;');
    if(!installed.recordset.length)throw Error('Deploy migration 044 before applying catalogue changes.');
    let revision=setup[0][0].revision;
    for(const skill of plan.create)await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('expected_revision',sql.Int,revision++).input('target_id',sql.UniqueIdentifier,randomUUID()).input('is_new',sql.Bit,true).input('payload',sql.NVarChar(sql.MAX),JSON.stringify(seedPayload(seed,skill))).execute('dbo.SaveSkillCatalogue');
    for(const change of changes)await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('expected_revision',sql.Int,revision++).input('target_id',sql.UniqueIdentifier,change.id).input('is_new',sql.Bit,false).input('payload',sql.NVarChar(sql.MAX),JSON.stringify(change.payload)).execute('dbo.SaveSkillCatalogue');
    await tx.commit();console.log('Catalogue changes committed atomically through permission-checked, audited writes.');
   }else{await tx.rollback();console.log('Plan only. Add --apply to commit.');}
  }catch(error){if(!aborted)await tx.rollback();throw error;}
 });
}catch(error){const number=(error as {number?:number})?.number;console.error(number?`Seed rejected by SQL (${number}); transaction rolled back.`:error instanceof Error?error.message:'Seed failed.');process.exitCode=1;}
finally{await closeRuntimeDatabase();}
