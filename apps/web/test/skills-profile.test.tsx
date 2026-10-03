import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {SkillsProfileView} from '../src/SkillsProfileView';
import type {Claim} from '../src/MySkills';
const statuses:Claim['status'][]=['DRAFT','SUBMITTED','CHANGES_REQUESTED','APPROVED','REJECTED'];
const claims=statuses.map((status,index)=>({id:String(index),revision:1,skillId:String(index),skillName:'Skill '+index,category:index%2?'Cloud & DevOps':'Programming',definitionRevision:1,rank:3,levelName:'Intermediate',experienceMonths:24,description:'Synthetic experience',status,updatedAt:'2026-10-03T12:00:00Z'}));
function render(canClaim=true){return renderToStaticMarkup(<MemoryRouter><SkillsProfileView claims={claims} canClaim={canClaim} loading={false} onView={()=>{}} onEdit={()=>{}} onSubmit={()=>{}}/></MemoryRouter>);}
test('skill profile totals and overview account for every status without claiming verified capability',()=>{
 const html=render();assert.match(html,/Total skills: 5/);assert.match(html,/Manager reviewed: 1/);assert.match(html,/Pending review: 1/);assert.match(html,/Self-assessed: 1/);assert.match(html,/2 Needs attention/);assert.doesNotMatch(html,/>Verified</);assert.match(html,/Filter skill category/);assert.match(html,/Filter proficiency level/);
});
test('skill profile exposes editing only for editable statuses and suppresses mutations without permission',()=>{
 const html=render();for(const index of [0,2,4])assert.match(html,new RegExp('Edit Skill '+index+' draft'));for(const index of [1,3])assert.doesNotMatch(html,new RegExp('Edit Skill '+index+' draft'));
 const readOnly=render(false);assert.doesNotMatch(readOnly,/Edit Skill \d draft|Submit Skill \d for review|Reroute Skill \d for review/);assert.match(readOnly,/View Skill 0 claim/);
});
