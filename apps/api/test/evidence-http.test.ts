import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/create-app.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {AccessError} from '../src/shared/errors.js';
import type {EvidenceStore} from '../src/modules/skills/evidence.js';

test('Evidence HTTP binds actor, hides blob keys and rejects anonymous, forged, oversized and revoked uploads',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),actor=state.people[0].id;
 state.people[0].overrides.push({permission:'skill.claim',scope:'OWN',effect:'ALLOW'},{permission:'skill.view',scope:'ORGANIZATION',effect:'ALLOW'});access.snapshot=()=>structuredClone(state);
 const claim=randomUUID(),image=randomUUID(),seen:string[]=[];let uploads=0;
 const payload={revision:2,canUpload:true,items:[{id:image,blobName:'private/internal/key.webp',bytes:12,width:1,height:1}]};
 const evidenceStore:EvidenceStore={read:async id=>{seen.push(id);return payload;},image:async id=>{seen.push(id);return Buffer.from('image');},upload:async(id,_claim,revision)=>{seen.push(id);if(revision!==2)throw new AccessError(409,'Claim changed');uploads++;return {...payload,revision:3};}};
 const server=createApp({verify:async header=>{if(header!=='Bearer trusted')throw Error();return {tenantId:'tenant',objectId:'member'};},profile:async()=>undefined,access,resolveAccess:async()=>actor,evidenceStore}).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}/api/my-skills/${claim}/evidence`,headers={Authorization:'Bearer trusted','Content-Type':'image/png','X-Claim-Revision':'2'};
 try{
  assert.equal((await fetch(url)).status,401);assert.equal(seen.length,0);
  const read=await fetch(url,{headers});assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(await read.json()).includes('private/internal'));
  assert.equal((await fetch(url+'/'+image,{headers})).headers.get('content-type'),'image/webp');
  assert.equal((await fetch(url.replace(claim,'bad-id'),{headers})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Claim-Revision':'0'},body:'x'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{"actorId":"forged"}'})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:new Uint8Array(1048577)})).status,413);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,'X-Claim-Revision':'1'},body:'x'})).status,409);
  assert.equal(uploads,0);assert.equal((await fetch(url,{method:'POST',headers,body:'x'})).status,200);assert.equal(uploads,1);
  state.people[0].overrides.push({permission:'skill.claim',scope:'OWN',effect:'DENY'});assert.equal((await fetch(url,{method:'POST',headers,body:'x'})).status,403);assert.equal(uploads,1);
  state.people[0].overrides.push({permission:'skill.view',scope:'OWN',effect:'DENY'});const count=seen.length;assert.equal((await fetch(url,{headers})).status,403);assert.equal(seen.length,count);assert.ok(seen.every(id=>id===actor));
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
