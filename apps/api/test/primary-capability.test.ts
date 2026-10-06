import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {LocalAccessStore,type AccessStore} from '../src/modules/access/local-access-store.js';
import {primaryCapabilityDetails,primaryCapabilityQuery,validatePrimaryCapabilityChange} from '../src/modules/access/primary-capability.js';
import {previewAccessChange,recheckAccessChange} from '../src/modules/access/access-preview.js';
import {profileCompleteness} from '../src/modules/identity/profile-completeness.js';
import type {Profile} from '../src/modules/identity/profile.js';
import {createApp} from '../src/create-app.js';
import {ToolRegistry} from '../src/modules/ai/tool-registry.js';
const id='11111111-1111-4111-8111-111111111111';
const selected={primaryCapabilityId:id,primaryCapabilityName:'Cloud',primaryCapabilityStatus:'ARCHIVED' as const};
test('primary capability normalization preserves omitted/historical values, clears explicitly and never trusts display metadata',()=>{
 assert.deepEqual(primaryCapabilityDetails({},selected),selected);
 assert.deepEqual(primaryCapabilityDetails({...selected,primaryCapabilityName:'Forged',primaryCapabilityStatus:'PUBLISHED'},selected),selected);
 assert.deepEqual(primaryCapabilityDetails({primaryCapabilityId:null},selected),{primaryCapabilityId:null,primaryCapabilityName:null,primaryCapabilityStatus:null});
 assert.equal(primaryCapabilityDetails({primaryCapabilityId:id.toUpperCase()}).primaryCapabilityId,id);
 for(const value of [123,[],{},id+'suffix','unpublished free text'])assert.throws(()=>primaryCapabilityDetails({primaryCapabilityId:value}),/valid capability/);
 for(const query of [{actorId:id},{search:[]},{search:'x'.repeat(101)},{page:0},{page:100001},{page:1.5},{page:['2']},{page:true},{page:'2e1'}])assert.throws(()=>primaryCapabilityQuery(query));
 assert.deepEqual(primaryCapabilityQuery({search:' Cloud ',page:'2'}),{search:'Cloud',page:2});
});
test('new selections require published workspace catalogue validation, while unchanged archived selections survive unrelated edits',async()=>{
 const local=await LocalAccessStore.open(),state=local.snapshot(),actor=state.people[0];
 const body={...actor,kind:'person',revision:state.revision,primaryCapabilityId:id};
 let calls=0;
 const store:AccessStore={snapshot:()=>state,person:()=>actor,save:local.save.bind(local),primaryCapabilities:async(actorId,query)=>{
  calls++;assert.equal(actorId,actor.id);assert.equal(query.id,id);return {items:[{id,name:'Cloud',category:'Engineering',status:'PUBLISHED'}],total:1,page:1,pageSize:20};
 }};
 const details=await validatePrimaryCapabilityChange(store,state,actor.id,body);
 assert.equal(details?.primaryCapabilityName,'Cloud');assert.equal(calls,1);
 await assert.rejects(validatePrimaryCapabilityChange(local,state,actor.id,body),error=>(error as {status:number}).status===503);
 const historical=structuredClone(state);Object.assign(historical.people[0],selected);
 assert.deepEqual(await validatePrimaryCapabilityChange(local,historical,actor.id,{...body,jobTitle:'Lead'}),selected);
 const denied=structuredClone(state);denied.people[0].overrides.push({permission:'users.manage',scope:'ORGANIZATION',effect:'DENY'});
 await assert.rejects(validatePrimaryCapabilityChange(store,denied,actor.id,body),error=>(error as {status:number}).status===403);
 assert.equal(calls,1);
 const unpublished:AccessStore={...store,primaryCapabilities:async()=>({items:[],total:0,page:1,pageSize:20})};
 await assert.rejects(validatePrimaryCapabilityChange(unpublished,state,actor.id,body),/currently published/);
});
test('primary capability preview binds the exact selection without changing effective decisions or persisting a preview',async()=>{
 const store=await LocalAccessStore.open(),state=store.snapshot(),actor=state.people[0],body={...actor,kind:'person',revision:state.revision,primaryCapabilityId:id};
 const preview=await previewAccessChange(state,actor.id,body);
 assert.deepEqual(store.snapshot(),state);assert.equal(preview.impacts[0].changes.length,0);
 await assert.rejects(recheckAccessChange(state,actor.id,{...body,primaryCapabilityId:null,previewReceipt:preview.receipt}),/Preview/);
});
const complete:Profile={id:'own',displayName:'Employee',employeeCode:'EMP',jobTitle:'Engineer',grade:'G4',organization:'Workspace',status:'ACTIVE',roles:[],
 primaryCapabilityId:id,primaryCapabilityName:'Cloud',primaryCapabilityStatus:'PUBLISHED',
 organizationDetails:{workspace:'Workspace',placementStatus:'ASSIGNED',deliveryUnit:'Unit',department:'Engineering',team:null,managerStatus:'NOT_ASSIGNED',managerName:null}};
