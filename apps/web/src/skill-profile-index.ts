import type { Claim } from './MySkills';

// Derived display data only. Rebuild for each fresh claims array; no access decisions are cached.
export function createSkillProfileIndex(claims: Claim[]) {
  let approved = 0,
    pending = 0,
    drafts = 0,
    attention = 0;
  const categoryTotals = new Map<string, number>();
  const ranks = new Set<number>();
  const rows = claims.map(claim => {
    if (claim.status === 'APPROVED') approved++;
    else if (claim.status === 'SUBMITTED') pending++;
    else if (claim.status === 'DRAFT') drafts++;
    else if (claim.status === 'CHANGES_REQUESTED' || claim.status === 'REJECTED') attention++;
    categoryTotals.set(claim.category, (categoryTotals.get(claim.category) ?? 0) + 1);
    ranks.add(claim.rank);
    return {
      claim,
      search: [claim.skillName ?? '', claim.category ?? '', claim.levelName ?? ''].map(text =>
        text.toLocaleLowerCase(),
      ),
    };
  });
  return {
    rows,
    approved,
    pending,
    drafts,
    attention,
    categories: [...categoryTotals.keys()].sort(),
    levels: [...ranks].sort((a, b) => a - b),
    categoryCounts: [...categoryTotals]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function filterSkillProfile(
  index: ReturnType<typeof createSkillProfileIndex>,
  filters: { query: string; category: string; status: string; rank: string; tab: string },
) {
  const query = filters.query.trim().toLocaleLowerCase();
  const rank = filters.rank ? Number(filters.rank) : undefined;
  return index.rows
    .filter(
      ({ claim, search }) =>
        (!query || search.some(text => text.includes(query))) &&
        (!filters.category || filters.category === claim.category) &&
        (!filters.status || filters.status === claim.status) &&
        (rank === undefined || rank === claim.rank) &&
        (filters.tab === 'all' ||
          (filters.tab === 'reviewed' && claim.status === 'APPROVED') ||
          (filters.tab === 'attention' &&
            ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(claim.status))),
    )
    .map(row => row.claim);
}
