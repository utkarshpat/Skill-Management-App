import { AccessError } from '../../shared/errors.js';
import {
  can,
  canReviewAssigned,
  effectiveClaimReview,
  type LocalAccessState,
  type LocalPerson,
} from '../access/index.js';

export type CertificationStatus =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export interface CertificationFields {
  certificationName: string;
  provider: string;
  category: string;
  certificationDate: string;
  expiryDate: string | null;
  credentialId: string;
  credentialUrl: string;
  notes: string;
}
export interface Certification extends CertificationFields {
  id: string;
  revision: number;
  personId: string;
  reviewerId?: string;
  name: string;
  employeeCode: string;
  status: CertificationStatus;
  feedback: string;
  reviewedBy?: string;
  reviewedAt?: string;
  submittedAt?: string;
}
export interface CertificationQuery {
  view: 'mine' | 'queue';
  page: number;
  search: string;
}
export type CertificationChange =
  | { action: 'SAVE' | 'SAVE_SUBMIT'; id: string; revision: number; fields: CertificationFields }
  | {
      action: 'SUBMIT' | 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT';
      id: string;
      revision: number;
      feedback: string;
    };
export interface CertificationStore {
  read(
    actor: string,
    query: CertificationQuery,
  ): Promise<{ records: Certification[]; total: number }>;
  get(actor: string, id: string): Promise<Certification>;
  change(actor: string, change: CertificationChange): Promise<void>;
  notifications(
    actor: string,
  ): Promise<{ id: string; at: string; title: string; body: string; href: string }[]>;
}
const fail = (message: string): never => {
  throw new AccessError(400, message);
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function certificationId(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) fail('Invalid certification ID.');
  return (value as string).toLowerCase();
}
function text(value: unknown, max: number, label: string, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    fail('Check ' + label + '.');
  return (value as string).trim();
}
function day(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + 'T12:00:00Z')) ||
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value
  )
    fail('Choose a valid date.');
  return value as string;
}
export function certificationQuery(input: Record<string, unknown>): CertificationQuery {
  if (Object.keys(input).some(k => !['view', 'page', 'search'].includes(k)))
    fail('Invalid certification filters.');
  const view = input.view ?? 'mine',
    page = Number(input.page ?? 1);
  if (
    !['mine', 'queue'].includes(view as string) ||
    typeof view !== 'string' ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    (input.page !== undefined && typeof input.page !== 'string')
  )
    fail('Invalid certification filters.');
  return {
    view: view as CertificationQuery['view'],
    page,
    search: text(input.search ?? '', 100, 'search'),
  };
}
export function certificationChange(input: unknown, now = new Date()): CertificationChange {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('Invalid certification change.');
  const v = input as Record<string, unknown>,
    id = certificationId(v.id);
  if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || Number(v.revision) > 1000000)
    fail('Invalid revision.');
  const revision = Number(v.revision);
  if (v.action === 'SAVE' || v.action === 'SAVE_SUBMIT') {
    if (
      Object.keys(v).some(k => !['action', 'id', 'revision', 'fields'].includes(k)) ||
      !v.fields ||
      typeof v.fields !== 'object' ||
      Array.isArray(v.fields)
    )
      fail('Invalid credential fields.');
    const f = v.fields as Record<string, unknown>;
    if (
      Object.keys(f).some(
        k =>
          ![
            'certificationName',
            'provider',
            'category',
            'certificationDate',
            'expiryDate',
            'credentialId',
            'credentialUrl',
            'notes',
          ].includes(k),
      )
    )
      fail('Invalid credential fields.');
    const certificationDate = day(f.certificationDate),
      expiryDate = f.expiryDate === null ? null : day(f.expiryDate);
    if (
      certificationDate > now.toISOString().slice(0, 10) ||
      (expiryDate !== null && expiryDate < certificationDate)
    )
      fail('Issue date must not be in the future; expiry must not precede issue date.');
    const credentialUrl = text(f.credentialUrl, 1000, 'credential URL');
    if (credentialUrl) {
      let url: URL;
      try {
        url = new URL(credentialUrl);
      } catch {
        return fail('Use a valid HTTPS issuer or badge URL.');
      }
      if (url.protocol !== 'https:' || url.username || url.password)
        fail('Use a valid HTTPS issuer or badge URL.');
    }
    return {
      action: v.action,
      id,
      revision,
      fields: {
        certificationName: text(f.certificationName, 200, 'certification name', true),
        provider: text(f.provider, 120, 'issuer', true),
        category: text(f.category, 80, 'category', true),
        certificationDate,
        expiryDate,
        credentialUrl,
        credentialId: text(f.credentialId, 200, 'credential ID'),
        notes: text(f.notes, 2000, 'notes'),
      },
    };
  }
  if (
    !['SUBMIT', 'APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(v.action as string) ||
    revision < 1 ||
    Object.keys(v).some(k => !['action', 'id', 'revision', 'feedback'].includes(k))
  )
    fail('Invalid certification action.');
  const feedback = text(v.feedback ?? '', 2000, 'review feedback', v.action !== 'SUBMIT');
  if (v.action === 'SUBMIT' && feedback) fail('Submission cannot include reviewer feedback.');
  return {
    action: v.action as 'SUBMIT' | 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT',
    id,
    revision,
    feedback,
  };
}
export function certificationAccess(
  state: LocalAccessState,
  actor: LocalPerson,
  record: Certification,
) {
  const own = record.personId === actor.id;
  const canManage =
    can(state, actor, 'profile.view', true) &&
    can(state, actor, 'skill.view', true) &&
    can(state, actor, 'skill.claim', true);
  const chainValid = (id: string) => {
    const seen = new Set<string>();
    for (let depth = 0; depth <= 200; depth++) {
      if (seen.has(id) || !state.people.some(p => p.id === id && p.active) || !state.reporting)
        return false;
      seen.add(id);
      const edges = state.reporting.filter(r => r.personId === id);
      if (edges.length > 1) return false;
      if (!edges[0]?.managerId) return true;
      id = edges[0].managerId;
    }
    return false;
  };
  const reviewAccess = {
    ...effectiveClaimReview(state, actor, record),
    resource: { type: 'CERTIFICATION' as const, id: record.id, revision: record.revision },
  };
  if (
    reviewAccess.allowed &&
    (!chainValid(record.personId) || !can(state, actor, 'skill.view', true))
  ) {
    reviewAccess.allowed = false;
    reviewAccess.reasonCode = 'CERTIFICATION_SCOPE_UNAVAILABLE';
  }
  const edges = state.reporting?.filter(r => r.personId === actor.id),
    manager = edges?.length === 1 ? state.people.find(p => p.id === edges[0].managerId) : undefined;
  const reviewerAvailable = Boolean(
    manager &&
    manager.id !== actor.id &&
    chainValid(actor.id) &&
    can(state, manager, 'profile.view', true) &&
    can(state, manager, 'skill.view', true) &&
    canReviewAssigned(state, manager),
  );
  return {
    canEdit: own && canManage && ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(record.status),
    canSubmit:
      own &&
      canManage &&
      reviewerAvailable &&
      (['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(record.status) ||
        (record.status === 'SUBMITTED' && manager?.id !== record.reviewerId)),
    canReview: reviewAccess.allowed,
    reviewAccess: own ? undefined : reviewAccess,
  };
}

export function canSubmitNewCertification(state: LocalAccessState, actor: LocalPerson) {
  return certificationAccess(state, actor, {
    id: actor.id,
    revision: 0,
    personId: actor.id,
    name: actor.displayName,
    employeeCode: actor.employeeCode,
    status: 'DRAFT',
    feedback: '',
    certificationName: '',
    provider: '',
    category: '',
    certificationDate: '',
    expiryDate: null,
    credentialId: '',
    credentialUrl: '',
    notes: '',
  }).canSubmit;
}
