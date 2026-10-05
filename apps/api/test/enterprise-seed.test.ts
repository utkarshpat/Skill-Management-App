import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {validateEnterpriseSeed,seedPayload,seedPlan,alignmentPlan} from '../src/modules/skills/enterprise-seed.js';
import {proficiencyNames} from '../src/modules/skills/proficiency.js';
import type {CatalogueSkill} from '../src/modules/skills/skill-catalogue.js';
const source=JSON.parse(await readFile(new URL('../../../database/seeds/enterprise-catalogue-v1.json',import.meta.url),'utf8'));
test('enterprise seed has 70 definitions, ten categories and five skill-specific criteria',()=>{
 const seed=validateEnterpriseSeed(source);assert.equal(seed.skills[0].description,'Development of applications and services using the Java programming language and JVM ecosystem.');assert.equal(seed.skills[69].code,'SKL-070');
 assert.equal(seed.framework.levels[2].name,'Intermediate');
 assert.deepEqual(seedPayload(seed,seed.skills[0]).levels.map(level=>level.name),proficiencyNames);
 assert.equal(seedPayload(seed,seed.skills[0]).levels[2].description,seed.skills[0].criteria[2].description);
 for(const edit of [()=>{source.skills[1].code='SKL-001';},()=>{source.skills[1].criteria[0].rank=2;},()=>{source.skills[1].description='';}]){
  const backup=structuredClone(source);edit();assert.throws(()=>validateEnterpriseSeed(source));Object.assign(source,backup);
 }
});
test('alignment maps all five ranks, retains metadata/criteria, leaves sources immutable and is idempotent',()=>{
 const seed=validateEnterpriseSeed(source),skill:CatalogueSkill={...seedPayload(seed,seed.skills[0]),id:'00000000-0000-4000-8000-000000000003',status:'ARCHIVED',levels:seed.skills[0].criteria.map((criterion,index)=>({...criterion,name:seed.framework.levels[index].name}))};
 const before=structuredClone(skill),changes=alignmentPlan([skill]);
 assert.equal(changes.length,1);assert.equal(changes[0].id,skill.id);assert.equal(changes[0].payload.status,'ARCHIVED');assert.equal(changes[0].payload.businessCode,'SKL-001');
 assert.deepEqual(changes[0].payload.levels.map(level=>level.name),proficiencyNames);
 assert.deepEqual(changes[0].payload.levels.map(level=>level.description),skill.levels.map(level=>level.description));
 assert.deepEqual(skill,before);assert.equal(alignmentPlan([{...skill,...changes[0].payload}]).length,0);
 assert.throws(()=>alignmentPlan([{...skill,levels:skill.levels.slice(0,3)}]),/manual.*No bulk/);
 assert.throws(()=>alignmentPlan([{...skill,levels:skill.levels.map(level=>({...level,rank:6-level.rank}))}]),/manual/);
});
test('seed preserves customized codes and blocks name collisions before any writes',()=>{
 const seed=validateEnterpriseSeed(source);
 const plan=seedPlan(seed,[{businessCode:'SKL-001',name:'Customized Java'}]);assert.equal(plan.preserve.length,1);assert.equal(plan.create.length,69);
 assert.throws(()=>seedPlan(seed,[{businessCode:null,name:'JAVA'}]),/conflicts/);
 assert.equal(seedPlan(seed,seed.skills.map(skill=>({businessCode:skill.code,name:skill.name}))).create.length,0);
});
