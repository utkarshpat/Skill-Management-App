export interface TeamPerson {
  id: string;
  name: string;
  employeeCode: string;
  reviewed: number;
  pending: number;
}
export interface TeamSkill {
  personId: string;
  skillName: string;
  category: string;
  rank: number;
  levelName: string;
  status: 'APPROVED' | 'SUBMITTED';
}
export function teamAnalytics(people: TeamPerson[], skills: TeamSkill[], minimumRank: number) {
  const reviewed = people.reduce((n, p) => n + p.reviewed, 0),
    pending = people.reduce((n, p) => n + p.pending, 0);
  const categories = new Map<string, number>();
  const coverage = new Map<string, Set<string>>();
  const levels = new Map<number, number>();
  const allowed = new Set(people.map(p => p.id));
  for (const skill of skills) {
    if (!allowed.has(skill.personId) || skill.status !== 'APPROVED') continue;
    categories.set(skill.category, (categories.get(skill.category) ?? 0) + 1);
    levels.set(skill.rank, (levels.get(skill.rank) ?? 0) + 1);
    if (skill.rank >= minimumRank) {
      const owners = coverage.get(skill.skillName) ?? new Set<string>();
      owners.add(skill.personId);
      coverage.set(skill.skillName, owners);
    }
  }
  return {
    reviewed,
    pending,
    totalClaims: reviewed + pending,
    reviewedPercent: reviewed + pending ? Math.round((reviewed / (reviewed + pending)) * 100) : 0,
    categories: [...categories]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    levels: [...levels].map(([rank, count]) => ({ rank, count })).sort((a, b) => a.rank - b.rank),
    coverage: [...coverage]
      .map(([skill, owners]) => ({
        skill,
        count: owners.size,
        percent: people.length ? Math.round((owners.size / people.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill)),
  };
}
