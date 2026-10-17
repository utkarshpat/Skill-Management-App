import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillProfileIndex, filterSkillProfile } from '../src/skill-profile-index';
import type { Claim } from '../src/MySkills';

const statuses: Claim['status'][] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
];
const claims = Array.from(
  { length: 100 },
  (_, i) =>
    ({
      id: String(i),
      skillName: `Skill ${i}`,
      category: i % 2 ? 'Cloud' : 'Programming',
      levelName: i % 3 ? 'Intermediate' : 'Beginner',
      rank: (i % 4) + 1,
      status: statuses[i % statuses.length],
    }) as Claim,
);

test('indexed profile search preserves field matching, row order and every combined filter', () => {
  const index = createSkillProfileIndex(claims);
  for (const query of ['', '  SKILL 1 ', 'cloud', 'beginner', 'missing', 'Skill 0 Programming'])
    for (const category of ['', 'Cloud'])
      for (const status of ['', ...statuses])
        for (const rank of ['', '2'])
          for (const tab of ['all', 'reviewed', 'attention']) {
            const expected = claims.filter(
              c =>
                (!query ||
                  [c.skillName, c.category, c.levelName].some(text =>
                    text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
                  )) &&
                (!category || category === c.category) &&
                (!status || status === c.status) &&
                (!rank || Number(rank) === c.rank) &&
                (tab === 'all' ||
                  (tab === 'reviewed' && c.status === 'APPROVED') ||
                  (tab === 'attention' &&
                    ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(c.status))),
            );
            assert.deepEqual(
              filterSkillProfile(index, { query, category, status, rank, tab }),
              expected,
            );
          }
});

test('profile summaries count all statuses and refresh when claims change', () => {
  const index = createSkillProfileIndex(claims);
  assert.deepEqual(
    [index.approved, index.pending, index.drafts, index.attention],
    [20, 20, 20, 40],
  );
  assert.deepEqual(index.categories, ['Cloud', 'Programming']);
  assert.deepEqual(index.levels, [1, 2, 3, 4]);
  assert.deepEqual(index.categoryCounts, [
    { name: 'Cloud', count: 50 },
    { name: 'Programming', count: 50 },
  ]);
  const updated = createSkillProfileIndex([
    { ...claims[0], skillName: 'Changed', category: 'New category', status: 'APPROVED' },
  ]);
  assert.equal(updated.approved, 1);
  assert.equal(updated.drafts, 0);
  assert.deepEqual(updated.categories, ['New category']);
  const filters = { query: 'changed', category: '', status: '', rank: '', tab: 'all' };
  assert.equal(filterSkillProfile(updated, filters).length, 1);
  assert.equal(filterSkillProfile(index, filters).length, 0);
  assert.equal(createSkillProfileIndex([]).rows.length, 0);
});
