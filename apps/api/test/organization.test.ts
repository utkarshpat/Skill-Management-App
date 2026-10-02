import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { organizationChange, reportingChain, type OrganizationState } from '../src/organization.js';
import { createApp } from '../src/app.js';
import { LocalAccessStore } from '../src/local-access-store.js';

const first='10000000-0000-4000-8000-000000000001';
const second='10000000-0000-4000-8000-000000000002';
const third='10000000-0000-4000-8000-000000000003';
const state=():OrganizationState=>({revision:1,nodes:[],people:[first,second,third].map((id,index)=>({id,displayName:`Person ${index}`,employeeCode:String(index),active:true})),assignments:[{personId:first,teamId:null,managerId:second},{personId:second,teamId:null,managerId:third}]});

test('reporting levels follow people edges and fail closed on broken, inactive or circular chains',()=>{
  const source=state();assert.deepEqual(reportingChain(source,first).map(person=>person.id),[second,third]);
  assert.deepEqual(reportingChain(source,third),[]);
  source.assignments.push({personId:third,teamId:null,managerId:first});assert.throws(()=>reportingChain(source,first),/attention/);
  const inactive=state();inactive.people[1].active=false;assert.throws(()=>reportingChain(inactive,first),/attention/);
  const missing=state();missing.people.pop();assert.throws(()=>reportingChain(missing,first),/attention/);
  const ambiguous=state();ambiguous.assignments.push({...ambiguous.assignments[0]});assert.throws(()=>reportingChain(ambiguous,first),/Ambiguous/);
});

test('organization input rejects missing parents, arbitrary IDs and untrusted hierarchy fields',()=>{
  assert.throws(()=>organizationChange({kind:'node',type:'TEAM',name:'Team',active:true,revision:1}),/parent/);
  assert.throws(()=>organizationChange({kind:'assignment',personId:'outside',revision:1}),/valid/);
  assert.throws(()=>organizationChange({kind:'node',type:'DELIVERY_UNIT',name:'Unit',active:true,revision:1,parentId:first}),/parent/);
  const change=organizationChange({kind:'assignment',personId:first,teamId:null,managerId:second,revision:1,actorId:third,role:'Super Admin',reportingLevel:200});
  assert.deepEqual(change.payload,{teamId:null,managerId:second});assert.equal(change.targetId,first);
});

test('organization endpoints bind actor to Microsoft identity and require current people administration',async()=>{
  const store=await LocalAccessStore.open();const admin=store.snapshot().people[0].id;
  let calls=0;let actor='';
  const server=createApp({verify:async header=>{if(header!=='Bearer owner')throw new Error();return {tenantId:'tenant',objectId:'owner'};},profile:async()=>undefined,access:store,resolveAccess:async()=>admin,organization:{snapshot:async()=>state(),save:async id=>{calls++;actor=id;}}}).listen(0,'127.0.0.1');
  await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/access/organization`;
  try {
    assert.equal((await fetch(url)).status,401);
    const headers={Authorization:'Bearer owner','Content-Type':'application/json'};
    assert.equal((await fetch(url,{headers})).status,200);
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({actorId:'attacker'})})).status,200);assert.equal(actor,admin);
    const denied=store.snapshot();denied.people[0].overrides.push({permission:'users.manage',scope:'ORGANIZATION',effect:'DENY'});store.snapshot=()=>structuredClone(denied);
    assert.equal((await fetch(url,{method:'POST',headers,body:'{}'})).status,403);assert.equal(calls,1);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
