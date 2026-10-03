import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { claimChange, claimPage, claimSearch, type ClaimsStore } from '../src/modules/skills/claims.js';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';

const draft=()=>({id:randomUUID(),revision:0,skillId:randomUUID(),definitionRevision:1,rank:1,experienceMonths:12,description:'Delivered a working feature.'});
test('draft validation rejects fabricated owners, verification, invalid levels, versions and experience',()=>{
  const valid=draft();assert.equal(claimChange(valid).description,valid.description);
  for(const fields of [{personId:randomUUID()},{status:'VERIFIED'},{reviewerId:randomUUID()},{experienceMonths:1.5},{experienceMonths:601},{rank:0},{definitionRevision:0},{revision:-1},{description:' '},{description:'x'.repeat(2001)}])assert.throws(()=>claimChange({...valid,...fields}));
  assert.equal(claimPage(undefined),1);assert.throws(()=>claimPage(['1','2']));assert.throws(()=>claimPage(0));assert.throws(()=>claimSearch({toString:()=>''}));
});

test('own-skills HTTP binds actor to identity and denies revoked or fabricated permissions before persistence',async()=>{
  const access=await LocalAccessStore.open(),id=access.snapshot().people[0].id;
  const state=access.snapshot();state.people[0].overrides.push({permission:'skill.claim',scope:'OWN',effect:'ALLOW'},{permission:'skill.view',scope:'ORGANIZATION',effect:'ALLOW'});access.snapshot=()=>structuredClone(state);
  const actors:string[]=[];let options=0,saves=0;
  const claims:ClaimsStore={read:async actor=>{actors.push(actor);return {claims:[],page:1,pageSize:25,total:0,canClaim:true};},options:async actor=>{actors.push(actor);options++;return {skills:[],total:0,page:1,pageSize:25};},save:async actor=>{actors.push(actor);saves++;}};
  const server=createApp({verify:async header=>{if(header!=='Bearer trusted')throw Error();return {tenantId:'tenant',objectId:'member'};},profile:async()=>undefined,access,resolveAccess:async()=>id,claims}).listen(0,'127.0.0.1');
  await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/my-skills`,headers={Authorization:'Bearer trusted','Content-Type':'application/json'};
  try{
    assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers})).status,200);
    assert.equal((await fetch(url+'/catalogue',{headers})).status,200);
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(draft())})).status,200);
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...draft(),actorId:randomUUID()})})).status,400);assert.equal(saves,1);
    assert.ok(actors.every(actor=>actor===id));
    state.people[0].overrides.push({permission:'skill.claim',scope:'OWN',effect:'DENY'});
    assert.equal((await fetch(url+'/catalogue',{headers})).status,403);assert.equal(options,1);
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(draft())})).status,403);assert.equal(saves,1);
    assert.equal((await fetch(url,{headers})).status,200); // Revoked editing does not remove own profile reads.
    state.people[0].overrides.push({permission:'profile.view',scope:'OWN',effect:'DENY'});
    assert.equal((await fetch(url,{headers})).status,403);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
