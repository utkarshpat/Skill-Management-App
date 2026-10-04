import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AssistantService} from '../src/modules/ai/assistant.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import type {ClaimsStore,SkillClaim} from '../src/modules/skills/claims.js';

test('review AI restricts context, binds reviewer and never writes or trusts forged selectors',async()=>{
 const access=await LocalAccessStore.open(),s=access.snapshot(),actor=s.people[0];actor.hasDirectReports=true;actor.overrides.push({permission:'skill.verify',scope:'ORGANIZATION',effect:'ALLOW'});access.snapshot=()=>structuredClone(s);
 s.people.push({id:'report',displayName:'Report',employeeCode:'REP',active:true,roleIds:[],overrides:[]});s.reporting=[{personId:'report',managerId:actor.id}];
 const claim:SkillClaim={id:'bb123456-1234-1234-1234-123456789abc',revision:2,skillId:'skill',skillName:'Java',category:'Programming',definitionRevision:1,rank:3,levelName:'Intermediate',levelDescription:'Build and test services',experienceMonths:24,description:'Built a service',projects:'Project A',evidence:'A reference, not file contents',status:'SUBMITTED',updatedAt:'2026-10-04',reviewerId:actor.id,personId:'report'};
 let calls=0,change=false,revoke=false,foreign=false,invalid=false;
 const claims:ClaimsStore={read:async()=>{throw Error('No unrelated data');},options:async()=>{throw Error('No catalogue reads');},save:async()=>{throw Error('No writes');},transition:async()=>{throw Error('No decisions');},reviewDetail:async(who,id)=>{assert.equal(who,actor.id);assert.equal(id,claim.id);if(foreign)throw Error('Outside reviewer scope');return {claim:structuredClone(claim),history:[],total:0,page:1,pageSize:20};}};
 const service=new AssistantService(access,undefined,{name:'fixture',complete:async(messages,tools)=>{calls++;assert.equal(tools.length,1);assert.equal(tools[0].function.name,'present_output');assert.match(messages[0].content,/untrusted/);assert.match(messages[1].content,/Build and test services/);assert.doesNotMatch(messages[1].content,/history|actorId/);if(change)claim.revision++;if(revoke)actor.overrides.push({permission:'skill.verify',scope:'ORGANIZATION',effect:'DENY'});return {content:'',calls:[{id:'draft',type:'function',function:{name:'present_output',arguments:JSON.stringify({kind:invalid?'skill_draft':'task_draft',title:'Review',summary:'Proposed',body:'## Evidence\n\n- A service is described.\n\nAsk for test details.',steps:[],questions:[]})}}]};}},claims);
 const input={id:claim.id,revision:2,kind:'SUMMARY',notes:''};
 await assert.rejects(service.reviewAssistance(actor.id,{...input,actorId:'foreign'},AbortSignal.timeout(5000)));assert.equal(calls,0);
 await assert.rejects(service.reviewAssistance(actor.id,{...input,revision:1},AbortSignal.timeout(5000)),/Reload/);assert.equal(calls,0);
 foreign=true;await assert.rejects(service.reviewAssistance(actor.id,input,AbortSignal.timeout(5000)),/scope/);foreign=false;assert.equal(calls,0);
 claim.reviewerId='other';await assert.rejects(service.reviewAssistance(actor.id,input,AbortSignal.timeout(5000)),/not permitted/);assert.equal(calls,0);claim.reviewerId=actor.id;
 const summary=await service.reviewAssistance(actor.id,input,AbortSignal.timeout(5000));assert.equal(summary.kind,'SUMMARY');assert.equal(summary.revision,2);
 assert.equal((await service.reviewAssistance(actor.id,{...input,kind:'FEEDBACK',decision:'REQUEST_CHANGES'},AbortSignal.timeout(5000))).decision,'REQUEST_CHANGES');
 claim.status='APPROVED';await assert.rejects(service.reviewAssistance(actor.id,{...input,kind:'FEEDBACK',decision:'APPROVE'},AbortSignal.timeout(5000)),/Reload/);claim.status='SUBMITTED';
 invalid=true;await assert.rejects(service.reviewAssistance(actor.id,input,AbortSignal.timeout(5000)),/invalid/);invalid=false;
 change=true;await assert.rejects(service.reviewAssistance(actor.id,input,AbortSignal.timeout(5000)),/changed/);change=false;claim.revision=2;
 revoke=true;await assert.rejects(service.reviewAssistance(actor.id,input,AbortSignal.timeout(5000)),/permitted/);const before=calls;await assert.rejects(service.reviewAssistance(actor.id,input,AbortSignal.timeout(5000)),/permitted/);assert.equal(calls,before);
});
