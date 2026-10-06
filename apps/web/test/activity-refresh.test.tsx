import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startActivityRefresh} from '../src/activity-refresh';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function environment(){let time=0;return {window:new EventTarget(),document:Object.assign(new EventTarget(),{visibilityState:'visible'}),now:()=>time,advance:(ms:number)=>{time+=ms;}};}
test('idle time makes no requests; activity and focus refresh only when stale',async()=>{
 const env=environment();let calls=0;const stop=startActivityRefresh(async()=>{calls++;},['changed'],env);
 await settle();assert.equal(calls,1);
 env.advance(3_600_000);await settle();assert.equal(calls,1);
 env.document.dispatchEvent(new Event('pointerdown'));await settle();assert.equal(calls,2);
 env.document.dispatchEvent(new Event('keydown'));env.window.dispatchEvent(new Event('focus'));await settle();assert.equal(calls,2);
 env.advance(60_000);env.window.dispatchEvent(new Event('focus'));await settle();assert.equal(calls,3);
 stop();env.window.dispatchEvent(new Event('changed'));await settle();assert.equal(calls,3);
});
test('concurrent mutation events coalesce but still recheck after in-flight response',async()=>{
 const env=environment();let calls=0,release:()=>void=()=>{};
 const stop=startActivityRefresh(async()=>{calls++;if(calls===1)await new Promise<void>(resolve=>{release=resolve;});},['changed'],env);
 await settle();env.window.dispatchEvent(new Event('changed'));env.window.dispatchEvent(new Event('changed'));await settle();assert.equal(calls,1);
 release();await settle();assert.equal(calls,2);stop();
});
test('hidden tabs do not query; deferred changes refresh when visible again',async()=>{
 const env=environment();let calls=0;const stop=startActivityRefresh(async()=>{calls++;},['changed'],env);
 await settle();env.document.visibilityState='hidden';env.window.dispatchEvent(new Event('changed'));env.window.dispatchEvent(new Event('focus'));await settle();assert.equal(calls,1);
 env.document.visibilityState='visible';env.document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(calls,2);stop();
});
test('failed refresh does not start a retry loop and cleanup suppresses queued work',async()=>{
 const env=environment();let calls=0;const stop=startActivityRefresh(async()=>{calls++;throw Error('offline');},['changed'],env);
 await settle();env.advance(3_600_000);await settle();assert.equal(calls,1);stop();env.window.dispatchEvent(new Event('changed'));await settle();assert.equal(calls,1);
});
