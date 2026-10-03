import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withDatabase} from '../src/shared/database.js';
const account=process.env.ACCESS_ACCOUNT_ID;assert.ok(account);
await withDatabase(async pool=>{
 const people=(await pool.request().input('account',sql.UniqueIdentifier,account).query("SELECT TOP(1) o.person_id AS employee,o.manager_id AS manager FROM dbo.AccessOrgAssignment o WHERE o.account_id=@account AND o.manager_id IS NOT NULL AND dbo.AccessCan(@account,o.person_id,'skill.claim',1)=1 ORDER BY o.person_id")).recordset[0];assert.ok(people);
 const other=(await pool.request().input('account',sql.UniqueIdentifier,account).input('employee',sql.UniqueIdentifier,people.employee).input('manager',sql.UniqueIdentifier,people.manager).query('SELECT TOP(1) person_id AS id FROM dbo.AccessPerson WHERE account_id=@account AND active=1 AND person_id NOT IN (@employee,@manager)')).recordset[0].id;
 async function fixture(action:(tx:sql.Transaction,claim:string)=>Promise<void>){const tx=new sql.Transaction(pool);await tx.begin();let aborted=false;tx.on('rollback',()=>{aborted=true;});try{
  const skill=randomUUID(),claim=randomUUID();
  await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('manager',sql.UniqueIdentifier,people.manager).input('skill',sql.UniqueIdentifier,skill).query("DELETE dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@manager AND permission_code IN ('skill.verify','profile.view'); INSERT dbo.AccessPersonOverride(account_id,person_id,permission_code,scope_kind,effect) VALUES(@account,@manager,'skill.verify','ORGANIZATION','ALLOW'),(@account,@manager,'profile.view','OWN','ALLOW'); INSERT dbo.SkillCatalogue(account_id,skill_id,display_name,category,description,status,definition_revision) VALUES(@account,@skill,'Rollback Review '+CONVERT(varchar(36),@skill),'QA','Rollback-only fixture','PUBLISHED',1); INSERT dbo.SkillProficiencyLevel(account_id,skill_id,rank,display_name,description) VALUES(@account,@skill,1,'Foundation','Deliver a working feature.');");
  await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,people.employee).input('claim_id',sql.UniqueIdentifier,claim).input('expected_revision',sql.Int,0).input('payload',sql.NVarChar(sql.MAX),JSON.stringify({skillId:skill,definitionRevision:1,rank:1,experienceMonths:12,description:'Built a reviewed feature.',projects:'Project contribution',evidence:'Certificate reference'})).execute('dbo.SaveOwnSkillClaim');
  await action(tx,claim);
 }finally{if(!aborted)await tx.rollback();}}
 const transition=(tx:sql.Transaction,claim:string,revision:number,action:string,actor=people.employee)=>new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('claim_id',sql.UniqueIdentifier,claim).input('expected_revision',sql.Int,revision).input('action',sql.VarChar(20),action).input('feedback',sql.NVarChar(2000),'Reviewed project evidence.').execute('dbo.TransitionSkillClaim');
 await fixture(async(tx,claim)=>{
  await transition(tx,claim,1,'SUBMIT');
  const queue=await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,people.manager).execute('dbo.ReadAssignedSkillReviews');assert.ok((queue.recordsets as sql.IRecordSet<{id:string}>[])[1].some(row=>row.id.toLowerCase()===claim));
  await transition(tx,claim,2,'REQUEST_CHANGES',people.manager);
  await transition(tx,claim,3,'SUBMIT');await transition(tx,claim,4,'APPROVE',people.manager);
  const rows=(await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('claim',sql.UniqueIdentifier,claim).query("SELECT status,revision,projects,evidence FROM dbo.SkillClaimDraft WHERE account_id=@account AND claim_id=@claim;SELECT COUNT(*) AS n FROM dbo.AccessAudit WHERE account_id=@account AND target_id=@claim;SELECT COUNT(*) AS n FROM dbo.SkillClaimNotification WHERE account_id=@account AND claim_id=@claim;")).recordsets as sql.IRecordSet<{status:string;revision:number;projects:string;evidence:string;n:number}>[];
  assert.equal(rows[0][0].status,'APPROVED');assert.equal(rows[0][0].revision,5);assert.equal(rows[0][0].projects,'Project contribution');assert.equal(rows[1][0].n,5);assert.equal(rows[2][0].n,4);
 });
 for(const scenario of ['foreign','stale','self','revoked','manager-changed','double-decision'] as const)await fixture(async(tx,claim)=>{
  await transition(tx,claim,1,'SUBMIT');
  if(scenario==='revoked')await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('manager',sql.UniqueIdentifier,people.manager).query("UPDATE dbo.AccessPersonOverride SET effect='DENY' WHERE account_id=@account AND person_id=@manager AND permission_code='skill.verify';");
  if(scenario==='manager-changed')await new sql.Request(tx).input('account',sql.UniqueIdentifier,account).input('employee',sql.UniqueIdentifier,people.employee).input('other',sql.UniqueIdentifier,other).query('UPDATE dbo.AccessOrgAssignment SET manager_id=@other WHERE account_id=@account AND person_id=@employee;');
  if(scenario==='double-decision')await transition(tx,claim,2,'APPROVE',people.manager);
  const expected=scenario==='stale'?51009:scenario==='double-decision'?51010:51003;
  await assert.rejects(transition(tx,claim,scenario==='stale'?1:2,'APPROVE',scenario==='foreign'?other:scenario==='self'?people.employee:people.manager),error=>(error as {number:number}).number===expected);
 });
 console.log('SQL reviews verified: submission, assigned queue, changes/resubmission, approval, evidence, audit, notifications, foreign/self review, revocation, manager change and stale/double decisions. All fixtures rolled back.');
});
