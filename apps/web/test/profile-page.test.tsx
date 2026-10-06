import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {ProfileDetails} from '../src/ProfileDetails';
import type {WorkspaceState} from '../src/Workspace';
import {ProfileOrganization,type ProfileOrganizationDetails} from '../src/ProfileOrganization';
test('profile shows real identity and independently permission-filtered workspace actions',()=>{
 const workspace:WorkspaceState={person:{id:'own',displayName:'Test Person',employeeCode:'EMP-1',roles:['Employee']},authentication:'microsoft',capabilities:{ownProfile:true,ownSkills:true,claimSkills:false,catalogue:false,administration:false,manageCatalogue:false,learning:false,requests:true,requestProfileCorrection:true},upcoming:[]};
 const html=renderToStaticMarkup(<MemoryRouter><ProfileDetails workspace={workspace} profile={{...workspace.person,organization:'Real workspace',status:'ACTIVE'}}/></MemoryRouter>);
 assert.match(html,/Real workspace/);assert.match(html,/EMP-1/);assert.match(html,/Microsoft account/);assert.match(html,/href="\/my-skills"/);assert.match(html,/href="\/requests\?action=create"/);assert.doesNotMatch(html,/href="\/learning"/);assert.doesNotMatch(html,/Edit profile/);
});

const assigned:ProfileOrganizationDetails={workspace:'Stored workspace',placementStatus:'ASSIGNED',deliveryUnit:'Services',department:'Engineering',team:'Platform',managerStatus:'ASSIGNED',managerName:'Current Manager'};
test('own organization presents current names without treating templates or hierarchy as authority',()=>{
 const html=renderToStaticMarkup(<ProfileOrganization details={assigned}/>);
 for(const text of ['Services','Engineering','Platform','Current Manager','not access grants'])assert.ok(html.includes(text));
 assert.doesNotMatch(html,/href=|Edit|Approve|role="alert"/);
 const departmentOnly=renderToStaticMarkup(<ProfileOrganization details={{...assigned,team:null}}/>);
 assert.match(departmentOnly,/No team assigned/);assert.match(departmentOnly,/Engineering/);
});
test('profile distinguishes unassigned, broken, loading, failed and unavailable organization records',()=>{
 const missing=renderToStaticMarkup(<ProfileOrganization details={{...assigned,placementStatus:'NOT_ASSIGNED',managerStatus:'NOT_ASSIGNED',deliveryUnit:null,department:null,team:null,managerName:null}}/>);
 assert.match(missing,/Not assigned/);assert.match(missing,/not been assigned yet/);
 const broken=renderToStaticMarkup(<ProfileOrganization details={{...assigned,placementStatus:'NEEDS_ATTENTION',managerStatus:'NEEDS_ATTENTION',managerName:'Do not display'}}/>);
 assert.match(broken,/Needs administrator attention/);assert.match(broken,/inactive or inconsistent/);
 assert.doesNotMatch(broken,/Current Manager|Do not display|Engineering|Platform/);
 assert.match(renderToStaticMarkup(<ProfileOrganization loading/>),/role="status"/);
 const failed=renderToStaticMarkup(<ProfileOrganization failed/>);assert.match(failed,/Use Retry above/);assert.doesNotMatch(failed,/Loading|Not assigned/);
 assert.match(renderToStaticMarkup(<ProfileOrganization/>),/unavailable for this profile/);
});
test('organization names are escaped and access template labels remain distinct from job roles',()=>{
 const workspace:WorkspaceState={person:{id:'own',displayName:'Person',employeeCode:'EMP',roles:['Employee']},authentication:'microsoft',capabilities:{ownProfile:true,ownSkills:false,claimSkills:false,catalogue:false,administration:false,manageCatalogue:false,learning:false,requests:false},upcoming:[]};
 const html=renderToStaticMarkup(<MemoryRouter><ProfileDetails workspace={workspace} profile={{...workspace.person,organization:'Company',status:'ACTIVE',organizationDetails:{...assigned,managerName:'<script>unsafe</script>'}}}/></MemoryRouter>);
 assert.match(html,/Access templates/);assert.match(html,/not your job title or grade/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|MY PROFILE/);
 const failed=renderToStaticMarkup(<MemoryRouter><ProfileDetails workspace={workspace} failed/></MemoryRouter>);
 assert.doesNotMatch(failed,/Loading workspace|Checking/);
});
test('profile displays managed job title and grade separately from access templates',()=>{
 const workspace:WorkspaceState={person:{id:'own',displayName:'Person',employeeCode:'EMP',roles:['Admin template']},authentication:'microsoft',capabilities:{ownProfile:true,ownSkills:false,claimSkills:false,catalogue:false,administration:false,manageCatalogue:false,learning:false,requests:false},upcoming:[]};
 const html=renderToStaticMarkup(<MemoryRouter><ProfileDetails workspace={workspace} profile={{...workspace.person,organization:'Company',status:'ACTIVE',jobTitle:'Business analyst',grade:'G4'}}/></MemoryRouter>);
 assert.match(html,/Business role/);assert.match(html,/Business analyst/);assert.match(html,/G4/);assert.match(html,/Admin template/);assert.doesNotMatch(html,/<input|Edit profile/);
});

 test('profile correction actions require explicit backend create capability and retain completeness',()=>{
 const workspace:WorkspaceState={person:{id:'own',displayName:'Person',employeeCode:'EMP',roles:[]},authentication:'microsoft',capabilities:{ownProfile:true,ownSkills:false,claimSkills:false,catalogue:false,administration:false,manageCatalogue:false,requests:true,requestProfileCorrection:false},upcoming:[]};
 const profile={...workspace.person,organization:'Company',status:'ACTIVE',completeness:{filled:0,total:6,status:'INCOMPLETE' as const,items:[]}};
 const render=()=>renderToStaticMarkup(<MemoryRouter><ProfileDetails workspace={workspace} profile={profile}/></MemoryRouter>);
 assert.match(render(),/Profile completeness/);assert.doesNotMatch(render(),/requests\?action=create/);
 workspace.capabilities.requestProfileCorrection=true;
 assert.match(render(),/requests\?action=create/);
 });
