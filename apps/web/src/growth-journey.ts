import type { Plan, Task } from './Learning';
import type { Claim } from './MySkills';

export type GrowthJourneyNextStep =
  | { kind: 'CONTINUE_TASK'; task: Task }
  | { kind: 'RESUME_PLAN' }
  | { kind: 'OPEN_PLAN' }
  | { kind: 'CREATE_CLAIM' }
  | { kind: 'CLAIM_ACCESS_REQUIRED' }
  | { kind: 'EDIT_CLAIM'; claim: Claim }
  | { kind: 'SUBMIT_CLAIM'; claim: Claim }
  | { kind: 'VIEW_CLAIM'; claim: Claim }
  | { kind: 'NO_TASKS' };

export function latestClaimForSkill(claims: Claim[], skillId: string) {
  return claims
    .filter(claim => claim.skillId.toLowerCase() === skillId.toLowerCase())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function growthJourneyNextStep(
  plan: Plan,
  claim: Claim | undefined,
  canClaim: boolean,
  canManage: boolean,
): GrowthJourneyNextStep {
  if (claim) {
    if (claim.status === 'DRAFT')
      return canClaim ? { kind: 'SUBMIT_CLAIM', claim } : { kind: 'VIEW_CLAIM', claim };
    if (claim.status === 'CHANGES_REQUESTED' || claim.status === 'REJECTED')
      return canClaim ? { kind: 'EDIT_CLAIM', claim } : { kind: 'VIEW_CLAIM', claim };
    return { kind: 'VIEW_CLAIM', claim };
  }
  if (plan.tasks.length === 0) return { kind: 'NO_TASKS' };
  const nextTask = plan.tasks
    .filter(task => !task.completedAt)
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0];
  if (nextTask)
    return plan.status === 'PAUSED'
      ? canManage
        ? { kind: 'RESUME_PLAN' }
        : { kind: 'OPEN_PLAN' }
      : { kind: 'CONTINUE_TASK', task: nextTask };
  return canClaim ? { kind: 'CREATE_CLAIM' } : { kind: 'CLAIM_ACCESS_REQUIRED' };
}
