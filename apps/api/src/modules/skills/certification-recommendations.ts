import { AccessError } from '../../shared/errors.js';
import { can, effectiveAccess, type LocalAccessState, type LocalPerson } from '../access/index.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): never => {
  throw new AccessError(400, message);
};
function id(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) fail('Choose a valid record.');
  return (value as string).toLowerCase();
}
function text(value: unknown, max: number, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    fail('Check the certification recommendation.');
  return (value as string).trim();
}
function date(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + 'T12:00:00Z')) ||
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value
  )
    fail('Choose a valid target date.');
  return value as string;
}
export type CertificationRecommendationInput = {
  id: string;
  personId: string;
  certificationName: string;
  provider: string;
  category: string;
  reason: string;
  credentialUrl: string;
  targetDate?: string;
};
export function certificationRecommendationInput(value: unknown): CertificationRecommendationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('Check the recommendation.');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      key =>
        ![
          'id',
          'personId',
          'certificationName',
          'provider',
          'category',
          'reason',
          'credentialUrl',
          'targetDate',
        ].includes(key),
    )
  )
    fail('Only certification recommendation fields are accepted.');
  const credentialUrl = text(v.credentialUrl ?? '', 1000);
  if (credentialUrl) {
    try {
      const url = new URL(credentialUrl);
      if (url.protocol !== 'https:' || url.username || url.password)
        fail('Use a valid HTTPS credential link.');
    } catch {
      fail('Use a valid HTTPS credential link.');
    }
  }
  return {
    id: id(v.id),
    personId: id(v.personId),
    certificationName: text(v.certificationName, 200, true),
    provider: text(v.provider, 120),
    category: text(v.category, 80),
    reason: text(v.reason, 2000, true),
    credentialUrl,
    ...(v.targetDate ? { targetDate: date(v.targetDate) } : {}),
  };
}
export function certificationRecommendationResponse(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Check the response.');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(key => !['id', 'revision', 'action', 'message'].includes(key)) ||
    !['ACCEPT', 'DECLINE', 'DISCUSS'].includes(String(v.action)) ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 1
  )
    fail('Choose a valid response and revision.');
  const message = text(v.message ?? '', 2000, v.action === 'DISCUSS');
  return {
    id: id(v.id),
    revision: Number(v.revision),
    action: v.action as 'ACCEPT' | 'DECLINE' | 'DISCUSS',
    message,
  };
}
export type CertificationRecommendationResponse = ReturnType<
  typeof certificationRecommendationResponse
>;
export function canRecommendCertification(
  state: LocalAccessState,
  actor: LocalPerson,
  personId: string,
) {
  const permission = effectiveAccess(state, actor, 'learning.recommend', 'DIRECT_REPORTS');
  if (!permission.allowed) return false;
  if (
    personId === actor.id ||
    !can(state, actor, 'profile.view', true) ||
    !can(state, actor, 'skill.view', true) ||
    !can(state, actor, 'learning.view', true)
  )
    return false;
  const target = state.people.find(person => person.id === personId && person.active),
    edges = state.reporting?.filter(edge => edge.personId === personId);
  return Boolean(
    target &&
    can(state, target, 'profile.view', true) &&
    can(state, target, 'learning.view', true) &&
    edges?.length === 1 &&
    edges[0].managerId === actor.id,
  );
}

export interface CertificationRecommendationStore {
  read(
    actor: string,
    view: 'received' | 'sent',
    page: number,
    search: string,
    id?: string,
  ): Promise<unknown>;
  people(actor: string, search: string): Promise<unknown>;
  send(actor: string, input: CertificationRecommendationInput): Promise<unknown>;
  respond(
    actor: string,
    input: ReturnType<typeof certificationRecommendationResponse>,
  ): Promise<unknown>;
  analytics(actor: string): Promise<unknown>;
  notifications(
    actor: string,
  ): Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
}
