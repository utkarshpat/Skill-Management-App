import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {effectiveAccessSummary} from '../src/modules/access/effective-access.js';
import {readActorAccess} from '../src/modules/access/actor-context.js';
import {auditQuery,localAuditPage,readAuditPage} from '../src/modules/access/audit.js';
import {createApp} from '../src/create-app.js';
import {once} from 'node:events';
test('actor projection preserves grants and resolved relationship decisions without roster/audit exposure',async()=>{
 const base=await LocalAccessStore.open(),state=base.snapshot(),actor=state.people[0];
 const report={...actor,id:'22222222-2222-4222-8222-222222222222',roleIds:[],overrides:[],employeeCode:'REPORT'};
 state.people.push(report);state.reporting=[{personId:report.id,managerId:actor.id}];
 const store=LocalAccessStore.fromState(state),compact=await readActorAccess(store,actor.id);
 assert.equal(compact.people.length,1);assert.equal(compact.reporting,undefined);assert.equal(compact.audit.length,0);
 assert.deepEqual(effectiveAccessSummary(compact,compact.people[0]),effectiveAccessSummary(state,actor));
 state.people[1].active=false;const inactive=LocalAccessStore.fromState(state).actorSnapshot(actor.id);assert.equal(inactive.people[0].hasDirectReports,false);
 assert.equal(await readActorAccess(store,undefined),undefined);
});
test('audit pages reject authority filters and use exclusive revision cursors with optional details',async()=>{
 for(const input of [{actor:'other'},{pageSize:'51'},{before:'0'},{before:['1']},{q:['a']},{details:['true']},{personId:'other'}])assert.throws(()=>auditQuery(input));
 const store=await LocalAccessStore.open(),state=store.snapshot(),actor=state.people[0];
 state.audit=Array.from({length:80},(_,i)=>({actorId:actor.id,targetId:actor.id,action:'person.updated',at:new Date().toISOString(),revision:i+1,after:actor}));
 const first=localAuditPage(state,actor.id,auditQuery({pageSize:'25'}));assert.equal(first.items.length,25);assert.equal(first.nextCursor,56);assert.equal(first.items[0].after,undefined);
 const next=localAuditPage(state,actor.id,auditQuery({before:'56',pageSize:'25',personId:actor.id,details:'true'}));assert.equal(next.items[0].revision,55);assert.deepEqual(next.items[0].after,actor);
 const access={...store,storage:'local-file' as const,snapshot:()=>state,person:()=>actor,save:store.save.bind(store),auditPage:async()=>first,actorSnapshot:()=>({...state,people:[{...actor,active:false}]})};
 await assert.rejects(readAuditPage(access,actor.id,auditQuery({})),/access changed/);
});
test('HTTP audit authenticates, bounds pages and does not attach full history to admin bootstrap',async()=>{
 const initial=await LocalAccessStore.open(),state=initial.snapshot(),actor=state.people[0];
 state.audit=Array.from({length:60},(_,i)=>({actorId:actor.id,targetId:actor.id,action:'person.updated',at:new Date().toISOString(),revision:i+1,after:actor}));
 const store=LocalAccessStore.fromState(state);
 const server=createApp(undefined,{developmentStore:store}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
 const base='http://127.0.0.1:'+address.port;
 const login=await fetch(base+'/api/dev-login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({personId:actor.id})});assert.equal(login.status,200);const headers={Cookie:login.headers.get('set-cookie')!.split(';')[0]};
 try {assert.equal((await fetch(base+'/api/dev-access/audit')).status,401);
  const bootstrap=await fetch(base+'/api/dev-access',{headers});assert.equal(bootstrap.status,200);assert.deepEqual((await bootstrap.json()).audit,[]);
  const response=await fetch(base+'/api/dev-access/audit',{headers});assert.equal(response.status,200);assert.equal((await response.json()).items.length,25);
  assert.equal((await fetch(base+'/api/dev-access/audit?actor=other',{headers})).status,400);
 }finally{server.close();}
});
