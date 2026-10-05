import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalAccessStore} from '../src/modules/access/local-access-store.js';
import {ToolRegistry} from '../src/modules/ai/tool-registry.js';
import {teamGapArguments,teamGapReport} from '../src/modules/skills/team-gaps.js';
import type {ClaimsStore,TeamCapability} from '../src/modules/skills/claims.js';

const analytics:NonNullable<TeamCapability['analytics']>={members:4,reviewed:5,pending:1,categories:[{category:'Engineering',count:5}],levels:[],coverage:[
 {skillName:'React',rank:1,people:3,memberIds:['a','b','c']},{skillName:'React',rank:2,people:3,memberIds:['a','b','c']},{skillName:'React',rank:3,people:2,memberIds:['a','b']},{skillName:'React',rank:4,people:1,memberIds:['a']},
 {skillName:'React Native',rank:1,people:1,memberIds:['d']},
 {skillName:'SQL',rank:1,people:1,memberIds:['c']},
]};
const names:Record<string,string>={a:'Asha',b:'Bala',c:'Chen',d:'Dev'};

test('team gap arguments reject actor/scope selection and invalid demand',()=>{
 assert.deepEqual(teamGapArguments({requirements:[{skill:' React ',level:4}]}),{search:'',requirements:[{skill:'React',level:4,headcount:1}]});
 for(const bad of [{personId:'x'},{managerId:'x'},{requirements:[{skill:'React',level:6}]},{requirements:[{skill:'',level:2}]},{requirements:[{skill:'React',level:2,headcount:0}]},{requirements:[{skill:'React',level:2,person:'x'}]},{requirements:Array(11).fill({skill:'A',level:1})}])assert.throws(()=>teamGapArguments(bad));
});

test('requirement gaps report qualified people, shortfall, near-miss and unknown skills without inventing proficiency',()=>{
 const report=teamGapReport(analytics,[{skill:'react',level:4,headcount:3},{skill:'SQL',level:1,headcount:1},{skill:'Rust',level:2,headcount:1},{skill:'reac',level:1,headcount:1}],id=>names[id]);
 const [react,sql,rust,ambiguous]=report.requirements as any[];
 assert.equal(react.status,'SHORTFALL');assert.equal(react.matchedSkill,'React');assert.deepEqual(react.qualified.people,['Asha']);assert.equal(react.shortfall,2);assert.deepEqual(react.oneLevelBelow.people,['Bala']);
 assert.equal(sql.status,'MET');assert.equal(sql.shortfall,0);
 assert.equal(rust.status,'NO_REVIEWED_RECORD');assert.match(rust.note,/not proof/);
 assert.equal(ambiguous.status,'AMBIGUOUS');assert.deepEqual(ambiguous.candidates,['React','React Native']);
 assert.equal(report.membersWithoutReviewedSkills,0);
 const profile=report.teamSkills.find(s=>s.skill==='React')!;assert.equal(profile.averageLevel,3);assert.deepEqual(profile.atLevel.map(l=>l.people),[0,1,1,1,0]);
 assert.match(report.basis,/not saved/);
});

test('team_skill_gaps requires direct-report review authority, binds the actor and rejects stale assignments',async()=>{
 const access=await LocalAccessStore.open(),state=access.snapshot(),person=state.people[0];access.snapshot=()=>structuredClone(state);
 let actor='',bump=false;
 const claims:ClaimsStore={read:async()=>({claims:[],total:0,page:1,pageSize:25,canClaim:false}),options:async()=>({skills:[],total:0,page:1,pageSize:25}),save:async()=>{},
  team:async id=>{actor=id;if(bump)state.revision++;return {total:4,page:1,pageSize:12,scope:'DIRECT_REPORTS',people:[],skills:[],analytics};}};
 const registry=new ToolRegistry(access,undefined,claims),signal=AbortSignal.timeout(5000);
 person.overrides.push({permission:'skill.view',scope:'ORGANIZATION',effect:'DENY'});
 assert.ok(!registry.available(access.snapshot(),access.snapshot().people[0]).some(t=>t.function.name==='team_skill_gaps'));
 await assert.rejects(registry.execute(person.id,'team_skill_gaps',{},signal),/permission/);assert.equal(actor,'');
 person.overrides.pop();person.hasDirectReports=true;person.overrides.push({permission:'skill.view',scope:'ORGANIZATION',effect:'ALLOW'},{permission:'skill.verify',scope:'ORGANIZATION',effect:'ALLOW'});
 assert.ok(registry.available(access.snapshot(),access.snapshot().people[0]).some(t=>t.function.name==='team_skill_gaps'));
 const result=await registry.execute(person.id,'team_skill_gaps',{requirements:[{skill:'React',level:3,headcount:2}]},signal);
 assert.equal(actor,person.id);assert.equal((result.data as any).requirements[0].status,'MET');assert.equal(result.source.url,'/skill-reviews');
 await assert.rejects(registry.execute(person.id,'team_skill_gaps',{personId:person.id},signal));
 bump=true;await assert.rejects(registry.execute(person.id,'team_skill_gaps',{},signal),/changed/);
});
