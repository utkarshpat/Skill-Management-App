import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { notificationsFor } from '../src/modules/identity/notifications.js';
import { createApp } from '../src/create-app.js';
test('notification feed exposes only own addressed events without workspace audit payloads',async()=>{
  const store=await LocalAccessStore.open(),state=store.snapshot(),person=state.people[0];
  state.audit=[{actorId:'private-admin',targetId:person.id,action:'person.updated',at:new Date().toISOString(),revision:2,after:{...person,displayName:'Private payload'}},{actorId:'private-admin',targetId:'other',action:'person.updated',at:new Date().toISOString(),revision:3},{actorId:person.id,targetId:person.id,action:'person.updated',at:new Date().toISOString(),revision:4}];
  const feed=notificationsFor(state,person);assert.equal(feed.items.length,1);assert.doesNotMatch(JSON.stringify(feed),/private-admin|Private payload|other/);
  const many={...state,audit:Array.from({length:35},(_,index)=>({...state.audit[0],revision:index+10}))};
  const bounded=notificationsFor(many,person);assert.equal(bounded.items.length,30);assert.equal(bounded.items[0].id,'person-44');assert.equal(bounded.items.at(-1)?.id,'person-15');
  store.snapshot=()=>structuredClone(state);
  const server=createApp({verify:async header=>{if(header!=='Bearer trusted')throw new Error();return {tenantId:'t',objectId:'o'};},resolveAccess:async()=>person.id,profile:async()=>undefined,access:store}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}/api/notifications?personId=other`;
  try{assert.equal((await fetch(url)).status,401);const response=await fetch(url,{headers:{Authorization:'Bearer trusted'}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).personId,person.id);
    state.people[0].overrides.push({permission:'profile.view',scope:'OWN',effect:'DENY'});assert.equal((await fetch(url,{headers:{Authorization:'Bearer trusted'}})).status,403);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
