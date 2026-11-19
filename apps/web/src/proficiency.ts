export const proficiencyNames = ['Beginner', 'Autonomous', 'Experienced', 'Expert'] as const;

export function displayProficiencyName(rank: number, name: string) {
  return rank === 1 && name === 'Foundation' ? proficiencyNames[0] : name;
}
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
