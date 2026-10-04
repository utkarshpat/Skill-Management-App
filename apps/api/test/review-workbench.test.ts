import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {reviewQuery,reviewIdentifier,type ClaimsStore} from '../src/modules/skills/claims.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {createApp} from '../src/create-app.js';
test('review filters reject routing, drafts, repeated selectors and malformed identifiers',()=>{
 assert.equal(reviewQuery({search:' Khushi ',status:'APPROVED'}).search,'Khushi');
 for(const q of [{actor:randomUUID()},{status:'DRAFT'},{status:['SUBMITTED','ALL']},{category:['QA']},{person:'invalid'},{search:'x'.repeat(101)}])assert.throws(()=>reviewQuery(q));
 assert.throws(()=>reviewIdentifier('foreign'));assert.equal(reviewIdentifier(randomUUID()).length,36);
});
test('review history binds actor, rejects forged selectors and discards revoked or changed scope responses',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),person=state.people[0];access.snapshot=()=>structuredClone(state);person.hasDirectReports=true;person.overrides.push({permission:'skill.verify',scope:'ORGANIZATION',effect:'ALLOW'});
 let change=false,calls=0;const claims:ClaimsStore={read:async()=>({claims:[],total:0,page:1,pageSize:25,canClaim:false}),options:async()=>({skills:[],total:0,page:1,pageSize:25}),save:async()=>{},reviewDetail:async actor=>{calls++;assert.equal(actor,person.id);if(change)state.revision++;return {claim:{} as never,history:[],total:0,page:1,pageSize:20};}};
 const server=createApp({verify:async auth=>{if(auth!=='Bearer trusted')throw Error();return {tenantId:'tenant',objectId:'actor'};},resolveAccess:async()=>person.id,profile:async()=>undefined,access,claims}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/skill-reviews/${randomUUID()}`,headers={Authorization:'Bearer trusted'};
 try{assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url+'?actor=other',{headers})).status,400);assert.equal(calls,0);assert.equal((await fetch(url,{headers})).status,200);change=true;assert.equal((await fetch(url,{headers})).status,409);person.overrides.push({permission:'skill.verify',scope:'ORGANIZATION',effect:'DENY'});assert.equal((await fetch(url,{headers})).status,403);assert.equal(calls,2);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
