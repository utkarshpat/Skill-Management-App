import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import type {TeamReportAnalytics} from '../src/team-reports';
import {demandPrompt,memberLevel,membersWithoutReviewedSkills,skillProfiles,teamAverageLevel} from '../src/team-insights';
import {escapeHtml,teamReportHtml} from '../src/team-report-document';
import {TeamInsightCharts} from '../src/TeamInsightCharts';
import {coverageRows} from '../src/team-reports';
import {indexCoverage} from '../src/team-coverage';

const analytics:TeamReportAnalytics={members:4,reviewed:5,pending:2,coverage:[
 {skillName:'Azure',rank:1,people:3,memberIds:['a','b','c']},
 {skillName:'Azure',rank:2,people:2,memberIds:['a','b']},
 {skillName:'Azure',rank:3,people:1,memberIds:['a']},
 {skillName:'SQL <script>',rank:1,people:2,memberIds:['a','b']},
 {skillName:'SQL <script>',rank:2,people:2,memberIds:['a','b']},
],levels:[{rank:1,count:1,memberIds:['c']},{rank:2,count:3,memberIds:['a','b']},{rank:3,count:1,memberIds:['a']}],categories:[{category:'Cloud',count:5}]};

test('skill profiles derive level buckets, capped averages and coverage from cumulative thresholds',()=>{
 assert.deepEqual(skillProfiles(analytics),[
  {skill:'Azure',holders:3,percent:75,average:2,atLevel:[1,1,1,0,0]},
  {skill:'SQL <script>',holders:2,percent:50,average:2,atLevel:[0,2,0,0,0]},
 ]);
 assert.equal(memberLevel(analytics,'Azure','a'),3);assert.equal(memberLevel(analytics,'Azure','c'),1);assert.equal(memberLevel(analytics,'Azure','d'),0);
 assert.equal(membersWithoutReviewedSkills(analytics),1);assert.equal(teamAverageLevel(analytics),2);
});

test('chart shows a full gap when a reviewed skill has no holders at the selected threshold',()=>{
 const fixture={...analytics,coverage:[{skillName:'JavaScript',rank:1,people:1,memberIds:['a']}]};
 const html=renderToStaticMarkup(<TeamInsightCharts analytics={fixture} people={[]} minimumRank={3} skillFilter="" onSkill={()=>{}} onPerson={()=>{}}/>);
 assert.match(html,/title="0 with coverage, 4 without"/);
 assert.match(html,/JavaScript<\/span>/);
 assert.doesNotMatch(html,/No reviewed skills at this level yet/);
 assert.deepEqual(coverageRows(fixture,3),[{skillName:'JavaScript',holders:0,percent:0,missing:4}]);
});

test('historical L8 claims use capped team metrics and heatmap discloses L5+',()=>{
 const fixture={...analytics,members:1,reviewed:1,coverage:[1,2,3,4,5].map(rank=>({skillName:'Legacy',rank,people:1,memberIds:['a']})),levels:[{rank:8,count:1,memberIds:['a']}]};
 assert.equal(teamAverageLevel(fixture),5);assert.equal(skillProfiles(fixture)[0].average,5);
 const html=renderToStaticMarkup(<TeamInsightCharts analytics={fixture} people={[{id:'a',name:'Asha',employeeCode:'A',reviewed:1,pending:0}]} minimumRank={3} skillFilter="" onSkill={()=>{}} onPerson={()=>{}}/>);
 assert.match(html,/aria-label="Asha, Legacy: reviewed L5\+"/);
 assert.match(html,/>L5<\/strong>/);assert.match(html,/Holder averages capped at L5/);
 assert.match(html,/not exact L5/);
 const report=teamReportHtml(fixture,'',new Date('2026-10-05T09:00:00Z'));
 assert.match(report,/capped at L5/);assert.match(report,/not exact L5/);
 assert.match(report,/>L5<\/b>/);assert.match(report,/L5\+/);
});

test('large coverage profiles and report rows reuse a linear index without repeated row scans',()=>{
 const rows=Array.from({length:25000},(_,i)=>({skillName:'Skill '+Math.floor(i/5),rank:i%5+1,people:1,memberIds:['a']}));
 let reads=0;
 const coverage=new Proxy(rows,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,receiver);}});
 const fixture={...analytics,coverage},index=indexCoverage(fixture),profiles=skillProfiles(fixture,index);
 assert.equal(profiles.length,5000);assert.ok(profiles.every(p=>p.average===5&&p.atLevel[4]===1));
 assert.equal(coverageRows(fixture,3,index).length,5000);
 assert.equal(memberLevel(fixture,'Skill 4999','a',index),5);
 assert.ok(reads<=rows.length*2,`Expected linear row reads, got ${reads}`);
});

test('AI demand prompt is bounded, uses the scoped tool and separates missing records from proven gaps',()=>{
 assert.match(demandPrompt('  2 people   at L3 in Azure '),/team_skill_gaps.*not saved.*2 people at L3 in Azure.*missing records from proven gaps/s);
 assert.ok(demandPrompt('x'.repeat(900)).length<700);
 assert.match(demandPrompt(''),/summarise/);
});

test('interactive report is self-contained, escaped and aggregate-only',()=>{
 const html=teamReportHtml(analytics,'Cloud "team"',new Date('2026-10-05T09:00:00Z'));
 assert.match(html,/Content-Security-Policy" content="default-src 'none'/);
 assert.doesNotMatch(html,/<script>[^(]*SQL|SQL <script>/);
 assert.match(html,/SQL &lt;script&gt;/);assert.match(html,/SQL \\u003cscript>/);
 assert.match(html,/Filtered current direct reports/);assert.doesNotMatch(html,/Cloud &quot;team&quot;/);
 assert.doesNotMatch(html,/memberIds|"a","b"/);
 assert.match(html,/not proof of a skill deficiency/);assert.match(html,/window\.print/);
 assert.doesNotMatch(html,/https?:\/\//);
 assert.equal(escapeHtml(`<&"'>`),'&lt;&amp;&quot;&#39;&gt;');
});


test('historical ranks use an explicit capped scale consistently and identifying searches stay out of exports',()=>{
 const legacy={...analytics,levels:[{rank:8,count:1,memberIds:['a']}],coverage:[1,2,3,4,5].map(rank=>({skillName:'Azure',rank,people:1,memberIds:['a']}))};
 assert.equal(teamAverageLevel(legacy),5);assert.equal(skillProfiles(legacy)[0].average,5);
 const html=teamReportHtml(legacy,'Private Employee Name',new Date());
 assert.doesNotMatch(html,/Private Employee Name/);assert.match(html,/capped at L5/);assert.match(html,/identifying/);
});


test('manager AI demand actions appear only when the server advertises availability',()=>{
 const props={analytics,people:[],minimumRank:3,skillFilter:'',onSkill:()=>{},onPerson:()=>{}};
 assert.doesNotMatch(renderToStaticMarkup(<TeamInsightCharts {...props}/>),/Skill demand for the AI assistant|Ask AI about gaps and demand/);
 assert.match(renderToStaticMarkup(<TeamInsightCharts {...props} canAskAi/>),/Skill demand for the AI assistant/);
});
