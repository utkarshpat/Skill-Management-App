import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {claimChange,claimTransition,type ClaimsStore} from '../src/modules/skills/claims.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {createApp} from '../src/create-app.js';
import {ToolRegistry} from '../src/modules/ai/tool-registry.js';

test('review actions reject forged routing, invalid state selectors and missing feedback',()=>{
 const change={id:randomUUID(),revision:2,action:'APPROVE',feedback:'Confirmed project evidence.'};
 assert.equal(claimTransition(change).action,'APPROVE');
 for(const invalid of [{reviewerId:randomUUID()},{actorId:randomUUID()},{status:'APPROVED'},{revision:0},{action:'DELETE'},{feedback:' '},{feedback:'x'.repeat(2001)}])assert.throws(()=>claimTransition({...change,...invalid}));
 assert.equal(claimTransition({...change,action:'SUBMIT',feedback:undefined}).feedback,'');
 assert.equal(claimChange({id:randomUUID(),skillId:randomUUID(),revision:0,definitionRevision:1,rank:1,experienceMonths:1,description:'Experience',projects:' Project ',evidence:' Certificate '}).projects,'Project');
});
test('assigned review AI tool stays actor-bound and disappears on permission revocation',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),person=state.people[0];access.snapshot=()=>structuredClone(state);
 person.hasDirectReports=true;person.overrides.push({permission:'profile.view',scope:'OWN',effect:'ALLOW'},{permission:'skill.verify',scope:'ORGANIZATION',effect:'ALLOW'});
 let actor='';const claims:ClaimsStore={read:async()=>({claims:[],total:0,page:1,pageSize:25,canClaim:false}),options:async()=>({skills:[],total:0,page:1,pageSize:25}),save:async()=>{},reviews:async id=>{actor=id;return {claims:[],total:0,page:1,pageSize:25,canClaim:false};}};
 const registry=new ToolRegistry(access,undefined,claims),signal=AbortSignal.timeout(5000);
 await registry.execute(person.id,'assigned_skill_reviews',{},signal);assert.equal(actor,person.id);
 await assert.rejects(registry.execute(person.id,'assigned_skill_reviews',{reviewerId:randomUUID()},signal));
 person.overrides.push({permission:'skill.verify',scope:'ORGANIZATION',effect:'DENY'});
 assert.ok(!registry.available(state,person).some(tool=>tool.function.name==='assigned_skill_reviews'));
 await assert.rejects(registry.execute(person.id,'assigned_skill_reviews',{},signal));
});
test('review HTTP uses verified actor, independent review permission and strict decision endpoints',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),person=state.people[0];
 person.overrides.push({permission:'profile.view',scope:'OWN',effect:'ALLOW'},{permission:'skill.claim',scope:'OWN',effect:'ALLOW'},{permission:'skill.view',scope:'ORGANIZATION',effect:'ALLOW'});access.snapshot=()=>structuredClone(state);
 const actors:string[]=[];const claims:ClaimsStore={read:async()=>({claims:[],total:0,page:1,pageSize:25,canClaim:true}),options:async()=>({skills:[],total:0,page:1,pageSize:25}),save:async()=>{},reviews:async actor=>{actors.push(actor);return {claims:[],total:0,page:1,pageSize:25,canClaim:false};},transition:async actor=>{actors.push(actor);}};
 const server=createApp({verify:async header=>{if(header!=='Bearer trusted')throw Error();return {tenantId:'tenant',objectId:'actor'};},resolveAccess:async()=>person.id,profile:async()=>undefined,access,claims}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`,headers={Authorization:'Bearer trusted','Content-Type':'application/json'},change={id:randomUUID(),revision:1,action:'SUBMIT'};
 try{
  assert.equal((await fetch(base+'/api/skill-reviews')).status,401);
  assert.equal((await fetch(base+'/api/skill-reviews',{headers})).status,403);
  assert.equal((await fetch(base+'/api/my-skills/submit',{method:'POST',headers,body:JSON.stringify(change)})).status,200);
  person.hasDirectReports=true;person.overrides.push({permission:'skill.verify',scope:'ORGANIZATION',effect:'ALLOW'});
  assert.equal((await fetch(base+'/api/skill-reviews',{headers})).status,200);
  assert.equal((await fetch(base+'/api/skill-reviews/decision',{method:'POST',headers,body:JSON.stringify(change)})).status,400);
  assert.equal((await fetch(base+'/api/skill-reviews/decision',{method:'POST',headers,body:JSON.stringify({...change,action:'APPROVE',feedback:'Reviewed.'})})).status,200);
  person.overrides.push({permission:'skill.verify',scope:'ORGANIZATION',effect:'DENY'});
  assert.equal((await fetch(base+'/api/skill-reviews',{headers})).status,403);
  assert.ok(actors.every(actor=>actor===person.id));assert.equal(actors.length,3);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
