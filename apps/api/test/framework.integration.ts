import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withDatabase} from '../src/shared/database.js';
import {readFile} from 'node:fs/promises';
import {validateEnterpriseSeed,seedPayload} from '../src/modules/skills/enterprise-seed.js';
const account=process.env.ACCESS_ACCOUNT_ID;assert.ok(account);
const seed=validateEnterpriseSeed(JSON.parse(await readFile(new URL('../../../database/seeds/enterprise-catalogue-v1.json',import.meta.url),'utf8')));
await withDatabase(async pool=>{
 const before=(await pool.request().input('account',sql.UniqueIdentifier,account).query("SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account; SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@account AND dbo.AccessCan(@account,person_id,'skill.catalogue.manage',0)=1;")).recordsets as sql.IRecordSet<{revision:number;id:string}>[];
 const tx=new sql.Transaction(pool);await tx.begin();let aborted=false;tx.on('rollback',()=>{aborted=true;});
 try{
  const ids=[randomUUID(),randomUUID()],revision=before[0][0].revision,actor=before[1][0].id;
  const save=(id:string,expected:number,isNew:boolean,payload:object)=>new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('target_id',sql.UniqueIdentifier,id).input('expected_revision',sql.Int,expected).input('is_new',sql.Bit,isNew).input('payload',sql.NVarChar(sql.MAX),JSON.stringify(payload)).execute('dbo.SaveSkillCatalogue');
  const first={...seedPayload(seed,seed.skills[0]),businessCode:undefined,name:'Framework QA '+ids[0]};
  await save(ids[0],revision,true,first);
  await save(ids[1],revision+1,true,{...seedPayload(seed,seed.skills[1]),businessCode:undefined,name:'Framework QA '+ids[1]});
  await save(ids[0],revision+2,false,{...first,description:'A new definition.',levels:first.levels.map(level=>({...level,description:'Updated criteria for '+level.name}))});
  const sets=(await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('id',sql.UniqueIdentifier,ids[0]).input('second',sql.UniqueIdentifier,ids[1]).query("SELECT definition_revision,framework_id,description FROM dbo.SkillDefinitionVersion WHERE account_id=@account AND skill_id=@id ORDER BY definition_revision; SELECT description FROM dbo.SkillVersionCriterion WHERE account_id=@account AND skill_id=@id AND definition_revision="+(revision+1)+" AND rank=1; SELECT COUNT(*) AS n FROM dbo.SkillProficiencyLevel WHERE account_id=@account AND skill_id=@id; SELECT COUNT(DISTINCT framework_id) AS n FROM dbo.SkillDefinitionVersion WHERE account_id=@account AND skill_id IN (@id,@second); SELECT COUNT(*) AS n FROM dbo.ProficiencyLevel WHERE framework_id='00000000-0000-4000-8000-000000000001';")).recordsets as sql.IRecordSet<{description:string;n:number}>[];
  assert.equal(sets[0].length,2);assert.equal(sets[0][0].description,first.description);assert.equal(sets[0][1].description,'A new definition.');assert.equal(sets[1][0].description,first.levels[0].description);assert.equal(sets[2][0].n,5);assert.equal(sets[3][0].n,1);assert.equal(sets[4][0].n,5);
  await assert.rejects(save(ids[0],revision+3,false,{...first,businessCode:'SKL-999'}),error=>(error as {number:number}).number===51000);
 }finally{if(!aborted)await tx.rollback();}
 const after=await pool.request().input('account',sql.UniqueIdentifier,account).query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account;');assert.equal(after.recordset[0].revision,before[0][0].revision);
 console.log('Versioned framework SQL verified: two skills share five labels, definition edits retain old criteria, current view selects five levels, immutable business codes and fixture rollback.');
});
