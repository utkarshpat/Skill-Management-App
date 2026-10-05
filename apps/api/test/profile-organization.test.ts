import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createApp} from '../src/create-app.js';
import {AccessError} from '../src/shared/errors.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';

const details={workspace:'Stored company',placementStatus:'ASSIGNED' as const,deliveryUnit:'Services',department:'Engineering',team:null,managerStatus:'ASSIGNED' as const,managerName:'Current manager'};
test('profile organization binds reads to verified identity, propagates revocation and hides infrastructure errors',async()=>{
 let status:'allowed'|'revoked'|'failed'='allowed',calls=0;
 const server=createApp({
  verify:async authorization=>{if(authorization!=='Bearer fixture')throw Error();return {tenantId:'tenant',objectId:'object'};},
  profile:async()=>({id:'actor',displayName:'Employee',employeeCode:'EMP',organization:'Legacy label',status:'ACTIVE',roles:[]}),
  ownOrganization:async actor=>{calls++;assert.equal(actor,'actor');if(status==='revoked')throw new AccessError(403,'Own profile access denied.');if(status==='failed')throw Error('private database detail');return details;},
 }).listen(0,'127.0.0.1');
 await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 const url=`http://127.0.0.1:${address.port}/api/me?actorId=foreign&managerId=foreign`;
 try{
  assert.equal((await fetch(url)).status,401);assert.equal(calls,0);
  const headers={Authorization:'Bearer fixture'},response=await fetch(url,{headers});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.equal(body.profile.organization,'Stored company');assert.deepEqual(body.profile.organizationDetails,details);
  assert.doesNotMatch(JSON.stringify(body),/managerId|departmentId|foreign/);
  status='revoked';assert.equal((await fetch(url,{headers})).status,403);
  status='failed';const failed=await fetch(url,{headers});assert.equal(failed.status,500);assert.doesNotMatch(await failed.text(),/private database detail/);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('demo profile uses the same own projection and skips it after profile permission revocation',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),actor=state.people[0];access.snapshot=()=>structuredClone(state);
 let calls=0;
 const server=createApp({verify:async()=>{throw Error();},profile:async()=>undefined,ownOrganization:async id=>{calls++;assert.equal(id,actor.id);return details;}},{developmentStore:access}).listen(0,'127.0.0.1');
 await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 try{
  const login=await fetch(base+'/api/dev-login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({personId:actor.id})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const response=await fetch(base+'/api/me',{headers:{Cookie:cookie}});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).profile.organizationDetails,details);assert.equal(calls,1);
  actor.overrides.push({permission:'profile.view',scope:'OWN',effect:'DENY'});
  assert.equal((await fetch(base+'/api/me',{headers:{Cookie:cookie}})).status,403);assert.equal(calls,1);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('own organization SQL limits output to actor-bound placement and valid current reporting',async()=>{
 const sql=await readFile(new URL('../../../database/migrations/043_own_organization_profile.sql',import.meta.url),'utf8');
 assert.match(sql,/AccessRuntimeAccount/);
 assert.match(sql,/AccessCan\(@account_id,@actor_id,'profile.view',1\)/);
 assert.match(sql,/WHERE account_id=@account_id AND person_id=@actor_id/);
 assert.match(sql,/AccessReportingValid\(@account_id,@actor_id\)=1/);
 assert.match(sql,/d\.kind='DEPARTMENT' AND d\.active=1/);
 assert.match(sql,/u\.kind='DELIVERY_UNIT' AND u\.active=1 AND u\.parent_id IS NULL/);
 assert.match(sql,/person_id=@manager AND active=1 AND person_id<>@actor_id/);
 const output=sql.split(' SELECT @workspace AS workspace')[1]?.split(' COMMIT')[0];assert.ok(output);
 assert.doesNotMatch(output,/personId|managerId|employee_code|role|permission/i);
 assert.doesNotMatch(sql,/INSERT|UPDATE dbo|DELETE|CREATE TABLE/);
 const runner=await readFile(new URL('../src/database-cli.ts',import.meta.url),'utf8');
 assert.match(runner,/\[43,'043_own_organization_profile.sql'\]/);
});
