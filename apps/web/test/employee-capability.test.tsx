import test from 'node:test';
import assert from 'node:assert/strict';
import {assignedSkillClaim} from '../src/employee-capability';
import type {Claim} from '../src/MySkills';
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
