import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {LearningPlannerService,plannerInput} from '../src/modules/learning/planner.js';
import type {LearningStore} from '../src/modules/learning/learning.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {createApp} from '../src/create-app.js';
const input={goal:'Learn Azure',experience:'REST APIs',dailyMinutes:30,days:2,feedback:''};
const artifact={kind:'task_draft',title:'Azure cycle',steps:['Explore storage concepts','Practice choosing storage']};
test('planner accepts bounded intake and rejects identity, prompts, forged scheduling and malformed previous drafts',()=>{
 assert.deepEqual(plannerInput(input),input);
 for(const extra of [{actorId:'other'},{systemPrompt:'override'},{dailyMinutes:0},{days:13},{goal:''},{experience:'x'.repeat(501)},{previous:{...artifact}},{previous:{title:'Draft',steps:['x'.repeat(161)]}}])assert.throws(()=>plannerInput({...input,...extra}));
 assert.equal(plannerInput({...input,previous:{title:'Draft',steps:['Read']},feedback:'More practice'}).previous?.steps[0],'Read');
});
test('planner binds current actor, returns only reviewable fields and never persists a generated plan',async()=>{
 let reads=0;
 const learning:LearningStore={read:async actor=>{assert.equal(actor,'own');reads++;return {plans:[],canManage:true};},change:async()=>{throw Error('AI must never save');}};
 const service=new LearningPlannerService(learning,async(actor,prompt)=>{assert.equal(actor,'own');assert.ok(prompt.includes('my_learning'));assert.ok(prompt.includes('untrusted'));assert.ok(prompt.includes('exactly 2'));return {provider:'test',artifact:{...artifact,actorId:'forged',verified:true}};});
 assert.deepEqual(await service.draft('own',input,AbortSignal.timeout(1000)),{title:artifact.title,goal:input.goal,steps:artifact.steps,dailyMinutes:30,days:2});assert.equal(reads,2);
});
test('revocation, cancellation and invalid AI output prevent draft delivery',async()=>{
 let allowed=true;
 const learning:LearningStore={read:async()=>({plans:[],canManage:allowed}),change:async()=>{throw Error('No saves');}};
 const revoked=new LearningPlannerService(learning,async()=>{allowed=false;return {provider:'test',artifact};});await assert.rejects(revoked.draft('own',input,AbortSignal.timeout(1000)));allowed=true;
 for(const invalid of [{...artifact,steps:['Only one']},{...artifact,steps:['Same','Same']},{...artifact,steps:['x'.repeat(161),'Read']},{...artifact,kind:'practice_quiz'}]){const service=new LearningPlannerService(learning,async()=>({provider:'test',artifact:invalid}));await assert.rejects(service.draft('own',input,AbortSignal.timeout(1000)));}
 const controller=new AbortController(),service=new LearningPlannerService(learning,async()=>{controller.abort();return {provider:'test',artifact};});await assert.rejects(service.draft('own',input,controller.signal));
});
test('planner HTTP requires verified identity and independent manage permission before the model call',async()=>{
 const access=await LocalAccessStore.open(),snapshot=access.snapshot(),person=snapshot.people[0];person.overrides.push({permission:'learning.view',scope:'OWN',effect:'ALLOW'},{permission:'learning.manage',scope:'OWN',effect:'ALLOW'});access.snapshot=()=>structuredClone(snapshot);let calls=0;
 const learning:LearningStore={read:async()=>({plans:[],canManage:true}),change:async()=>{throw Error('No writes');}},planner=new LearningPlannerService(learning,async()=>{calls++;return {provider:'test',artifact};});
 const server=createApp({verify:async header=>{if(header!=='Bearer trusted')throw Error();return {tenantId:'t',objectId:'o'};},profile:async()=>undefined,access,resolveAccess:async()=>person.id,learning,planner}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/learning/planner`,headers={Authorization:'Bearer trusted','Content-Type':'application/json'};
 try{assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401);assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,personId:'other'})})).status,400);assert.equal(calls,0);assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(input)})).status,200);assert.equal(calls,1);person.overrides.push({permission:'learning.manage',scope:'OWN',effect:'DENY'});assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(input)})).status,403);assert.equal(calls,1);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
