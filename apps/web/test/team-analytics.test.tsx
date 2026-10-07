import test from 'node:test';
import assert from 'node:assert/strict';
import { teamAnalytics, type TeamSkill } from '../src/team-analytics';
test('Coverage deduplicates reviewed holders and excludes pending and outside members', () => {
  const people = [
    { id: 'a', name: 'A', employeeCode: 'A', reviewed: 2, pending: 1 },
    { id: 'b', name: 'B', employeeCode: 'B', reviewed: 1, pending: 0 },
  ];
  const skill = (
    personId: string,
    rank: number,
    status: TeamSkill['status'] = 'APPROVED',
  ): TeamSkill => ({
    personId,
    skillName: 'Java',
    category: 'Programming',
    rank,
    levelName: 'Level',
    status,
  });
  const result = teamAnalytics(
    people,
    [skill('a', 3), skill('a', 4), skill('b', 2), skill('b', 5, 'SUBMITTED'), skill('outside', 5)],
    3,
  );
  assert.deepEqual(result.coverage, [{ skill: 'Java', count: 1, percent: 50 }]);
  assert.equal(result.reviewed, 3);
  assert.equal(result.pending, 1);
  assert.equal(result.reviewedPercent, 75);
  assert.deepEqual(result.levels, [
    { rank: 2, count: 1 },
    { rank: 3, count: 1 },
    { rank: 4, count: 1 },
  ]);
  assert.deepEqual(result.categories, [{ label: 'Programming', count: 3 }]);
});
test('Empty team does not manufacture percentages or capability scores', () => {
  const result = teamAnalytics([], [], 1);
  assert.equal(result.totalClaims, 0);
  assert.equal(result.reviewedPercent, 0);
  assert.deepEqual(result.coverage, []);
});
