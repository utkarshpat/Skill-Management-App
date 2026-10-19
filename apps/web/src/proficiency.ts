export const proficiencyNames = ['Foundation', 'Autonomous', 'Experienced', 'Expert'] as const;
export const proficiencyCriteria = [
  'Understands fundamentals and completes routine work with guidance.',
  'Handles standard tasks independently and explains decisions.',
  'Resolves complex issues, evaluates trade-offs and guides colleagues.',
  'Defines standards and strategy and mentors experienced practitioners.',
] as const;
export function commonLevels(): ProficiencyCriterion[] {
  return proficiencyNames.map((name, index) => ({
    rank: index + 1,
    name,
    description: proficiencyCriteria[index],
  }));
}
export interface ProficiencyCriterion {
  rank: number;
  name: string;
  description: string;
}
