import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {ProfileDetails} from '../src/ProfileDetails';
import type {WorkspaceState} from '../src/Workspace';
test('profile shows real identity and independently permission-filtered workspace actions',()=>{
 const workspace:WorkspaceState={person:{id:'own',displayName:'Test Person',employeeCode:'EMP-1',roles:['Employee']},authentication:'microsoft',capabilities:{ownProfile:true,ownSkills:true,claimSkills:false,catalogue:false,administration:false,manageCatalogue:false,learning:false,requests:true},upcoming:[]};
 const html=renderToStaticMarkup(<MemoryRouter><ProfileDetails workspace={workspace} profile={{...workspace.person,organization:'Real workspace',status:'ACTIVE'}}/></MemoryRouter>);
 assert.match(html,/Real workspace/);assert.match(html,/EMP-1/);assert.match(html,/Microsoft account/);assert.match(html,/href="\/my-skills"/);assert.match(html,/href="\/requests\?action=create"/);assert.doesNotMatch(html,/href="\/learning"/);assert.doesNotMatch(html,/Edit profile/);
});
