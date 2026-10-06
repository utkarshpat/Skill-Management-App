import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LearningPlanCreateAttempt} from '../src/learning-plan-create';
const draft={title:'Azure',goal:'Deploy an API',steps:['Read','Build'],dailyMinutes:30,startDate:'2026-10-07'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
test('lost successful write response is reconciled without a duplicate create',async()=>{
 const attempt=new LearningPlanCreateAttempt();let saved='',writes=0;
 const result=await attempt.save(draft,'Asia/Calcutta',async(_url,init)=>{
  if(init?.method==='POST'){writes++;saved=JSON.parse(String(init.body)).id;throw Error('Lost response');}
  return json({plans:[{id:saved}]});
 });
 assert.equal(result.id,saved);assert.equal(writes,1);assert.equal(result.tasks[1].plannedDate,'2026-10-08');
});
test('uncertain retries recheck before writing and preserve plan and task IDs',async()=>{
 const attempt=new LearningPlanCreateAttempt(),bodies:string[]=[];let phase=0;
 const fetcher=async(_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){bodies.push(String(init.body));if(phase===0)throw Error('Disconnected');return json({});}
  if(phase===0)throw Error('Read unavailable');return json({plans:[]});
 };
 await assert.rejects(attempt.save(draft,'Asia/Calcutta',fetcher),/could not be confirmed/);
 await assert.rejects(attempt.save(draft,'Asia/Calcutta',fetcher),/Read unavailable/);
 assert.equal(bodies.length,1);phase=1;await attempt.save(draft,'Asia/Calcutta',fetcher);
 assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
});
test('retry finds previously saved plan without another write',async()=>{
 const attempt=new LearningPlanCreateAttempt();let id='',writes=0,readable=false;
 const fetcher=async(_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){writes++;id=JSON.parse(String(init.body)).id;throw Error('Lost response');}
  if(!readable)throw Error('Disconnected');return json({plans:[{id}]});
 };
 await assert.rejects(attempt.save(draft,'Asia/Calcutta',fetcher));readable=true;
 assert.equal((await attempt.save(draft,'Asia/Calcutta',fetcher)).id,id);assert.equal(writes,1);
});
test('permission rejection cannot be presented as a successful create',async()=>{
 let calls=0;await assert.rejects(new LearningPlanCreateAttempt().save(draft,'Asia/Calcutta',async()=>{calls++;return json({error:{message:'Denied'}},403);}),/Denied/);assert.equal(calls,1);
});
test('changing an uncertain confirmation cannot generate a fresh identity',async()=>{
 const attempt=new LearningPlanCreateAttempt();let calls=0;
 const fetcher=async()=>{calls++;throw Error('Offline');};
 await assert.rejects(attempt.save(draft,'Asia/Calcutta',fetcher));const previous=calls;
 await assert.rejects(attempt.save({...draft,title:'Another'},'Asia/Calcutta',fetcher),/original confirmation/);assert.equal(calls,previous);
});
test('invalid partial draft never makes a create request',async()=>{
 await assert.rejects(new LearningPlanCreateAttempt().save({title:'',tasks:[],startDate:'2026-10-07'},'Asia/Calcutta',async()=>{throw Error('Should never request');}),/Review the plan/);
});
test('simultaneous confirmations share one in-flight write',async()=>{
 const attempt=new LearningPlanCreateAttempt();let writes=0,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const fetcher=async()=>{writes++;await gate;return json({saved:true});};
 const first=attempt.save(draft,'Asia/Calcutta',fetcher),second=attempt.save(draft,'Asia/Calcutta',fetcher);
 release();assert.equal((await first).id,(await second).id);assert.equal(writes,1);
});
