export const proficiencyNames = ['Foundation', 'Autonomous', 'Experienced', 'Expert'] as const;
export interface ProficiencyCriterion {
  rank: number;
  name: string;
  description: string;
}
export function standardLevels(existing: ProficiencyCriterion[] = []): ProficiencyCriterion[] {
  return proficiencyNames.map((name, index) => ({
    rank: index + 1,
    name,
    description: isStandardFramework(existing) ? existing[index].description : '',
  }));
}
export function isStandardFramework(levels: ProficiencyCriterion[]): boolean {
  return (
    levels.length === proficiencyNames.length &&
    levels.every(
      (level, index) => level.rank === index + 1 && level.name === proficiencyNames[index],
    )
  );
}
