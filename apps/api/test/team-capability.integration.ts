import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withDatabase} from '../src/shared/database.js';
const account=process.env.ACCESS_ACCOUNT_ID;assert.ok(account);
await withDatabase(async pool=>{
 const fixture=(await pool.request().input('account',sql.UniqueIdentifier,account).query('SELECT TOP(1) o.person_id AS employee,o.manager_id AS manager FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson p ON p.account_id=o.account_id AND p.person_id=o.person_id AND p.active=1 WHERE o.account_id=@account AND o.manager_id IS NOT NULL AND o.manager_id<>o.person_id ORDER BY o.person_id')).recordset[0];assert.ok(fixture);
 const outside=(await pool.request().input('account',sql.UniqueIdentifier,account).input('manager',sql.UniqueIdentifier,fixture.manager).query('SELECT TOP(1) p.person_id AS id FROM dbo.AccessPerson p LEFT JOIN dbo.AccessOrgAssignment o ON o.account_id=p.account_id AND o.person_id=p.person_id WHERE p.account_id=@account AND p.active=1 AND p.person_id<>@manager AND (o.manager_id IS NULL OR o.manager_id<>@manager)')).recordset[0];assert.ok(outside);
 for(const scenario of ['scope','foreign','self','reassigned','revoked','inactive'] as const){
  const tx=new sql.Transaction(pool);await tx.begin();let aborted=false;tx.on('rollback',()=>{aborted=true;});
  try{
   await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('manager',sql.UniqueIdentifier,fixture.manager).query("DELETE dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@manager AND permission_code IN ('profile.view','skill.view','skill.verify');INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect) VALUES(@account,@manager,'profile.view','OWN','ALLOW'),(@account,@manager,'skill.view','ORGANIZATION','ALLOW'),(@account,@manager,'skill.verify','ORGANIZATION','ALLOW');");
   const read=(person:string|null=null)=>new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,fixture.manager).input('person_id',sql.UniqueIdentifier,person).execute('dbo.ReadDirectReportCapability');
   if(scenario==='foreign'||scenario==='self'){await assert.rejects(read(scenario==='self'?fixture.manager:outside.id),e=>(e as {number:number}).number===51004);continue;}
   if(scenario==='revoked'){await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('manager',sql.UniqueIdentifier,fixture.manager).query("UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@manager AND permission_code='skill.view';");await assert.rejects(read(),e=>(e as {number:number}).number===51003);continue;}
   if(scenario==='reassigned')await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('employee',sql.UniqueIdentifier,fixture.employee).query('UPDATE dbo.AccessOrgAssignment SET manager_id=NULL WHERE account_id=@account AND person_id=@employee;');
   if(scenario==='inactive')await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('employee',sql.UniqueIdentifier,fixture.employee).query('UPDATE dbo.AccessPerson SET active=0 WHERE account_id=@account AND person_id=@employee;');
   if(scenario!=='scope'){await assert.rejects(read(fixture.employee),e=>(e as {number:number}).number===51004);continue;}
   const fixtureSkill=randomUUID(),fixtureClaim=randomUUID(),skillName='Rollback Analytics '+fixtureSkill;
   const setup=(await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).query("SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account; SELECT TOP(1) person_id AS actor FROM dbo.AccessPerson WHERE account_id=@account AND dbo.AccessCan(@account,person_id,'skill.catalogue.manage',0)=1;")).recordsets as sql.IRecordSet<{revision:number;actor:string}>[];
   await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,setup[1][0].actor).input('expected_revision',sql.Int,setup[0][0].revision).input('target_id',sql.UniqueIdentifier,fixtureSkill).input('is_new',sql.Bit,true).input('payload',sql.NVarChar(sql.MAX),JSON.stringify({name:skillName,category:'Analytics QA',description:'Rollback-only analytics fixture',status:'PUBLISHED',levels:[{rank:1,name:'Awareness',description:'Understand basics.'},{rank:2,name:'Beginner',description:'Work with guidance.'},{rank:3,name:'Intermediate',description:'Deliver independently.'}]})).execute('dbo.SaveSkillCatalogue');
   await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('employee',sql.UniqueIdentifier,fixture.employee).input('manager',sql.UniqueIdentifier,fixture.manager).input('skill',sql.UniqueIdentifier,fixtureSkill).input('claim',sql.UniqueIdentifier,fixtureClaim).input('name',sql.NVarChar(100),skillName).query("INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,description,status,reviewer_id) VALUES(@account,@claim,@employee,@skill,1,1,@name,N'Analytics QA',3,N'Intermediate',N'Deliver independently.',12,N'Rollback-only evidence','APPROVED',@manager);");
   const rows=(await read(fixture.employee)).recordsets as unknown as [sql.IRecordSet<{total:number}>,sql.IRecordSet<{id:string;reviewed:number;pending:number}>,sql.IRecordSet<{status:string;personId:string}>];
   assert.equal(rows[0][0].total,1);assert.equal(rows[1][0].id.toLowerCase(),fixture.employee.toLowerCase());
   assert.ok(rows[2].every(s=>s.personId.toLowerCase()===fixture.employee.toLowerCase()&&['APPROVED','SUBMITTED'].includes(s.status)));
   assert.equal(rows[2].filter(s=>s.status==='APPROVED').length,rows[1][0].reviewed);assert.equal(rows[2].filter(s=>s.status==='SUBMITTED').length,rows[1][0].pending);
   assert.ok(rows[2].every(s=>!('description' in s)&&!('evidence' in s)&&!('projects' in s)));
   const analytics=(await read(fixture.employee)).recordsets as unknown as sql.IRecordSet<Record<string,unknown>>[];
   assert.equal(analytics[3][0].members,1);
   assert.equal(analytics[3][0].reviewed,rows[1][0].reviewed);assert.equal(analytics[3][0].pending,rows[1][0].pending);
   assert.ok(analytics[4].every(s=>Number(s.people)===1&&String(s.memberIds).toLowerCase()===fixture.employee.toLowerCase()&&Number(s.rank)>=1&&Number(s.rank)<=5));
   assert.equal(analytics[5].reduce((n,s)=>n+Number(s.count),0),rows[1][0].reviewed);
   assert.equal(analytics[6].reduce((n,s)=>n+Number(s.count),0),rows[1][0].reviewed);
   assert.deepEqual(analytics[4].filter(s=>s.skillName===skillName).map(s=>Number(s.rank)),[1,2,3]);
   const roster=(await read()).recordsets as unknown as [sql.IRecordSet<{total:number}>,sql.IRecordSet<{id:string}>,sql.IRecordSet<unknown>];assert.equal(roster[2].length,0,'Roster must not load every employee claim.');assert.ok(roster[1].every(p=>p.id.toLowerCase()!==fixture.manager.toLowerCase()&&p.id.toLowerCase()!==outside.id.toLowerCase()));
  }finally{if(!aborted)await tx.rollback();}
 }
 console.log('Team scope SQL checks passed: exact direct reports, private draft exclusion, minimal detail, foreign/self selectors, reassignment, inactive people and revocation. All changes rolled back.');
});
