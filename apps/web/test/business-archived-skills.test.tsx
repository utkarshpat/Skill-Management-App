import assert from 'node:assert/strict';
import test from 'node:test';
import { mappedSkillLabel, unavailableMappedSkills } from '../src/business/business-model';

const known = {
  a: { name: 'Alpha', active: true },
  b: { name: 'Beta', active: false },
};

test('unavailableMappedSkills names only archived skills', () => {
  assert.deepEqual(unavailableMappedSkills(['a', 'b', 'unknown'], known), ['Beta']);
  assert.deepEqual(unavailableMappedSkills(['a'], known), []);
});

test('mappedSkillLabel marks archived and unknown skills', () => {
  assert.equal(mappedSkillLabel('a', known), 'Alpha');
  assert.equal(mappedSkillLabel('b', known), 'Beta (archived)');
  assert.equal(mappedSkillLabel('zzz', known), 'selected skill');
});
