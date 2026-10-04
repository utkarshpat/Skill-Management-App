import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {DashboardCapability,type DashboardCapabilityData} from '../src/DashboardCapability';
const data:DashboardCapabilityData={total:85,verified:40,pending:25,draft:15,changesRequested:3,rejected:2,canClaim:true,recentClaims:[{id:'one',skillName:'Azure',category:'Cloud',rank:3,levelName:'Practitioner',status:'APPROVED',updatedAt:'2026-10-04T10:00:00Z',href:'/my-skills?claim=one'}]};
const render=(value=data)=>renderToStaticMarkup(<MemoryRouter><DashboardCapability data={value}/></MemoryRouter>);
test('capability states target separate full lists and recent preview links to exact claim',()=>{
 const html=render();for(const status of ['APPROVED','SUBMITTED','DRAFT','CHANGES_REQUESTED','REJECTED'])assert.match(html,new RegExp('status='+status));
 assert.match(html,/85/);assert.match(html,/claim=one/);assert.match(html,/Level 3/);assert.match(html,/3 claims need changes/);assert.match(html,/2 not approved/);assert.doesNotMatch(html,/progressbar|capability percentage/);
});
test('capability empty and read-only states hide unsupported editing actions',()=>{
 const empty={...data,total:0,verified:0,pending:0,draft:0,changesRequested:0,rejected:0,recentClaims:[]};assert.match(render(empty),/Add your first skill/);
 const readonly=render({...empty,canClaim:false});assert.match(readonly,/Build your capability profile/);assert.doesNotMatch(readonly,/action=add|Recently updated|View feedback/);
});
