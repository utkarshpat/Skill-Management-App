import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { withRuntimeDatabase,closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { SqlClaimsStore } from '../src/modules/skills/sql-claims-store.js';
import { can } from '../src/modules/access/index.js';

const account=process.env.ACCESS_ACCOUNT_ID;assert.ok(account);
try {
  const access=new SqlAccessStore(account),before=await access.snapshot();
  const admin=before.people.find(person=>can(before,person,'skill.catalogue.manage')&&can(before,person,'permissions.manage'));assert.ok(admin);
  const eligible=before.people.filter(person=>can(before,person,'profile.view',true)&&can(before,person,'skill.claim',true)&&can(before,person,'skill.view'));
  assert.ok(eligible.length>=2,'Two explicitly eligible test people are required.');
  const [owner,other]=eligible,claims=new SqlClaimsStore(account);
  const initial=await claims.read(owner.id,1),prefix='Claims integration '+randomUUID();
  await withRuntimeDatabase(async pool=>{
    const fixture=async(test:(tx:sql.Transaction,skill:string,claim:string)=>Promise<void>)=>{
      const tx=new sql.Transaction(pool);await tx.begin();
      try {
        const skill=randomUUID(),claim=randomUUID();
        await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,admin.id).input('expected_revision',sql.Int,before.revision).input('target_id',sql.UniqueIdentifier,skill).input('is_new',sql.Bit,true)
          .input('payload',sql.NVarChar(sql.MAX),JSON.stringify({name:prefix,category:'Rollback-only test',description:'Definition',status:'PUBLISHED',levels:[{rank:1,name:'Foundation',description:'Complete a basic task.'},{rank:2,name:'Independent',description:'Complete the task without assistance.'}]})).execute('dbo.SaveSkillCatalogue');
        await test(tx,skill,claim);
      }finally{await tx.rollback().catch(()=>undefined);}
    };
    const save=(tx:sql.Transaction,skill:string,claim:string,revision=0,actor=owner.id,extra:object={})=>new sql.Request(tx)
      .input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).input('claim_id',sql.UniqueIdentifier,claim).input('expected_revision',sql.Int,revision)
      .input('payload',sql.NVarChar(sql.MAX),JSON.stringify({skillId:skill,definitionRevision:before.revision+1,rank:1,experienceMonths:12,description:'Rollback-only claim',...extra})).execute('dbo.SaveOwnSkillClaim');
    const read=(tx:sql.Transaction,actor=owner.id)=>new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,actor).execute('dbo.ReadOwnSkillClaims');
    await fixture(async(tx,skill,claim)=>{
      const options=await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,owner.id).input('query',sql.NVarChar(100),prefix).execute('dbo.ReadClaimSkills');
      const optionSets=options.recordsets as sql.IRecordSet<{id:string;total:number}>[];assert.equal(optionSets[0][0].total,1);assert.equal(optionSets[2].length,2);
      const discovery=await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,owner.id).input('query',sql.NVarChar(100),prefix).input('category',sql.NVarChar(80),'Rollback-only test').input('page_size',sql.Int,1).execute('dbo.ReadClaimSkills');
      const discovered=discovery.recordsets as sql.IRecordSet<{total:number;description:string;name:string;count:number}>[];
      assert.equal(discovered[0][0].total,1);assert.equal(discovered[1].length,1);assert.equal(discovered[1][0].description,'Definition');assert.ok(discovered[3].some(row=>row.name==='Rollback-only test'&&row.count>=1));
      const wrongCategory=await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,owner.id).input('query',sql.NVarChar(100),prefix).input('category',sql.NVarChar(80),'Missing test category').execute('dbo.ReadClaimSkills');assert.equal((wrongCategory.recordsets as sql.IRecordSet<{total:number}>[])[0][0].total,0);
      await save(tx,skill,claim);await save(tx,skill,claim,1,owner.id,{rank:2});
      const mine=(await read(tx)).recordsets as sql.IRecordSet<{id:string;status:string;revision:number;rank:number}>[];
      assert.ok(mine[1].some(row=>row.id.toLowerCase()===claim&&row.revision===2&&row.rank===2&&row.status==='DRAFT'));
      const theirs=(await read(tx,other.id)).recordsets as sql.IRecordSet<{id:string}>[];assert.ok(!theirs[1].some(row=>row.id.toLowerCase()===claim));
      const audit=(await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).execute('dbo.ReadAccessWorkspace')).recordsets as sql.IRecordSet<{targetId:string;action:string}>[];
      assert.equal(audit[6].filter(item=>item.targetId.toLowerCase()===claim&&item.action.startsWith('claim.draft.')).length,2);
    });
    const rejects=(number:number,test:(tx:sql.Transaction,skill:string,claim:string)=>Promise<unknown>)=>fixture(async(tx,skill,claim)=>{await assert.rejects(test(tx,skill,claim),error=>(error as {number:number}).number===number);});
    await fixture(async(tx,skill,claim)=>{await save(tx,skill,claim);await assert.rejects(save(tx,skill,randomUUID()),error=>[2601,2627].includes((error as {number:number}).number));});
    await rejects(51004,async(tx,skill,claim)=>{await save(tx,skill,claim);return save(tx,skill,claim,1,other.id);});
    await rejects(51009,async(tx,skill,claim)=>{await save(tx,skill,claim);await save(tx,skill,claim,1);return save(tx,skill,claim,1);});
    await rejects(51009,(tx,skill,claim)=>save(tx,skill,claim,0,owner.id,{definitionRevision:before.revision}));
    await rejects(51004,(tx,skill,claim)=>save(tx,skill,claim,0,owner.id,{rank:8}));
    await rejects(51004,async(tx,skill,claim)=>{
      await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,admin.id).input('expected_revision',sql.Int,before.revision+1).input('target_id',sql.UniqueIdentifier,skill).input('is_new',sql.Bit,false)
        .input('payload',sql.NVarChar(sql.MAX),JSON.stringify({name:prefix,category:'Rollback-only test',description:'Archived definition',status:'ARCHIVED',levels:[{rank:1,name:'Foundation',description:'Criteria'}]})).execute('dbo.SaveSkillCatalogue');
      const options=await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,owner.id).input('query',sql.NVarChar(100),prefix).execute('dbo.ReadClaimSkills');
      assert.equal((options.recordsets as sql.IRecordSet<{total:number}>[])[0][0].total,0);
      return save(tx,skill,claim);
    });
    await rejects(51000,(tx,skill,claim)=>save(tx,skill,claim,0,owner.id,{status:'VERIFIED'}));
    await rejects(51000,(tx,skill,claim)=>save(tx,skill,claim,0,owner.id,{experienceMonths:601}));
    await rejects(51003,async(tx,skill,claim)=>{
      await new sql.Request(tx).input('account_id',sql.UniqueIdentifier,account).input('actor_id',sql.UniqueIdentifier,admin.id).input('expected_revision',sql.Int,before.revision+1).input('kind',sql.VarChar(10),'person').input('target_id',sql.UniqueIdentifier,owner.id).input('is_new',sql.Bit,false)
        .input('payload',sql.NVarChar(sql.MAX),JSON.stringify({...owner,overrides:[...owner.overrides.filter(item=>!(item.permission==='skill.claim'&&item.scope==='OWN')),{permission:'skill.claim',scope:'OWN',effect:'DENY'}]})).execute('dbo.SaveAccessChange');
      return save(tx,skill,claim);
    });
    await assert.rejects(pool.request().input('account_id',sql.UniqueIdentifier,randomUUID()).input('actor_id',sql.UniqueIdentifier,owner.id).execute('dbo.ReadOwnSkillClaims'),error=>(error as {number:number}).number===51003);
    await assert.rejects(pool.request().query('SELECT TOP 1 * FROM dbo.SkillClaimDraft'),error=>(error as {number:number}).number===229);
  });
  assert.equal((await access.snapshot()).revision,before.revision);
  assert.deepEqual(await claims.read(owner.id,1),initial);
  console.log('Live claims SQL verified: own isolation, CAS, duplicate prevention, level validation, DENY, restricted runtime and transactional audit. All fixtures rolled back.');
}finally{await closeRuntimeDatabase();}
