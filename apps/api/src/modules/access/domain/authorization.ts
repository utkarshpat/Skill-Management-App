/** Inputs must come from validated identity and current server-side records, never browser claims. */
// Role labels and memberships are administrator-defined records, not policy constants.
export type Role = string;

export type Scope =
  | { kind: 'OWN' }
  | { kind: 'TEAM' | 'DEPARTMENT' | 'DELIVERY_UNIT'; id: string }
  | { kind: 'ORGANIZATION' }
  | { kind: 'SPECIFIC_RESOURCE'; resourceType: string; id: string }
  | { kind: 'CAPABILITY' };

export interface Actor {
  id: string;
  accountId: string;
  active: boolean;
}

export interface Resource {
  id: string;
  type: string;
  accountId: string;
  ownerUserId?: string;
  teamId?: string;
  departmentId?: string;
  deliveryUnitId?: string;
  assignedReviewerId?: string;
  /** Resolved by the service, rather than accepted from the caller. */
  capabilityDomain?: 'SKILL_CATALOGUE' | 'LEARNING_CATALOGUE' | 'CAPABILITY_AGGREGATE';
}

export interface Grant {
  accountId: string;
  userId: string;
  permission: string;
  source: 'ROLE' | 'USER';
  effect: 'ALLOW' | 'DENY';
  scope: Scope;
  validFrom: string;
  validUntil?: string;
  revokedAt?: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason: 'ALLOW' | 'DEFAULT_DENY' | 'INACTIVE_ACTOR' | 'ACCOUNT_MISMATCH' | 'EXPLICIT_DENY' | 'SELF_APPROVAL' | 'NOT_ASSIGNED_REVIEWER' | 'INVALID_TIME';
}

function matchesScope(scope: Scope, actor: Actor, resource: Resource): boolean {
  switch (scope.kind) {
    case 'OWN': return resource.ownerUserId === actor.id;
    case 'TEAM': return scope.id === resource.teamId;
    case 'DEPARTMENT': return scope.id === resource.departmentId;
    case 'DELIVERY_UNIT': return scope.id === resource.deliveryUnitId;
    case 'ORGANIZATION': return true;
    case 'SPECIFIC_RESOURCE': return scope.id === resource.id && scope.resourceType === resource.type;
    case 'CAPABILITY': return resource.capabilityDomain !== undefined;
    default: return false;
  }
}

function isValid(grant: Grant, now: number): boolean {
  if (grant.revokedAt !== undefined) return false;
  const start = Date.parse(grant.validFrom);
  const end = grant.validUntil === undefined ? Infinity : Date.parse(grant.validUntil);
  return Number.isFinite(start) && !Number.isNaN(end) && start <= now && now < end;
}

/** Enforces scope before precedence. The caller must also validate resource state and concurrency. */
export function authorize(actor: Actor, permission: string, resource: Resource, grants: readonly Grant[], at: Date): AccessDecision {
  const deny = (reason: AccessDecision['reason']): AccessDecision => ({ allowed: false, reason });
  if (!Number.isFinite(at.getTime())) return deny('INVALID_TIME');
  if (!actor.active) return deny('INACTIVE_ACTOR');
  if (actor.accountId !== resource.accountId) return deny('ACCOUNT_MISMATCH');
  if (permission === 'skill.verify' || permission === 'assessment.approve') {
    if (resource.ownerUserId === actor.id) return deny('SELF_APPROVAL');
    if (!resource.ownerUserId || resource.assignedReviewerId !== actor.id) return deny('NOT_ASSIGNED_REVIEWER');
  }
  const applicable = grants.filter(grant =>
    grant.accountId === actor.accountId && grant.userId === actor.id &&
    grant.permission === permission && isValid(grant, at.getTime()) && matchesScope(grant.scope, actor, resource)
  );
  if (applicable.some(grant => grant.effect === 'DENY')) return deny('EXPLICIT_DENY');
  if (applicable.some(grant => grant.effect === 'ALLOW')) return { allowed: true, reason: 'ALLOW' };
  return deny('DEFAULT_DENY');
}

export interface ReportingRelationship {
  accountId: string;
  employeeId: string;
  managerId: string;
  validFrom: string;
  validUntil?: string;
}

/** Never falls back to a hard-coded manager. Missing/ambiguous reporting data blocks routing. */
export function resolveNPlusOne(accountId: string, employeeId: string, relationships: readonly ReportingRelationship[], at: Date): string | undefined {
  if (!Number.isFinite(at.getTime())) return undefined;
  const current = relationships.filter(item => item.accountId === accountId && item.employeeId === employeeId &&
    isValid({ ...item, userId: employeeId, permission: '', source: 'ROLE', effect: 'ALLOW', scope: { kind: 'OWN' } }, at.getTime()));
  if (current.length !== 1 || current[0].managerId === employeeId) return undefined;
  return current[0].managerId;
}
