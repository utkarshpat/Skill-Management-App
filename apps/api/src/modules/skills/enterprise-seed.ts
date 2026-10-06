import { catalogueChange } from './skill-catalogue.js';
import { hasStandardProficiency, proficiencyNames } from './proficiency.js';
import type { CatalogueSkill } from './skill-catalogue.js';

export interface SeedSkill {
  code: string;
  name: string;
  category: string;
  description: string;
  criteria: { rank: number; description: string }[];
}
export interface EnterpriseSeed {
  version: 1;
  framework: {
    key: 'enterprise-v1';
    levels: { rank: number; name: string; description: string }[];
  };
  skills: SeedSkill[];
}
const labels = ['Awareness', 'Beginner', 'Intermediate', 'Advanced', 'Expert'];
export function validateEnterpriseSeed(input: unknown): EnterpriseSeed {
  const seed = input as EnterpriseSeed;
  if (
    !seed ||
    seed.version !== 1 ||
    seed.framework?.key !== 'enterprise-v1' ||
    !Array.isArray(seed.framework.levels) ||
    seed.framework.levels.length !== 5 ||
    !Array.isArray(seed.skills) ||
    seed.skills.length !== 70
  )
    throw Error('Expected the reviewed 70-skill enterprise-v1 catalogue.');
  for (const [index, level] of seed.framework.levels.entries())
    if (
      level.rank !== index + 1 ||
      level.name !== labels[index] ||
      typeof level.description !== 'string' ||
      !level.description.trim() ||
      level.description.length > 1000
    )
      throw Error('Invalid common framework.');
  const names = new Set<string>();
  for (const [index, skill] of seed.skills.entries()) {
    if (
      skill.code !== `SKL-${String(index + 1).padStart(3, '0')}` ||
      !Array.isArray(skill.criteria) ||
      skill.criteria.length !== 5
    )
      throw Error('Seed codes must run from SKL-001 through SKL-070 with five criteria.');
    catalogueChange({ revision: 1, ...seedPayload(seed, skill) });
    const name = skill.name.trim().toLowerCase();
    if (names.has(name)) throw Error('Seed skill names must be unique.');
    names.add(name);
  }
  if (new Set(seed.skills.map(skill => skill.category)).size !== 10)
    throw Error('Expected ten catalogue categories.');
  return seed;
}
export function seedPayload(seed: EnterpriseSeed, skill: SeedSkill) {
  return {
    businessCode: skill.code,
    name: skill.name,
    category: skill.category,
    description: skill.description,
    status: 'PUBLISHED' as const,
    levels: skill.criteria.map((criterion, index) => ({
      ...criterion,
      name: proficiencyNames[index],
    })),
  };
}
export function alignmentPlan(existing: CatalogueSkill[]) {
  const changes = existing
    .filter(skill => !hasStandardProficiency(skill.levels))
    .map(skill => {
      if (
        skill.levels.length !== 5 ||
        skill.levels.some((level, index) => level.rank !== index + 1)
      )
        throw Error(
          `${skill.name} needs manual five-level criteria mapping. No bulk alignment will be applied.`,
        );
      const levels = skill.levels.map((level, index) => ({
        ...level,
        name: proficiencyNames[index],
      }));
      const change = catalogueChange({ ...skill, levels, revision: 1 });
      return {
        id: skill.id,
        before: skill.levels.map(level => level.name),
        payload: { ...change.payload, businessCode: skill.businessCode },
      };
    });
  return changes;
}
export function seedPlan(
  seed: EnterpriseSeed,
  existing: { businessCode: string | null; name: string }[],
) {
  const create: SeedSkill[] = [],
    preserve: SeedSkill[] = [];
  for (const skill of seed.skills) {
    if (existing.some(row => row.businessCode === skill.code)) {
      preserve.push(skill);
      continue;
    }
    if (existing.some(row => row.name.trim().toLowerCase() === skill.name.toLowerCase()))
      throw Error(
        `Existing name conflicts with ${skill.code}. Resolve it explicitly; no existing skill will be overwritten.`,
      );
    create.push(skill);
  }
  return { create, preserve };
}
