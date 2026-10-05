import test from 'node:test';
import assert from 'node:assert/strict';
import {assignedSkillClaim} from '../src/employee-capability';
import type {Claim} from '../src/MySkills';
import {renderToStaticMarkup} from 'react-dom/server';
import {EmployeeSkillCards} from '../src/EmployeeSkillCards';
const skill={personId:'employee',skillName:'Java',category:'Programming',rank:3,levelName:'Intermediate',status:'APPROVED' as const};
const claim={id:'claim',personId:'employee',skillName:'Java',category:'Programming',rank:3,status:'APPROVED'} as Claim;
test('Employee summary links only to a unique matching assigned record',()=>{
 assert.equal(assignedSkillClaim(skill,[claim],'employee')?.id,'claim');
 assert.equal(assignedSkillClaim(skill,[{...claim,personId:'other'}],'employee'),undefined);
 assert.equal(assignedSkillClaim(skill,[{...claim,status:'DRAFT'}],'employee'),undefined);
 assert.equal(assignedSkillClaim(skill,[{...claim,rank:4}],'employee'),undefined);
 assert.equal(assignedSkillClaim(skill,[claim,{...claim,id:'duplicate'}],'employee'),undefined);
 assert.equal(assignedSkillClaim(skill,[],'employee'),undefined);
});

test('Capability cards retain actor-bound assigned-record gating and claimed/reviewed distinction',()=>{
 const record={...claim,updatedAt:'2026-10-05T10:00:00Z'};
 const render=(canRead:boolean,assigned:Claim[],skills=[skill])=>renderToStaticMarkup(<EmployeeSkillCards skills={skills} assigned={assigned} personId="employee" canRead={canRead} loading={false} opening={false} onOpen={()=>{}}/>);
 assert.match(render(true,[record]),/Evidence &amp; history/);
 assert.doesNotMatch(render(false,[record]),/<button/);
 assert.doesNotMatch(render(true,[{...record,personId:'other'}]),/<button/);
 assert.doesNotMatch(render(true,[record,{...record,id:'ambiguous'}]),/<button/);
 const pending={...skill,status:'SUBMITTED' as const};
 const pendingHtml=renderToStaticMarkup(<EmployeeSkillCards skills={[pending]} assigned={[{...record,status:'SUBMITTED'}]} personId="employee" canRead loading={false} opening={false} onOpen={()=>{}}/>);
 assert.match(pendingHtml,/Open review/);
 assert.match(pendingHtml,/Employee’s claimed level/);
 assert.doesNotMatch(pendingHtml,/Recorded reviewed level/);
 assert.doesNotMatch(render(true,[record],[{...skill,personId:'other',skillName:'Private other skill'}]),/Private other skill/);
});
