import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sql from 'mssql';
import {withRuntimeDatabase,closeRuntimeDatabase} from '../src/shared/database.js';
import {SqlAccessStore} from '../src/modules/access/sql-access-store.js';
import {can} from '../src/modules/access/index.js';
import {SqlConversationsStore} from '../src/modules/ai/conversations.js';

const account=process.env.ACCESS_ACCOUNT_ID;assert.ok(account);
try{
 const access=new SqlAccessStore(account),state=await access.snapshot();
 const eligible=state.people.filter(person=>can(state,person,'profile.view',true));assert.ok(eligible.length>=2);
 const [owner,other]=eligible,store=new SqlConversationsStore(account),before=await store.list(owner.id);
 await withRuntimeDatabase(async pool=>{
  const fixture=async(action:(tx:sql.Transaction)=>Promise<void>)=>{const tx=new sql.Transaction(pool);await tx.begin();try{await action(tx);}finally{await tx.rollback().catch(()=>undefined);}};
  const run=(tx:sql.Transaction,operation:string,id?:string,revision=0,actor=owner.id,targetAccount=account)=>new sql.Request(tx)
   .input('account_id',sql.UniqueIdentifier,targetAccount).input('actor_id',sql.UniqueIdentifier,actor).input('operation',sql.VarChar(8),operation)
   .input('conversation_id',sql.UniqueIdentifier,id??null).input('revision',sql.Int,revision)
   .input('payload',sql.NVarChar(sql.MAX),operation==='save'?JSON.stringify({id,title:'Rollback-only chat',revision,updatedAt:new Date().toISOString(),messages:[{role:'user',content:'Synthetic goal'}],context:{actor,policy:'test',updated:Date.now(),turns:[],notes:[]}}):null).execute('dbo.OwnAiConversations');
  await fixture(async tx=>{
   const ids:string[]=[randomUUID(),randomUUID(),randomUUID()];for(const id of ids)await run(tx,'save',id);
   const list=(await run(tx,'list')).recordset;assert.equal(list.length,2);assert.ok(!list.some(item=>String(item.id).toLowerCase()===ids[0]));
   const saved=(await run(tx,'read',ids[2])).recordset[0];assert.equal(saved.revision,1);
   await run(tx,'save',ids[2],1);assert.equal((await run(tx,'read',ids[2])).recordset[0].revision,2);
   assert.ok(!(await run(tx,'list',undefined,0,other.id)).recordset.some(item=>ids.includes(String(item.id).toLowerCase())));
   await run(tx,'delete',ids[2]);assert.equal((await run(tx,'list')).recordset.length,1);
  });
  await fixture(async tx=>{const id=randomUUID();await run(tx,'save',id);await assert.rejects(run(tx,'save',id,0),e=>(e as {number:number}).number===51009);});
  await fixture(async tx=>{const id=randomUUID();await run(tx,'save',id);await assert.rejects(run(tx,'read',id,0,other.id),e=>(e as {number:number}).number===51004);});
  await fixture(async tx=>{await assert.rejects(run(tx,'list',undefined,0,owner.id,randomUUID()),e=>(e as {number:number}).number===51003);});
  await fixture(async tx=>{await assert.rejects(run(tx,'list',undefined,0,randomUUID()),e=>(e as {number:number}).number===51003);});
  await assert.rejects(pool.request().query('SELECT TOP 1 * FROM dbo.AiConversation'),e=>(e as {number:number}).number===229);
 });
 assert.deepEqual(await store.list(owner.id),before);assert.equal((await access.snapshot()).revision,state.revision);
 console.log('Live conversation SQL passed: runtime isolation, own history, two-chat retention, CAS, deletion and denied direct tables. Fixtures rolled back.');
}finally{await closeRuntimeDatabase();}
