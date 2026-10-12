export const proficiencyNames = ['Foundation', 'Autonomous', 'Experienced', 'Expert'] as const;
export function hasStandardProficiency(levels: { rank: number; name: string }[]): boolean {
  return (
    levels.length === proficiencyNames.length &&
    levels.every(
      (level, index) => level.rank === index + 1 && level.name === proficiencyNames[index],
    )
  );
}
