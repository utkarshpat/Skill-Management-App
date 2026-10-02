import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { catalogueChange, catalogueQuery } from '../src/skill-catalogue.js';
import { createApp } from '../src/app.js';
import { LocalAccessStore } from '../src/local-access-store.js';

const input=()=>({revision:1,name:'  SQL   Server ',category:' Databases ',description:'Query relational data safely.',status:'PUBLISHED',levels:[{rank:1,name:'Foundation',description:'Read and explain a simple query.'},{rank:2,name:'Practitioner',description:'Write and tune queries independently.'}]});
test('catalogue validates publication criteria, sequential unique levels, bounded filters and trusted fields',()=>{
 const change=catalogueChange({...input(),actorId:'attacker',accountId:'other'});
 assert.equal(change.payload.name,'SQL Server');assert.equal(change.payload.category,'Databases');assert.equal('actorId' in change,false);assert.equal('accountId' in change.payload,false);
 assert.equal(catalogueChange({...input(),status:'DRAFT',description:'',levels:[{rank:1,name:'Foundation',description:''}]}).payload.description,'');
 assert.throws(()=>catalogueChange({...input(),description:''}),/required/);
 assert.throws(()=>catalogueChange({...input(),levels:[{rank:1,name:'Foundation',description:''}]}),/required/);
 assert.throws(()=>catalogueChange({...input(),levels:[{rank:2,name:'Level',description:'Criteria'}]}),/sequential/);
 assert.throws(()=>catalogueChange({...input(),levels:[{rank:1,name:'Level',description:'Criteria'},{rank:2,name:'LEVEL',description:'Criteria'}]}),/unique/);
 assert.throws(()=>catalogueChange({...input(),levels:[]}),/one and eight/);
 assert.throws(()=>catalogueChange({...input(),levels:Array.from({length:9},(_,i)=>({rank:i+1,name:String(i),description:'Criteria'}))}),/one and eight/);
 assert.throws(()=>catalogueChange({...input(),revision:0}),/Reload/);
 assert.throws(()=>catalogueChange({...input(),id:'outside'}),/valid skill/);
 assert.throws(()=>catalogueQuery({page:'1.5'}),/valid/);assert.throws(()=>catalogueQuery({status:'DELETED'}),/valid/);
 assert.throws(()=>catalogueQuery({search:'x'.repeat(101)}),/lengths/);
 assert.deepEqual(catalogueQuery({search:' C++ [%] ',page:'2'}),{search:'C++ [%]',status:'',page:2});
});

test('catalogue HTTP binds Microsoft actor, checks independent permissions and rejects revoked, own-only and forged access',async()=>{
 const access=await LocalAccessStore.open();let current=access.snapshot();const actor=current.people[0].id;
 current.people[0].overrides.push({permission:'skill.view',scope:'ORGANIZATION',effect:'ALLOW'});access.snapshot=()=>structuredClone(current);
 let reads=0,saves=0,savedActor='',outage=false;
 const server=createApp({verify:async header=>{if(header!=='Bearer trusted')throw Error();return {tenantId:'tenant',objectId:'owner'};},profile:async()=>undefined,access,resolveAccess:async()=>{if(outage)throw Error('SQL connection secret');return actor;},catalogue:{read:async(id,query)=>{assert.equal(id,actor);reads++;return {revision:1,canManage:false,total:0,page:query.page,pageSize:25,skills:[]};},save:async id=>{savedActor=id;saves++;}}}).listen(0,'127.0.0.1');
 await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/skills`,headers={Authorization:'Bearer trusted','Content-Type':'application/json'};
 try{
  assert.equal((await fetch(url)).status,401);assert.equal(reads,0);
  const read=await fetch(url,{headers});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(input())})).status,403);assert.equal(saves,0);
  // Admin role labels and permission administration do not imply taxonomy authority.
  current.people[0].overrides.push({permission:'skill.catalogue.manage',scope:'OWN',effect:'ALLOW'});
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(input())})).status,403);
  current.people[0].overrides.push({permission:'skill.catalogue.manage',scope:'ORGANIZATION',effect:'ALLOW'});
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...input(),actorId:'attacker',accountId:'other'})})).status,200);assert.equal(savedActor,actor);
  current.people[0].overrides.push({permission:'skill.catalogue.manage',scope:'ORGANIZATION',effect:'DENY'});
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(input())})).status,403);assert.equal(saves,1);
  current.people[0].overrides.push({permission:'skill.view',scope:'ORGANIZATION',effect:'DENY'});
  assert.equal((await fetch(url,{headers})).status,403);
  current.people[0].active=false;assert.equal((await fetch(url,{headers})).status,403);
  outage=true;const failed=await fetch(url,{headers});assert.equal(failed.status,500);assert.ok(!(await failed.text()).includes('SQL connection secret'));
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
