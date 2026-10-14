import type { SkillChoice, SkillChoices } from '../SkillClaimWizard';

export async function resolveIntakeSkill(
  target: { id?: string; name?: string },
  read: (path: string) => Promise<SkillChoices>,
) {
  // Names narrow the lookup; only a matching canonical ID may satisfy an ID link.
  const searches = target.id && target.name ? [target.name, ''] : [target.name ?? ''];
  for (const search of searches) {
    for (let page = 1; ; page++) {
      const result = await read(
        '/api/my-skills/catalogue?search=' +
          encodeURIComponent(search) +
          '&page=' +
          page +
          '&pageSize=25',
      );
      const found = result.skills.find((s: SkillChoice) =>
        target.id
          ? s.id.toLowerCase() === target.id.toLowerCase()
          : s.name.localeCompare(target.name ?? '', undefined, { sensitivity: 'accent' }) === 0,
      );
      if (found) return found;
      if (!result.skills.length || page * result.pageSize >= result.total) break;
    }
  }
  return undefined;
}
