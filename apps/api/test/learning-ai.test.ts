import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {ToolRegistry} from '../src/modules/ai/tool-registry.js';
test('learning AI tool is actor-bound, compact, read-only and rechecks revoked authority',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),person=state.people[0];person.overrides.push({permission:'profile.view',scope:'OWN',effect:'ALLOW'},{permission:'learning.view',scope:'OWN',effect:'ALLOW'});access.snapshot=()=>structuredClone(state);let reads=0;
 const registry=new ToolRegistry(access,undefined,undefined,undefined,{read:async actor=>{assert.equal(actor,person.id);reads++;return {plans:[],canManage:false};},change:async()=>{throw Error('No AI writes');}}),signal=new AbortController().signal;
 assert.ok(registry.available(state,person).some(t=>t.function.name==='my_learning'));
 await assert.rejects(registry.execute(person.id,'my_learning',{personId:'other'},signal));assert.equal(reads,0);
 assert.deepEqual((await registry.execute(person.id,'my_learning',{},signal)).data,{totalPlans:0,canManage:false,plans:[],hasMore:false,source:'Your learning plans'});
 person.overrides.push({permission:'learning.view',scope:'OWN',effect:'DENY'});await assert.rejects(registry.execute(person.id,'my_learning',{},signal));assert.equal(reads,1);
});
