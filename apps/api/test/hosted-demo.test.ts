import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import type {Request} from 'express';
import {createApp} from '../src/create-app.js';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {createDevelopmentSessions,hostedDemoConfig} from '../src/modules/identity/index.js';

const hosted={origin:'https://demo.example',accessCode:'test-access-code-with-high-entropy',sessionSecret:'test-signing-secret-with-at-least-32-characters'};
test('hosted demo is separately opt-in and rejects incomplete or non-HTTPS configuration',()=>{
  assert.equal(hostedDemoConfig({NODE_ENV:'production'}),undefined);
  assert.throws(()=>hostedDemoConfig({NODE_ENV:'production',HOSTED_DEMO_LOGIN:'true'}));
  assert.throws(()=>hostedDemoConfig({NODE_ENV:'production',HOSTED_DEMO_LOGIN:'true',PUBLIC_APP_ORIGIN:'http://demo.example',DEMO_LOGIN_ACCESS_CODE:hosted.accessCode,DEMO_SESSION_SECRET:hosted.sessionSecret}));
  const config={NODE_ENV:'production',HOSTED_DEMO_LOGIN:'true',PUBLIC_APP_ORIGIN:hosted.origin,DEMO_SESSION_SECRET:hosted.sessionSecret};
  assert.equal(hostedDemoConfig({...config,DEMO_LOGIN_ACCESS_CODE:'zxcvb'})?.accessCode,'zxcvb');
  assert.throws(()=>hostedDemoConfig({...config,DEMO_LOGIN_ACCESS_CODE:'abcd'}));
  assert.throws(()=>hostedDemoConfig({...config,DEMO_LOGIN_ACCESS_CODE:'zxcvb',DEMO_SESSION_SECRET:'short'}));
  assert.deepEqual(hostedDemoConfig({NODE_ENV:'production',HOSTED_DEMO_LOGIN:'true',PUBLIC_APP_ORIGIN:hosted.origin,DEMO_LOGIN_ACCESS_CODE:hosted.accessCode,DEMO_SESSION_SECRET:hosted.sessionSecret}),hosted);
});

test('hosted sessions survive another instance, reject tampering, expiry, host changes and secret rotation',async()=>{
  const store=await LocalAccessStore.open(); const person=store.snapshot().people[0]; let now=1000;
  const first=createDevelopmentSessions(store,()=>now,hosted);
  const value=await first.issue(person.id);assert.ok(value);
  const request=(cookie:string,host='demo.example')=>({get:(key:string)=>key.toLowerCase()==='host'?host:key.toLowerCase()==='cookie'?`skill_dev_session=${cookie}`:undefined} as Request);
  const second=createDevelopmentSessions(store,()=>now,hosted);
  assert.equal(second.subject(request(value)),person.id);
  assert.equal(second.subject(request(value+'x')),undefined);
  assert.equal(second.subject(request(value,'evil.example')),undefined);
  assert.equal(createDevelopmentSessions(store,()=>now,{...hosted,sessionSecret:'changed-secret-with-at-least-32-characters'}).subject(request(value)),undefined);
  now+=first.lifetime;assert.equal(second.subject(request(value)),undefined);
});

test('hosted HTTP gates roster and login, protects cookies and mutations, excludes Microsoft accounts and rechecks permissions',async()=>{
  const store=await LocalAccessStore.open();let state=store.snapshot();const admin=state.people[0];
  state=await store.save(admin.id,{revision:state.revision,kind:'person',displayName:'Hosted employee',employeeCode:'HOSTED-TEST',active:true,roleIds:[],overrides:[{permission:'profile.view',scope:'OWN',effect:'ALLOW'}]});
  const person=state.people.find(item=>item.employeeCode==='HOSTED-TEST')!;
  const linked={id:'11111111-1111-4111-8111-111111111111',displayName:'Microsoft owner',employeeCode:'LINKED-TEST',active:true,roleIds:[],overrides:[],entraObjectId:'22222222-2222-4222-8222-222222222222'};
  const hostedStore={snapshot:()=>{const current=store.snapshot();return {...current,people:[...current.people,linked]};},person:(id:string)=>id===linked.id?linked:store.person(id),save:store.save.bind(store)};
  const runtimeHosted={...hosted};
  const server=createApp(undefined,{developmentStore:hostedStore,hostedDemo:runtimeHosted}).listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  runtimeHosted.origin=`https://127.0.0.1:${address.port}`;
  const headers={Origin:runtimeHosted.origin,'Content-Type':'application/json'};
  const post=(path:string,body:unknown,override={})=>fetch(base+path,{method:'POST',headers:{...headers,...override},body:JSON.stringify(body)});
  try{
    const discovery=await fetch(base+'/api/dev-login',{headers});assert.deepEqual(await discovery.json(),{people:[],signedIn:false,mode:'local-demo',requiresAccessCode:true});
    assert.equal((await post('/api/dev-login/people',{accessCode:'wrong'})).status,403);
    assert.equal((await post('/api/dev-login',{personId:person.id})).status,403);
    assert.equal((await post('/api/dev-login/people',{accessCode:hosted.accessCode},{Origin:'https://evil.example'})).status,403);
    const roster=await post('/api/dev-login/people',{accessCode:hosted.accessCode});assert.equal(roster.status,200);assert.ok(!(await roster.json()).people.some((item:{id:string})=>item.id===linked.id));
    assert.equal((await post('/api/dev-login',{personId:linked.id,accessCode:hosted.accessCode})).status,400);
    const login=await post('/api/dev-login',{personId:person.id,accessCode:hosted.accessCode,role:'SUPER_ADMIN'});assert.equal(login.status,200);
    const setCookie=login.headers.get('set-cookie')!;assert.match(setCookie,/Secure/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
    const Cookie=setCookie.split(';')[0],signedHeaders={...headers,Cookie};
    assert.equal((await fetch(base+'/api/me',{headers:signedHeaders})).status,200);
    assert.equal((await fetch(base+'/api/assistant',{headers:signedHeaders})).status,200);
    assert.equal((await fetch(base+'/api/dev-access',{headers:signedHeaders})).status,403);
    assert.equal((await post('/api/assistant/navigation',{},{Cookie,Origin:'https://evil.example'})).status,403);
    state=await store.save(admin.id,{...person,revision:state.revision,kind:'person',overrides:[]});
    assert.equal((await fetch(base+'/api/me',{headers:signedHeaders})).status,403);
    assert.equal((await fetch(base+'/api/assistant',{headers:signedHeaders})).status,403);
    const logout=await fetch(base+'/api/dev-login',{method:'DELETE',headers:signedHeaders});assert.equal(logout.status,204);assert.match(logout.headers.get('set-cookie')!,/Secure/);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
