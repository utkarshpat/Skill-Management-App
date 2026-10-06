import type { Claim } from './MySkills';
import type { TeamSkill } from './team-analytics';
// A summary never authorizes opening a claim. Only a unique actor-bound
// assigned-history record may supply its ID; the detail API rechecks it.
export function assignedSkillClaim(skill: TeamSkill, claims: Claim[], personId: string) {
  const matches = claims.filter(
    c =>
      c.personId === personId &&
      c.skillName === skill.skillName &&
      c.category === skill.category &&
      c.status === skill.status &&
      c.rank === skill.rank,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
