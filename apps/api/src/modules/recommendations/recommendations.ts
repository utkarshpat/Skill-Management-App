import { AccessError } from '../../shared/errors.js';
import { learningChange, type LearningChange, date } from '../learning/index.js';
import { effectiveAccess, type LocalAccessState, type LocalPerson } from '../access/index.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message: string): never {
  throw new AccessError(400, message);
}
function id(v: unknown) {
  if (typeof v !== 'string' || !uuid.test(v)) fail('Choose a valid record.');
  return v.toLowerCase();
}
function text(v: unknown, max: number, required = false) {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim()))
    fail('Check the recommendation details.');
  return v.trim();
}
export type SendRecommendation = {
  id: string;
  personId: string;
  skillId: string;
  rank: number;
  reason: string;
  resource: string;
  targetDate?: string;
};

/**
 * Validates and normalizes learning recommendation payloads.
 *
 * Enforces fail-closed schema integrity:
 * - Accepts only declared fields: `id`, `personId`, `skillId`, `rank`, `reason`, `resource`, `targetDate`
 * - Validates proficiency rank (1–8)
 * - Restricts external learning resources strictly to secure HTTPS URLs
 */
export function sendRecommendation(input: unknown): SendRecommendation {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('Check the recommendation.');
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).some(
      k => !['id', 'personId', 'skillId', 'rank', 'reason', 'resource', 'targetDate'].includes(k),
    )
  )
    fail('Only recommendation fields are accepted.');
  if (!Number.isSafeInteger(v.rank) || Number(v.rank) < 1 || Number(v.rank) > 8)
    fail('Choose the target proficiency.');
  const resource = text(v.resource ?? '', 1000);
  if (resource) {
    try {
      const url = new URL(resource);
      if (url.protocol !== 'https:') fail('Use an HTTPS learning resource.');
    } catch {
      fail('Use an HTTPS learning resource.');
    }
  }
  return {
    id: id(v.id),
    personId: id(v.personId),
    skillId: id(v.skillId),
    rank: Number(v.rank),
    reason: text(v.reason, 2000, true),
    resource,
    ...(v.targetDate ? { targetDate: date(v.targetDate) } : {}),
  };
}
export function recommendationAccess(
  state: LocalAccessState,
  actor: LocalPerson,
  personId: string,
) {
  const result = effectiveAccess(state, actor, 'learning.recommend', 'DIRECT_REPORTS');
  const deny = (reasonCode: string) => ({ ...result, allowed: false, reasonCode });
  if (!result.allowed) return result;
  if (personId === actor.id) return deny('SELF_RECOMMENDATION');
  const target = state.people.find(p => p.id === personId && p.active),
    edges = state.reporting?.filter(e => e.personId === personId);
  if (!target) return deny('INACTIVE_RECIPIENT');
  if (!effectiveAccess(state, target, 'learning.view', 'OWN').allowed)
    return deny('RECIPIENT_LEARNING_DENIED');
  if (!state.reporting || edges?.length !== 1 || edges[0].managerId !== actor.id)
    return deny('NOT_CURRENT_DIRECT_MANAGER');
  return result;
}
export type RecommendationResponse = {
  id: string;
  revision: number;
  action: 'ACCEPT' | 'DECLINE' | 'DISCUSS';
  message: string;
  plan?: Extract<LearningChange, { action: 'CREATE' }>;
};
export function recommendationResponse(input: unknown): RecommendationResponse {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Check the response.');
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).some(k => !['id', 'revision', 'action', 'message', 'plan'].includes(k)) ||
    !['ACCEPT', 'DECLINE', 'DISCUSS'].includes(String(v.action)) ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 1
  )
    fail('Choose a valid response and revision.');
  const message = text(v.message ?? '', 2000, v.action === 'DISCUSS');
  let plan: RecommendationResponse['plan'];
  if (v.action === 'ACCEPT') {
    const p = learningChange(v.plan);
    if (p.action !== 'CREATE') fail('Review a new learning plan before accepting.');
    plan = p;
  } else if (v.plan !== undefined) fail('Only acceptance creates a plan.');
  return {
    id: id(v.id),
    revision: Number(v.revision),
    action: v.action as RecommendationResponse['action'],
    message,
    ...(plan ? { plan } : {}),
  };
}
export interface RecommendationStore {
  read(actor: string, view: 'received' | 'sent', page: number, id?: string): Promise<unknown>;
  options(actor: string, search: string): Promise<unknown>;
  send(actor: string, input: SendRecommendation): Promise<unknown>;
  respond(actor: string, input: RecommendationResponse): Promise<unknown>;
  notifications(
    actor: string,
  ): Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
}
