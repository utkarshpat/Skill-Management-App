import {test} from 'node:test';
import assert from 'node:assert/strict';
import {profileCompleteness} from '../src/modules/identity/profile-completeness.js';
import {employmentDetails} from '../src/modules/access/employment.js';
import type {Profile} from '../src/modules/identity/profile.js';
import {once} from 'node:events';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {createApp} from '../src/create-app.js';
const profile:Profile={id:'own',displayName:'Employee',employeeCode:'EMP',organization:'Company',status:'ACTIVE',roles:[],jobTitle:'Engineer',grade:'G4',primaryCapabilityId:'00000000-0000-4000-8000-000000000001',primaryCapabilityStatus:'PUBLISHED',organizationDetails:{workspace:'Company',placementStatus:'ASSIGNED',department:'Engineering',deliveryUnit:'Delivery',team:null,managerName:null,managerStatus:'NOT_ASSIGNED'}};
test('completeness counts six explicit work fields without treating manager, team or skill verification as mandatory',()=>{
 const result=profileCompleteness(profile);assert.equal(result.available,true);if(!result.available)return;
 assert.equal(result.completed,6);assert.equal(result.total,6);assert.equal(result.percent,100);
 const missing=profileCompleteness({...profile,grade:null,primaryCapabilityStatus:'ARCHIVED',organizationDetails:{...profile.organizationDetails!,placementStatus:'NEEDS_ATTENTION'}});
 assert.equal(missing.available,true);if(missing.available){assert.equal(missing.completed,3);assert.equal(missing.percent,50);assert.deepEqual(missing.fields.filter(f=>!f.complete).map(f=>f.key),['grade','primaryCapability','department']);}
});
test('incomplete projections do not invent zero completeness',()=>{
 assert.deepEqual(profileCompleteness({...profile,organizationDetails:undefined}),{available:false});
 assert.deepEqual(profileCompleteness({...profile,primaryCapabilityId:undefined}),{available:false});
});
test('primary references reject malformed identifiers, preserve omission and ignore forged catalogue metadata',()=>{
 for(const id of [42,{},'foreign','00000000-0000-4000-8000-000000000001suffix',''])assert.throws(()=>employmentDetails({primaryCapabilityId:id}),/valid primary/);
 const previous={primaryCapabilityId:profile.primaryCapabilityId};assert.equal(employmentDetails({},previous).primaryCapabilityId,profile.primaryCapabilityId);
 assert.equal(employmentDetails({primaryCapabilityId:null},previous).primaryCapabilityId,null);
 assert.equal(employmentDetails({primaryCapabilityId:profile.primaryCapabilityId,primaryCapabilityName:'forged',primaryCapabilityStatus:'PUBLISHED'}).primaryCapabilityName,undefined);
});
test('capability discovery binds the verified administrator, rejects scope injection and validates preview selection',async()=>{
 const store=await LocalAccessStore.open(),state=store.snapshot(),actor=state.people[0],id=profile.primaryCapabilityId!;
 const access=Object.assign(store,{primaryCapabilities:async(actorId:string,query:string,skillId?:string)=>{assert.equal(actorId,actor.id);assert.ok(query.length<=80);return !skillId||skillId===id?[{id,name:'Published skill',category:'Engineering'}]:[];}});
 const server=createApp({verify:async header=>{if(header!=='Bearer synthetic')throw Error();return {tenantId:'fixture',objectId:'fixture'};},resolveAccess:async()=>actor.id,access,profile:async()=>undefined}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}`,headers={Authorization:'Bearer synthetic','Content-Type':'application/json'};
 try{
  assert.equal((await fetch(url+'/api/access/primary-capabilities')).status,401);
  assert.equal((await fetch(url+'/api/access/primary-capabilities?q=a&q=b',{headers})).status,400);
  assert.equal((await fetch(url+'/api/access/primary-capabilities?scope=ORGANIZATION',{headers})).status,400);
  const result=await fetch(url+'/api/access/primary-capabilities',{headers});assert.equal(result.status,200);assert.equal((await result.json()).items[0].id,id);
  const body={...actor,kind:'person',revision:state.revision,primaryCapabilityId:'55555555-5555-4555-8555-555555555555'};
  assert.equal((await fetch(url+'/api/access/preview',{method:'POST',headers,body:JSON.stringify(body)})).status,400);
  assert.equal(store.snapshot().revision,state.revision);
 }finally{server.close();await once(server,'close');}
});
