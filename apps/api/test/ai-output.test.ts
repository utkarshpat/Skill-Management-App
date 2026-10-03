import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantService, configuredProvider } from '../src/modules/ai/assistant.js';
import { presentation } from '../src/modules/ai/output.js';
import { LocalAccessStore, AccessError } from '../src/modules/access/local-access-store.js';
const quiz=(count=10)=>({kind:'practice_quiz',title:'Learning practice',summary:'Practice only.',body:'',steps:[],questions:Array.from({length:count},(_,index)=>({prompt:`Question ${index+1}?`,options:['A','B','C','D'],correctIndex:1,explanation:'Why B is correct.'}))});

test('structured outputs reject executable fields, invalid keys and incomplete practice quizzes',()=>{
  for(const count of [1,5,10,15,20])assert.equal(presentation(quiz(count)).questions.length,count);
  assert.throws(()=>presentation(quiz(21)),AccessError);
  for(const bad of [{...quiz(),url:'javascript:alert(1)'},{...quiz(),questions:[]},{...quiz(),questions:quiz().questions.map(q=>({...q,correctIndex:5}))},{...quiz(),questions:quiz().questions.map(q=>({...q,options:['A','A','C','D']}))},{...quiz(),kind:'execute_sql'},{...quiz(),body:'Pretend saved'}])assert.throws(()=>presentation(bad),AccessError);
  assert.throws(()=>presentation({...quiz(),questions:quiz().questions.map(()=>quiz().questions[0])}),AccessError);
});
test('presentation renders suggestions without calling persistence; revoked access prevents output',async()=>{
  const store=await LocalAccessStore.open(),actor=store.snapshot().people[0].id;
  store.save=async()=>{throw new Error('Writes must not happen');};
  const answer={content:'',calls:[{id:'card',type:'function' as const,function:{name:'present_output',arguments:JSON.stringify(quiz())}}]};
  const result=await new AssistantService(store,undefined,{name:'fixture',complete:async()=>answer}).chat(actor,{messages:[{role:'user',content:'Learning practice'}]});
  assert.equal(result.artifact?.kind,'practice_quiz');assert.equal(result.mode,'read-only');
  await assert.rejects(new AssistantService(store,undefined,{name:'fixture',complete:async()=>{const state=store.snapshot();state.people[0].active=false;store.snapshot=()=>structuredClone(state);return answer;}}).chat(actor,{messages:[{role:'user',content:'Help'}]}),AccessError);
});
test('Gemini preserves signed parts across tool rounds, fixes destination and hides upstream secrets',async()=>{
  const seen:Record<string,unknown>[]=[];
  const parts=[{functionCall:{name:'own_profile',args:{}},thoughtSignature:'opaque-signature'}];
  const provider=configuredProvider({GEMINI_API:'test-secret'},async(url,options)=>{
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');assert.equal((options?.headers as Record<string,string>)['x-goog-api-key'],'test-secret');seen.push(JSON.parse(String(options?.body)));
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:seen.length===1?parts:[{text:'Useful answer'}]}}]});
  });assert.ok(provider);
  const first=await provider.complete([{role:'user',content:'My profile'}],[],AbortSignal.timeout(1000));
  await provider.complete([{role:'user',content:'My profile'},{role:'assistant',content:'',tool_calls:first.calls,providerParts:first.providerParts},{role:'tool',tool_name:'own_profile',content:'{"name":"Synthetic"}'}],[],AbortSignal.timeout(1000));
  assert.deepEqual((seen[1].contents as {parts:unknown[]}[])[1].parts,parts);
  assert.throws(()=>configuredProvider({GEMINI_API:'secret',AI_MODEL:'../external'}),/model name/);
  const failed=configuredProvider({GEMINI_API:'test-secret'},async()=>new Response('test-secret',{status:429}));
  await assert.rejects(failed!.complete([{role:'user',content:'Help'}],[],AbortSignal.timeout(1000)),error=>error instanceof AccessError&&!error.message.includes('test-secret'));
});
test('Gemini rejects blocked and truncated responses rather than displaying partial output',async()=>{
  for(const finishReason of ['SAFETY','MAX_TOKENS']){
    const provider=configuredProvider({GEMINI_API:'secret'},async()=>Response.json({candidates:[{finishReason,content:{parts:[{text:'partial'}]}}]}));
    await assert.rejects(provider!.complete([{role:'user',content:'Hi'}],[],AbortSignal.timeout(1000)),AccessError);
  }
});
test('Gemini billing and quota failures have distinct safe, actionable messages',async()=>{
  for(const [http,status] of [[402,503],[429,429],[403,503]]){
    const provider=configuredProvider({GEMINI_API:'secret'},async()=>new Response('secret provider diagnostics',{status:http}));
    await assert.rejects(provider!.complete([{role:'user',content:'Hello'}],[],AbortSignal.timeout(1000)),error=>error instanceof AccessError&&error.status===status&&!error.message.includes('secret'));
  }
});
