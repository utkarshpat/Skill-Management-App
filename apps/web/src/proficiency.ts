export const proficiencyNames = [
  'Awareness',
  'Foundation',
  'Practitioner',
  'Advanced',
  'Expert',
] as const;
export interface ProficiencyCriterion {
  rank: number;
  name: string;
  description: string;
}
export function standardLevels(existing: ProficiencyCriterion[] = []): ProficiencyCriterion[] {
  return proficiencyNames.map((name, index) => ({
    rank: index + 1,
    name,
    description: existing.find(level => level.rank === index + 1)?.description ?? '',
  }));
}
export function isStandardFramework(levels: ProficiencyCriterion[]): boolean {
  return (
    levels.length === 5 &&
    levels.every(
      (level, index) => level.rank === index + 1 && level.name === proficiencyNames[index],
    )
  );
}
