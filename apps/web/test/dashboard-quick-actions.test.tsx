import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {DashboardQuickActions,type DashboardQuickAction} from '../src/DashboardQuickActions';
import {assistantContextPrompt} from '../src/assistant-context';
test('quick actions expose real entry points and editable AI shortcuts without sending or saving',()=>{
 let calls=0;const actions:DashboardQuickAction[]=[{id:'skill',label:'Add skill',href:'/my-skills?action=add',description:'Choose a published skill.',assistance:{label:'Draft with AI',prompt:'Prepare a draft.'}},{id:'learning',label:'Create learning plan',href:'/learning?action=create',description:'Plan your goal.',assistance:{label:'Plan with AI',href:'/learning?action=planner'}}];
 const html=renderToStaticMarkup(<MemoryRouter><DashboardQuickActions actions={actions} onAssist={()=>calls++}/></MemoryRouter>);
 for(const path of ['/my-skills?action=add','/learning?action=create','/learning?action=planner'])assert.ok(html.includes(path));assert.match(html,/Draft with AI/);assert.match(html,/Choose a published skill/);assert.match(html,/Review the details/);assert.equal(calls,0);
 const manual=renderToStaticMarkup(<MemoryRouter><DashboardQuickActions actions={actions.map(({assistance,...a})=>a)} onAssist={()=>calls++}/></MemoryRouter>);assert.doesNotMatch(manual,/Draft with AI|Plan with AI|AI helps/);
 assert.equal(renderToStaticMarkup(<MemoryRouter><DashboardQuickActions actions={[]} onAssist={()=>calls++}/></MemoryRouter>),'');
});
test('context shortcuts preserve an existing draft until explicitly replaced and reject invalid intents',()=>{
 assert.deepEqual(assistantContextPrompt('  Prepare request  ','My unsent message'),{prompt:'Prepare request',needsReplacement:true});
 assert.deepEqual(assistantContextPrompt('Prepare request','  Prepare request '),{prompt:'Prepare request',needsReplacement:false});
 assert.deepEqual(assistantContextPrompt('Prepare request',''),{prompt:'Prepare request',needsReplacement:false});
 for(const invalid of [null,{},12,'  ','a'.repeat(501)])assert.equal(assistantContextPrompt(invalid,'Keep this draft'),undefined);
});
