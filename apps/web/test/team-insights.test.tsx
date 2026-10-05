import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {TeamReportAnalytics} from '../src/team-reports';
import {demandPrompt,memberLevel,membersWithoutReviewedSkills,skillProfiles,teamAverageLevel} from '../src/team-insights';
import {escapeHtml,teamReportHtml} from '../src/team-report-document';

const analytics:TeamReportAnalytics={members:4,reviewed:5,pending:2,coverage:[
 {skillName:'Azure',rank:1,people:3,memberIds:['a','b','c']},
 {skillName:'Azure',rank:2,people:2,memberIds:['a','b']},
 {skillName:'Azure',rank:3,people:1,memberIds:['a']},
 {skillName:'SQL <script>',rank:1,people:2,memberIds:['a','b']},
 {skillName:'SQL <script>',rank:2,people:2,memberIds:['a','b']},
],levels:[{rank:1,count:1,memberIds:['c']},{rank:2,count:3,memberIds:['a','b']},{rank:3,count:1,memberIds:['a']}],categories:[{category:'Cloud',count:5}]};

test('skill profiles derive exact level counts, averages and coverage from cumulative thresholds',()=>{
 assert.deepEqual(skillProfiles(analytics),[
  {skill:'Azure',holders:3,percent:75,average:2,atLevel:[1,1,1,0,0]},
  {skill:'SQL <script>',holders:2,percent:50,average:2,atLevel:[0,2,0,0,0]},
 ]);
 assert.equal(memberLevel(analytics,'Azure','a'),3);assert.equal(memberLevel(analytics,'Azure','c'),1);assert.equal(memberLevel(analytics,'Azure','d'),0);
 assert.equal(membersWithoutReviewedSkills(analytics),1);assert.equal(teamAverageLevel(analytics),2);
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
 assert.match(html,/Search “Cloud &quot;team&quot;”/);
 assert.doesNotMatch(html,/memberIds|"a","b"/);
 assert.match(html,/not proof of a skill deficiency/);assert.match(html,/window\.print/);
 assert.doesNotMatch(html,/https?:\/\//);
 assert.equal(escapeHtml(`<&"'>`),'&lt;&amp;&quot;&#39;&gt;');
});
