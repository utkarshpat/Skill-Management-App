import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {validateEnterpriseSeed,seedPayload,seedPlan} from '../src/modules/skills/enterprise-seed.js';
const source=JSON.parse(await readFile(new URL('../../../database/seeds/enterprise-catalogue-v1.json',import.meta.url),'utf8'));
test('enterprise seed has 70 definitions, ten categories and five skill-specific criteria',()=>{
 const seed=validateEnterpriseSeed(source);assert.equal(seed.skills[0].description,'Development of applications and services using the Java programming language and JVM ecosystem.');assert.equal(seed.skills[69].code,'SKL-070');
 assert.equal(seedPayload(seed,seed.skills[0]).levels[2].name,'Intermediate');
 for(const edit of [()=>{source.skills[1].code='SKL-001';},()=>{source.skills[1].criteria[0].rank=2;},()=>{source.skills[1].description='';}]){
  const backup=structuredClone(source);edit();assert.throws(()=>validateEnterpriseSeed(source));Object.assign(source,backup);
 }
});
test('seed preserves customized codes and blocks name collisions before any writes',()=>{
 const seed=validateEnterpriseSeed(source);
 const plan=seedPlan(seed,[{businessCode:'SKL-001',name:'Customized Java'}]);assert.equal(plan.preserve.length,1);assert.equal(plan.create.length,69);
 assert.throws(()=>seedPlan(seed,[{businessCode:null,name:'JAVA'}]),/conflicts/);
 assert.equal(seedPlan(seed,seed.skills.map(skill=>({businessCode:skill.code,name:skill.name}))).create.length,0);
});