test('canonical completeness has exactly six work fields, excludes manager/access and flags historical or unavailable information',()=>{
 const result=profileCompleteness(complete);
 assert.equal(result.total,6);assert.equal(result.filled,6);assert.equal(result.status,'COMPLETE');
 assert.deepEqual(result.items.map(item=>item.key),['name','employeeCode','jobTitle','grade','department','primaryCapability']);
 const missing=profileCompleteness({...complete,grade:null,jobTitle:' ',primaryCapabilityStatus:'ARCHIVED'});
 assert.equal(missing.filled,3);assert.equal(missing.status,'INCOMPLETE');
 assert.equal(missing.items.find(item=>item.key==='primaryCapability')?.state,'NEEDS_ATTENTION');
 assert.equal(profileCompleteness({...complete,organizationDetails:{...complete.organizationDetails!,placementStatus:'NEEDS_ATTENTION'}}).filled,5);
 const unknown=profileCompleteness({...complete,primaryCapabilityId:undefined,organizationDetails:undefined});
 assert.equal(unknown.status,'UNAVAILABLE');assert.equal(unknown.filled,4);
 assert.equal(profileCompleteness({...complete,roles:['Super Admin'],jobTitle:null}).filled,5);
});
test('AI own-profile read exposes only actor-bound descriptive selection and cannot infer a completeness score',async()=>{
 const local=await LocalAccessStore.open(),state=local.snapshot(),actor=state.people[0];
 Object.assign(actor,selected,{jobTitle:'Engineer',grade:'G4'});
 const store=LocalAccessStore.fromState(state),registry=new ToolRegistry(store);
 const result=await registry.execute(actor.id,'own_profile',{},new AbortController().signal);
 assert.ok('primaryCapabilityId' in result.data);assert.equal(result.data.primaryCapabilityId,id);
 assert.ok('primaryCapabilityStatus' in result.data);assert.equal(result.data.primaryCapabilityStatus,'ARCHIVED');
 assert.equal(result.source.url,'/profile');assert.doesNotMatch(JSON.stringify(result.data),/"completeness"|"filled"/);
 await assert.rejects(registry.execute(actor.id,'own_profile',{personId:id},new AbortController().signal),/another person/);
});
test('own profile completeness is server-derived and person administration rejects forged selectors or unsupported local selections',async()=>{
 const store=await LocalAccessStore.open(),actor=store.snapshot().people[0];
 const server=createApp(undefined,{developmentStore:store}).listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 try{
  const login=await fetch(base+'/api/dev-login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({personId:actor.id})});
  const cookie=login.headers.get('set-cookie')!.split(';')[0],headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'};
  const response=await fetch(base+'/api/me?personId='+id+'&filled=6',{headers}),profile=(await response.json()).profile;
  assert.equal(profile.id,actor.id);assert.equal(profile.completeness.total,6);assert.notEqual(profile.completeness.status,'COMPLETE');
  assert.equal((await fetch(base+'/api/dev-access/primary-capabilities?actorId='+id,{headers})).status,400);
  assert.equal((await fetch(base+'/api/dev-access/primary-capabilities',{headers})).status,503);
  const body={...actor,kind:'person',revision:1,primaryCapabilityId:id};
  const preview=await fetch(base+'/api/dev-access/preview',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(preview.status,503);assert.equal(store.snapshot().revision,1);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test('migration preserves authoritative access checks, scope constraints and atomic descriptive audit',async()=>{
 const source=await readFile(new URL('../../../database/migrations/052_primary_capability.sql',import.meta.url),'utf8');
 for(const gate of ['AccessRuntimeAccount',"'permissions.manage'","'users.manage'",'UPDLOCK,HOLDLOCK','@revision<>@expected_revision','AccessReportingValid','INSERT dbo.AccessAudit','ROLLBACK TRANSACTION','at least one active access administrator','AccessImplementedScope'])assert.ok(source.includes(gate),gate);
 assert.match(source,/FOREIGN KEY\(account_id,primary_capability_id\) REFERENCES dbo\.SkillCatalogue\(account_id,skill_id\)/);
 assert.match(source,/@capability<>@previous_capability/);assert.match(source,/status='PUBLISHED'\) THROW 51010/);
 assert.match(source,/DATALENGTH\(\[value\]\)<>72/);assert.match(source,/HAVING COUNT\(\*\)>1/);
 assert.match(source,/OFFSET \(@page-1\)\*20 ROWS FETCH NEXT 20 ROWS ONLY/);
 assert.doesNotMatch(source,/CREATE OR ALTER FUNCTION|INSERT dbo\.AccessImplementedScope|UPDATE dbo\.SkillClaimDraft/);
});
