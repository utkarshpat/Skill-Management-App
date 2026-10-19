export const proficiencyNames = ['Foundation', 'Autonomous', 'Experienced', 'Expert'] as const;
export const proficiencyCriteria = [
  'Understands fundamentals and completes routine work with guidance.',
  'Handles standard tasks independently and explains decisions.',
  'Resolves complex issues, evaluates trade-offs and guides colleagues.',
  'Defines standards and strategy and mentors experienced practitioners.',
] as const;
export function commonLevels(): { rank: number; name: string; description: string }[] {
  return proficiencyNames.map((name, index) => ({
    rank: index + 1,
    name,
    description: proficiencyCriteria[index],
  }));
}
export function hasStandardProficiency(levels: { rank: number; name: string }[]): boolean {
  return (
    levels.length === proficiencyNames.length &&
    levels.every(
      (level, index) => level.rank === index + 1 && level.name === proficiencyNames[index],
    )
  );
}
