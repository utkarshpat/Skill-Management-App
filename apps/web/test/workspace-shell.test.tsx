import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {PersonalCapabilityNavigation,administrationShellFor,personalPageTitle} from '../src/WorkspaceNavigation';

test('personal and AI link destinations retain the admin shell only with administration capability',()=>{
 for(const pathname of ['/my-skills','/skills','/profile','/workspace']){
  assert.equal(administrationShellFor(pathname,true),true);
  assert.equal(administrationShellFor(pathname,false),false);
  assert.ok(personalPageTitle(pathname));
 }
 assert.equal(administrationShellFor('/access',false),true);
 assert.equal(personalPageTitle('/access'),undefined);
});
test('personal navigation highlights the selected skill link and requires independent own permissions',()=>{
 const render=(ownProfile:boolean,ownSkills:boolean)=>renderToStaticMarkup(<MemoryRouter><PersonalCapabilityNavigation capabilities={{ownProfile,ownSkills}} pathname="/my-skills" onNavigate={()=>{}}/></MemoryRouter>);
 const granted=render(true,true);assert.match(granted,/aria-current="page"[^>]*href="\/my-skills"/);assert.match(granted,/href="\/profile"/);
 const denied=render(true,false);assert.doesNotMatch(denied,/href="\/my-skills"|aria-current="page"/);
 assert.equal(render(false,false),'');
});
