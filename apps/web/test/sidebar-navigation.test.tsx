import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {BookOpen,LayoutDashboard,UserRound} from 'lucide-react';
import {SidebarNavigation} from '../src/SidebarNavigation';
import {personalNavigationItems} from '../src/WorkspaceNavigation';
import {DEFAULT_SIDEBAR_ORDER,normalizeSidebarOrder,orderSidebarItems,moveSidebarItem,readSidebarOrder,saveSidebarOrder} from '../src/sidebar-order';
test('defaults prioritize daily work across permission combinations and put profile last',()=>{
 const personal=personalNavigationItems({ownProfile:true,ownSkills:true,learning:true,requests:true,reviewSkills:true});
 const admin=[...personal,{id:'roles'},{id:'organization'},{id:'dashboard'},{id:'skills'},{id:'people'},{id:'audit'},{id:'assignments'}];
 const ids=orderSidebarItems(admin,undefined).map(i=>i.id);
 assert.deepEqual(ids,['dashboard','learning','my-skills','skill-reviews','requests','skills','organization','people','roles','assignments','audit','profile']);
 assert.deepEqual(personalNavigationItems({ownProfile:true,ownSkills:false,learning:false,requests:true}).map(i=>i.id),['requests','profile']);
});
test('stored display preference cannot create links or restore revoked navigation',()=>{
 const allowed=[{id:'dashboard'},{id:'learning'},{id:'profile'}];
 assert.deepEqual(orderSidebarItems(allowed,['roles','profile','profile','https://evil.test','dashboard']).map(i=>i.id),['profile','dashboard','learning']);
 assert.equal(normalizeSidebarOrder(['roles','roles','evil']).filter(id=>id==='roles').length,1);
 for(const invalid of [{},null,'dashboard',Array(31).fill('profile')])assert.deepEqual(normalizeSidebarOrder(invalid),[...DEFAULT_SIDEBAR_ORDER]);
});
test('reordering moves visible items in either direction and retains hidden item positions',()=>{
 const visible=['dashboard','learning','my-skills','profile'];
 const next=moveSidebarItem(undefined,visible,'profile','learning');
 assert.deepEqual(orderSidebarItems(visible.map(id=>({id})),next).map(i=>i.id),['dashboard','profile','learning','my-skills']);
 assert.equal(next.indexOf('roles'),DEFAULT_SIDEBAR_ORDER.indexOf('roles'));
 assert.deepEqual(moveSidebarItem(next,visible,'profile','profile'),next);
 assert.deepEqual(moveSidebarItem(next,visible,'roles','learning'),next);
 assert.deepEqual(orderSidebarItems(visible.map(id=>({id})),moveSidebarItem(next,visible,'dashboard','my-skills')).map(i=>i.id),['profile','learning','my-skills','dashboard']);
 assert.deepEqual(normalizeSidebarOrder(undefined),[...DEFAULT_SIDEBAR_ORDER]);
});
test('preferences are actor-specific, bounded and resilient to corrupt or blocked storage',()=>{
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 assert.equal(saveSidebarOrder(storage,'employee',['profile']),true);
 assert.equal(readSidebarOrder(storage,'employee')[0],'profile');assert.equal(readSidebarOrder(storage,'manager')[0],'dashboard');
 assert.equal(saveSidebarOrder(storage,'',[]),false);assert.equal(saveSidebarOrder(undefined,'employee',[]),false);
 const blocked={getItem:()=>{throw Error('Blocked');},setItem:()=>{throw Error('Blocked');}};assert.equal(saveSidebarOrder(blocked,'employee',[]),false);assert.deepEqual(readSidebarOrder(blocked,'employee'),[...DEFAULT_SIDEBAR_ORDER]);
 for(const raw of ['{broken','x'.repeat(2001),'{"href":"/access"}'])assert.deepEqual(readSidebarOrder({getItem:()=>raw},'employee'),[...DEFAULT_SIDEBAR_ORDER]);
});
test('navigation separates actual destinations from focusable drag handles without invoking actions',()=>{
 let calls=0;const html=renderToStaticMarkup(<MemoryRouter><SidebarNavigation actorId="employee" label="Personal workspace sections" items={[{id:'profile',label:'My profile',href:'/profile',icon:UserRound},{id:'dashboard',label:'Dashboard',onSelect:()=>calls++,icon:LayoutDashboard,active:true},{id:'learning',label:'Learn & Grow',href:'/learning',icon:BookOpen}]}/></MemoryRouter>);
 assert.ok(html.indexOf('data-nav-id="dashboard"')<html.indexOf('data-nav-id="learning"'));assert.ok(html.indexOf('data-nav-id="learning"')<html.indexOf('data-nav-id="profile"'));
 assert.match(html,/aria-label="Reorder Learn &amp; Grow"/);assert.match(html,/aria-label="Reset sidebar order"/);assert.match(html,/aria-current="page"/);assert.equal(calls,0);
});
