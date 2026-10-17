// Local CPU comparison for derived profile data, not browser or hosted latency.
// Run: node --import tsx apps/web/test/skill-profile-benchmark.ts
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSkillProfileIndex, filterSkillProfile } from '../src/skill-profile-index';
import type { Claim } from '../src/MySkills';

function previousRender(claims: Claim[], query: string) {
  const approved = claims.filter(c => c.status === 'APPROVED').length;
  const pending = claims.filter(c => c.status === 'SUBMITTED').length;
  const drafts = claims.filter(c => c.status === 'DRAFT').length;
  const attention = claims.filter(c => ['CHANGES_REQUESTED', 'REJECTED'].includes(c.status)).length;
  const categories = Array.from(new Set(claims.map(c => c.category))).sort();
  const levels = Array.from(new Set(claims.map(c => c.rank))).sort((a, b) => a - b);
  const filtered = claims.filter(
    c =>
      !query ||
      [c.skillName ?? '', c.category ?? '', c.levelName ?? ''].some(text =>
        text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
  );
  const categoryCounts = categories
    .map(name => ({ name, count: claims.filter(c => c.category === name).length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return (
    approved +
    pending +
    drafts +
    attention +
    levels.length +
    categoryCounts.length +
    filtered.length
  );
}
function median(action: () => number) {
  const samples: number[] = [];
  let result = 0;
  for (let round = 0; round < 7; round++) {
    const start = performance.now();
    result = action();
    if (round > 1) samples.push(performance.now() - start);
  }
  return { ms: Number(samples.sort((a, b) => a - b)[2].toFixed(2)), result };
}
for (const count of [200, 2000]) {
  const statuses: Claim['status'][] = [
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'CHANGES_REQUESTED',
    'REJECTED',
  ];
  const claims = Array.from(
    { length: count },
    (_, i) =>
      ({
        id: String(i),
        skillName: `Skill ${i}`,
        category: `Category ${i % 50}`,
        levelName: `Level ${(i % 4) + 1}`,
        rank: (i % 4) + 1,
        status: statuses[i % 5],
      }) as Claim,
  );
  const queries = Array.from({ length: 50 }, (_, i) => `skill ${i}`);
  const baseline = median(() =>
    queries.reduce((sum, query) => sum + previousRender(claims, query), 0),
  );
  const indexed = median(() => {
    // Include index construction once, just as useMemo rebuilds for a new snapshot.
    const index = createSkillProfileIndex(claims);
    const summary =
      index.approved +
      index.pending +
      index.drafts +
      index.attention +
      index.levels.length +
      index.categoryCounts.length;
    return queries.reduce(
      (sum, query) =>
        sum +
        summary +
        filterSkillProfile(index, { query, category: '', status: '', rank: '', tab: 'all' }).length,
      0,
    );
  });
  assert.equal(indexed.result, baseline.result);
  console.log(
    JSON.stringify({
      claims: count,
      categories: 50,
      searches: queries.length,
      baselineMs: baseline.ms,
      indexedMs: indexed.ms,
    }),
  );
}
