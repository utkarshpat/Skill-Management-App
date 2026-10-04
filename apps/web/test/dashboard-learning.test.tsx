import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {DashboardLearning,learningTaskPrompt,type DashboardLearningData} from '../src/DashboardLearning';
const data:DashboardLearningData={activePlans:2,completed:3,total:10,progress:30,loggedMinutes:75,overdue:1,today:2,canManage:true,nextTask:{id:'task',planId:'plan',title:'Practice API testing',planTitle:'Backend goal',skillName:'Java',plannedDate:'2026-10-03',timezone:'Asia/Calcutta',estimatedMinutes:30,due:'OVERDUE',daysOverdue:1,planCompleted:2,planTotal:4,href:'/learning?plan=plan&task=task'}};
function render(value=data,ai=true){return renderToStaticMarkup(<MemoryRouter><DashboardLearning data={value} ai={ai} onHelp={()=>{throw Error('No automatic AI calls');}}/></MemoryRouter>);}
test('learning focus distinguishes selected plan progress and actual logs; actions target exact saved task',()=>{
 const html=render();assert.match(html,/1 day overdue/);assert.match(html,/2 of 4 plan tasks completed/);assert.match(html,/aria-valuenow="50"/);assert.match(html,/3 \/ 10 tasks complete \(30%\)/);assert.match(html,/75 actual minutes logged/);assert.match(html,/plan=plan&amp;task=task/);assert.match(html,/tab=backlog/);assert.match(html,/tab=today/);assert.match(html,/Skill focus: Java/);assert.match(html,/Help with this task/);
});
test('read-only learning retains viewing and hides AI when unconfigured; empty plans avoid a false percentage',()=>{
 const readOnly=render({...data,canManage:false},false);assert.match(readOnly,/Open learning task/);assert.doesNotMatch(readOnly,/Continue learning|Help with this task/);
 const empty=render({...data,nextTask:null,total:0,completed:0,activePlans:0});assert.match(empty,/Start with a learning goal/);assert.doesNotMatch(empty,/progressbar|0%|Continue learning/);
 const complete=render({...data,nextTask:null});assert.match(complete,/Your active plans are complete/);assert.match(complete,/Create your next plan/);
});
test('task assistance prompt stays bounded and selects IDs instead of user-authored titles',()=>{
 const prompt=learningTaskPrompt({id:'bb123456-1234-1234-1234-123456789abc',planId:'aa123456-1234-1234-1234-123456789abc'});assert.ok(prompt.length<=500);assert.match(prompt,/my_learning_task/);assert.match(prompt,/Do not complete or reschedule/);
});
