import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {learningChange,type LearningStore} from '../src/modules/learning/learning.js';
import {AccessError} from '../src/shared/errors.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {createApp} from '../src/create-app.js';
const draft=()=>({action:'CREATE',id:randomUUID(),revision:0,title:'Goal',goal:'Learn by doing',timezone:'Asia/Kolkata',dailyMinutes:30,targetDate:'2026-10-06',tasks:[{id:randomUUID(),title:'Practice',plannedDate:'2026-10-03',estimatedMinutes:30}]});
test('learning accepts optional catalogue mapping but never a client supplied skill name',()=>{
 const skillId=randomUUID();const result=learningChange({...draft(),focus:'Cloud',skillId});
 assert.equal(result.action,'CREATE');if(result.action==='CREATE'){assert.equal(result.skillId,skillId);assert.equal(result.focus,'Cloud');}
 for(const extra of [{focus:'Unknown'},{skillId:'invalid'},{skillName:'Forged skill'}])assert.throws(()=>learningChange({...draft(),...extra}));
});
test('learning validates dates, capacity, identity fields and completion provenance',()=>{
 const good=draft();assert.equal(learningChange(good).action,'CREATE');
 for(const extra of [{personId:randomUUID()},{status:'ACTIVE'},{revision:1},{timezone:'bad/zone'},{dailyMinutes:29},{targetDate:'2026-99-99'},{targetDate:'2026-02-30'},{tasks:[{...good.tasks[0],completedAt:'2026-10-03'}]},{tasks:[good.tasks[0],{...good.tasks[0],id:randomUUID()}]}])assert.throws(()=>learningChange({...good,...extra}),e=>e instanceof AccessError&&e.status===400);
 assert.throws(()=>learningChange({action:'LOG',id:good.id,revision:1,taskId:good.tasks[0].id,actualMinutes:0}));
 assert.throws(()=>learningChange({action:'LOG',id:good.id,revision:1,taskId:good.tasks[0].id,actualMinutes:10,completedAt:'2026-10-03'}));
});
test('learning HTTP binds current identity and rejects revoked editing before storage',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),person=state.people[0];person.overrides.push({permission:'learning.view',scope:'OWN',effect:'ALLOW'},{permission:'learning.manage',scope:'OWN',effect:'ALLOW'});access.snapshot=()=>structuredClone(state);
 const actors:string[]=[];let saves=0;
 const learning:LearningStore={read:async actor=>{actors.push(actor);return {plans:[],canManage:true};},change:async actor=>{actors.push(actor);saves++;}};
 const server=createApp({verify:async header=>{if(header!=='Bearer trusted')throw Error();return {tenantId:'tenant',objectId:'member'};},profile:async()=>undefined,access,resolveAccess:async()=>person.id,learning}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/learning`,headers={Authorization:'Bearer trusted','Content-Type':'application/json'};
 try{assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers})).status,200);assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(draft())})).status,200);assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...draft(),personId:randomUUID()})})).status,400);assert.equal(saves,1);assert.ok(actors.every(actor=>actor===person.id));person.overrides.push({permission:'learning.manage',scope:'OWN',effect:'DENY'});assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(draft())})).status,403);assert.equal(saves,1);assert.equal((await fetch(url,{headers})).status,200);person.overrides.push({permission:'learning.view',scope:'OWN',effect:'DENY'});assert.equal((await fetch(url,{headers})).status,403);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
