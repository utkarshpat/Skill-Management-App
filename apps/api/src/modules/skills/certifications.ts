import { AccessError } from '../../shared/errors.js';
import {
  effectiveAccess,
  hasResolvedDirectReports,
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
}
export interface CertificationChange {
  id: string;
  revision: number;
  action: 'SAVE' | 'SUBMIT' | 'REROUTE' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  fields?: CertificationFields;
  feedback?: string;
}
export interface CertificationQuery {
  view: 'mine' | 'queue' | 'directory';
  page: number;
  search: string;
  category: string;
  du: string;
  active: 'ALL' | 'Y' | 'N';
  id?: string;
}
export function certificationId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new AccessError(400, 'Choose a valid certification.');
  return value.toLowerCase();
}
function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    (required && !value.trim()) ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new AccessError(400, 'Check the certification fields and their lengths.');
  return value.trim();
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value ||
    value < '1900-01-01'
  )
    throw new AccessError(400, 'Use a valid certification date.');
  return value;
}
export function certificationFields(
  input: unknown,
  submitting: boolean,
  today = new Date().toISOString().slice(0, 10),
): CertificationFields {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AccessError(400, 'Check the certification details.');
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).some(
      k =>
        ![
          'certificationName',
          'provider',
          'category',
          'certificationDate',
          'expiryDate',
          'credentialId',
          'credentialUrl',
        ].includes(k),
    )
  )
    throw new AccessError(400, 'Identity and review fields are managed by the server.');
  const certificationDate = date(v.certificationDate);
  const expiryDate = v.expiryDate === null ? null : date(v.expiryDate);
  if (certificationDate > today || (expiryDate !== null && expiryDate < certificationDate))
    throw new AccessError(
      400,
      'Issue date cannot be in the future; expiry must be on or after issue.',
    );
  let credentialUrl = text(v.credentialUrl, 500, submitting);
  if (credentialUrl) {
    let url: URL;
    try {
      url = new URL(credentialUrl);
    } catch {
      throw new AccessError(400, 'Use a valid HTTPS issuer verification link.');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new AccessError(400, 'Use an HTTPS issuer verification link without credentials.');
    credentialUrl = text(url.href, 500, submitting);
  }
  return {
    certificationName: text(v.certificationName, 200, true),
    provider: text(v.provider, 100, true),
    category: text(v.category, 100, true),
    certificationDate,
    expiryDate,
    credentialId: text(v.credentialId, 100),
    credentialUrl,
  };
}
export function certificationChange(input: unknown): CertificationChange {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AccessError(400, 'Check the certification action.');
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).some(k => !['id', 'revision', 'action', 'fields', 'feedback'].includes(k)) ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0 ||
    !['SAVE', 'SUBMIT', 'REROUTE', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(
      String(v.action),
    )
  )
    throw new AccessError(400, 'Choose a valid certification action and revision.');
  const action = v.action as CertificationChange['action'];
  const own = action === 'SAVE' || action === 'SUBMIT';
  if (action === 'REROUTE') {
    if (Number(v.revision) < 1 || v.fields !== undefined || v.feedback !== undefined)
      throw new AccessError(
        400,
        'Routing requires the current revision and cannot change evidence.',
      );
    return { id: certificationId(v.id), revision: Number(v.revision), action };
  }
  if (
    (own && v.feedback !== undefined) ||
    (!own && (v.fields !== undefined || Number(v.revision) < 1))
  )
    throw new AccessError(400, 'Only the fields for this action are accepted.');
  return {
    id: certificationId(v.id),
    revision: Number(v.revision),
    action,
    ...(own
      ? { fields: certificationFields(v.fields, action === 'SUBMIT') }
      : { feedback: text(v.feedback ?? '', 2000, action !== 'APPROVED') }),
  };
}
export function certificationQuery(input: Record<string, unknown>): CertificationQuery {
  if (
    Object.keys(input).some(
      k => !['view', 'page', 'search', 'category', 'du', 'active', 'id'].includes(k),
    )
  )
    throw new AccessError(400, 'Unsupported certification filter.');
  const view = input.view ?? 'mine',
    page = Number(input.page ?? 1),
    active = input.active ?? 'ALL';
  if (
    !['mine', 'queue', 'directory'].includes(String(view)) ||
    typeof view !== 'string' ||
    !['ALL', 'Y', 'N'].includes(String(active)) ||
    typeof active !== 'string' ||
    (input.page !== undefined && !['string', 'number'].includes(typeof input.page)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000
  )
    throw new AccessError(400, 'Check the certification filters.');
  return {
    view: view as CertificationQuery['view'],
    page,
    active: active as CertificationQuery['active'],
    search: text(input.search ?? '', 100),
    category: text(input.category ?? '', 100),
    du: text(input.du ?? '', 100),
    ...(input.id === undefined ? {} : { id: certificationId(input.id) }),
  };
}
export function certificationReviewAccess(
  state: LocalAccessState,
  actor: LocalPerson,
  record: {
    personId: string;
    reviewerId: string | null;
    status: CertificationStatus;
  },
) {
  const result = effectiveAccess(state, actor, 'certification.verify', 'DIRECT_REPORTS');
  const deny = (reasonCode: string) => ({ ...result, allowed: false, reasonCode });
  if (!result.allowed) return result;
  if (record.personId === actor.id) return deny('SELF_APPROVAL');
  if (!state.people.some(p => p.id === record.personId && p.active))
    return deny('INACTIVE_CLAIMANT');
  const edges = state.reporting?.filter(e => e.personId === record.personId);
  if (edges?.length !== 1 || edges[0].managerId !== actor.id)
    return deny('NOT_CURRENT_DIRECT_MANAGER');
  if (!hasResolvedDirectReports(state, actor, record.personId)) return deny('INVALID_RELATIONSHIP');
  if (record.reviewerId !== actor.id) return deny('NOT_ASSIGNED_REVIEWER');
  if (record.status !== 'SUBMITTED') return deny('NOT_AWAITING_REVIEW');
  return result;
}
export interface CertificationStore {
  read(actor: string, query: CertificationQuery, exporting?: boolean): Promise<unknown>;
  change(actor: string, input: CertificationChange): Promise<{ saved: true; id: string }>;
}
