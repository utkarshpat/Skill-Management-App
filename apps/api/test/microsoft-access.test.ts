import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';

test('Microsoft administration trusts verified mapping, rechecks grants and blocks demo bypass', async () => {
  const initial = (await LocalAccessStore.open()).snapshot();
  const admin = initial.people[0]; admin.entraObjectId = 'verified-owner';
  initial.people.push({id:'reader',displayName:'Reader',employeeCode:'QA',active:true,roleIds:[],overrides:[]});
  const store = LocalAccessStore.fromState(initial);
  let resolved = admin.id;
  const server = createApp({
    verify: async header => { assert.equal(header, 'Bearer valid'); return {tenantId:'trusted',objectId:'verified-owner'}; },
    profile: async () => undefined,
    access: store,
    resolveAccess: async identity => { assert.equal(identity.objectId,'verified-owner'); return resolved; },
  }, {developmentStore:store}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address(); assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  const headers={Origin:base,Authorization:'Bearer valid','Content-Type':'application/json'};
  try {
    assert.equal((await fetch(base+'/api/access')).status,401);
    const response=await fetch(base+'/api/access?personId=reader',{headers});
    assert.equal(response.status,200);
    const state=await response.json(); assert.equal(state.currentPerson.id,admin.id); assert.equal(state.authentication,'microsoft');
    const picker=await (await fetch(base+'/api/dev-login')).json(); assert.deepEqual(picker.people.map((person:{id:string})=>person.id),['reader']);
    assert.equal((await fetch(base+'/api/dev-login',{method:'POST',headers,body:JSON.stringify({personId:admin.id})})).status,400);
    const change={kind:'role',revision:state.revision,name:'Reviewers',permissions:[],actorId:'reader'};
    const preview=await (await fetch(base+'/api/access/preview',{method:'POST',headers,body:JSON.stringify(change)})).json();
    const saved=await fetch(base+'/api/access',{method:'POST',headers,body:JSON.stringify({...change,previewReceipt:preview.receipt})});
    assert.equal(saved.status,200); assert.equal(store.snapshot().audit.at(-1)?.actorId,admin.id);
    resolved='reader';
    assert.equal((await fetch(base+'/api/access?personId='+admin.id,{headers})).status,403);
    assert.equal((await fetch(base+'/api/access',{method:'POST',headers,body:JSON.stringify({actorId:admin.id})})).status,403);
    resolved=admin.id;
    const latest=store.snapshot();
    // User-specific DENY immediately revokes admin API access, despite the role grant.
    latest.people[0].overrides.push({permission:'permissions.manage',scope:'ORGANIZATION',effect:'DENY'});
    const deniedStore=LocalAccessStore.fromState(latest);
    store.snapshot=()=>deniedStore.snapshot();
    assert.equal((await fetch(base+'/api/access',{headers})).status,403);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});

