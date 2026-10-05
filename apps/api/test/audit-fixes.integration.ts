// Opt-in setup-identity test: outstanding DDL and fixture overrides are rolled back.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withDatabase} from '../src/shared/database.js';
const account=process.env.ACCESS_ACCOUNT_ID;assert.ok(account);
const files=['041_dashboard_top_skills.sql','042_skill_last_used.sql','043_own_organization_profile.sql','044_standard_proficiency.sql','045_person_employment.sql','046_own_skill_read_access.sql','047_bounded_growth_claims.sql','048_actor_access_context.sql','049_paginated_access_audit.sql'];
await withDatabase(async pool=>{
 for(const deniedProcedure of ['dbo.ReadOwnGrowthClaims','dbo.ReadOwnSkillClaims']){
  const tx=new sql.Transaction(pool);await tx.begin();
  try{
   const versions=(await new sql.Request(tx).query('SELECT version FROM dbo.SchemaMigration')).recordset.map(row=>Number(row.version));
   for(const file of files){if(versions.includes(Number(file.slice(0,3))))continue;const source=await readFile(new URL('../../../database/migrations/'+file,import.meta.url),'utf8');for(const batch of source.split(/^GO\s*$/m))if(batch.trim())await new sql.Request(tx).batch(batch);}
   const fixture:sql.IResult<{actor:string;skill:string}>=await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).query("SELECT TOP(1) p.person_id AS actor,d.skill_id AS skill FROM dbo.AccessPerson p JOIN dbo.SkillClaimDraft d ON d.account_id=p.account_id AND d.person_id=p.person_id WHERE p.account_id=@account AND p.active=1 ORDER BY d.updated_at DESC;");
   assert.equal(fixture.recordset.length,1,'At least one existing active own claim is required for this rollback test.');
   const {actor,skill}=fixture.recordset[0];
   await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('actor',sql.UniqueIdentifier,actor).query("DELETE dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@actor AND permission_code IN ('profile.view','learning.view','skill.view'); INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect,reason,valid_until) SELECT @account,@actor,p.permission_code,s.scope,'ALLOW','Rollback-only audit regression',DATEADD(hour,1,SYSUTCDATETIME()) FROM (VALUES('profile.view'),('learning.view'),('skill.view')) p(permission_code) CROSS JOIN (VALUES('OWN'),('ORGANIZATION')) s(scope);");
   await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('actor',sql.UniqueIdentifier,actor).input('plan',sql.UniqueIdentifier,randomUUID()).input('payload',sql.NVarChar(sql.MAX),JSON.stringify({skillId:skill,title:'Rollback-only journey'})).query("INSERT dbo.LearningPlan(account_id,plan_id,person_id,revision,status,payload) VALUES(@account,@plan,@actor,1,'ACTIVE',@payload);");
   const read=(procedure:string)=>new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).execute(procedure);
   const result=await read('dbo.ReadOwnGrowthClaims'),sets=result.recordsets as sql.IRecordSet<any>[];
   assert.ok(sets[0][0].total>=1&&sets[0][0].total<=50);assert.equal(sets[1].length,sets[0][0].total);assert.ok(sets[1].some(row=>row.skillId.toLowerCase()===skill.toLowerCase()));assert.equal(new Set(sets[1].map(row=>row.skillId.toLowerCase())).size,sets[1].length);
   await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('actor',sql.UniqueIdentifier,actor).query("UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@actor AND permission_code='skill.view' AND scope_kind='OWN';");
   await assert.rejects(read(deniedProcedure),error=>(error as {number:number}).number===51003);
   console.log(deniedProcedure+': bounded projection and OWN deny verified; all changes rolled back.');
  }finally{await tx.rollback().catch(()=>undefined);}
 }
});
