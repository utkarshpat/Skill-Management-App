import { createHash } from 'node:crypto';
import { AccessError } from '../../shared/errors.js';
export interface BusinessQuery {
  scopeId?: string;
  dataset: 'people' | 'skills' | 'certifications' | 'submissions';
  search: string;
  status: string;
  validity:
    | ''
    | 'CURRENT'
    | 'EXPIRED'
    | '14'
    | '30'
    | '60'
    | '90'
    | '15_30'
    | '31_60'
    | '61_90'
    | 'NO_EXPIRY'
    | 'LATER';
  category: string;
  issuer: string;
  skillId?: string;
  minRank: number;
  maxRank: number;
  from: string;
  to: string;
  page: number;
  sort: 'employee_asc' | 'employee_desc' | 'name_asc' | 'updated_desc' | 'expiry_asc';
}
export interface BusinessContext {
  actorId?: string;
  revision: number;
  asOf: string;
  canView: boolean;
  canExport: boolean;
  canManage: boolean;
  canAmend: boolean;
  canDemandView?: boolean;
  canDemandCreate?: boolean;
  canMatch?: boolean;
  canShortlist?: boolean;
  canApprove?: boolean;
  personalBaseline: boolean;
  scopes: {
    id: string;
    kind: string;
    label: string;
    effect: string;
    bundle: string;
    scopeId: string | null;
  }[];
}
export interface BusinessDashboard {
  context: BusinessContext;
  summary: {
    employees: number;
    certified: number;
    skilled: number;
    pending: number;
    expired: number;
    expiring: number;
  };
  coverage: { id: string; label: string; holders: number; rank: number }[];
  categories?: { label: string; value: number }[];
  comparisons?: {
    id: string;
    label: string;
    kind: string;
    employees: number;
    certified: number;
    skilled: number;
  }[];
  distribution: { label: string; value: number }[];
  expiry: { label: string; value: number }[];
  activity: { label: string; submissions: number; decisions: number }[];
  rows: Record<string, string | number | null>[];
  total: number;
  page: number;
  pageSize: number;
}
export interface BusinessStore {
  context(actor: string): Promise<BusinessContext>;
  dashboard(actor: string, query: BusinessQuery, exporting?: boolean): Promise<BusinessDashboard>;
  administration(actor: string): Promise<Record<string, unknown>>;
  change(actor: string, change: BusinessChange): Promise<void>;
  workflow(
    actor: string,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value))
    throw new AccessError(400, 'Choose a valid record.');
  return value.toLowerCase();
}
function string(value: unknown, maximum: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum)
    throw new AccessError(400, 'Invalid filter.');
  return value.trim();
}
export function businessQuery(value: unknown): BusinessQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessError(400, 'Invalid filters.');
  const q = value as Record<string, unknown>;
  const keys = [
    'scopeId',
    'dataset',
    'search',
    'status',
    'validity',
    'category',
    'issuer',
    'skillId',
    'minRank',
    'maxRank',
    'from',
    'to',
    'page',
    'sort',
  ];
  if (Object.keys(q).some(key => !keys.includes(key)))
    throw new AccessError(400, 'Unsupported filter.');
  const dataset = q.dataset ?? 'people',
    validity = q.validity ?? '',
    status = q.status ?? '';
  const sort = q.sort ?? (dataset === 'people' ? 'employee_asc' : 'updated_desc');
  if (
    !['employee_asc', 'employee_desc', 'name_asc', 'updated_desc', 'expiry_asc'].includes(
      String(sort),
    )
  )
    throw new AccessError(400, 'Choose a supported sort.');
  const page = Number(q.page ?? 1),
    minRank = Number(q.minRank ?? 1),
    maxRank = Number(q.maxRank ?? 5);
  if (
    !['people', 'skills', 'certifications', 'submissions'].includes(String(dataset)) ||
    ![
      '',
      'CURRENT',
      'EXPIRED',
      '14',
      '30',
      '60',
      '90',
      '15_30',
      '31_60',
      '61_90',
      'NO_EXPIRY',
      'LATER',
    ].includes(String(validity)) ||
    !['', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(String(status)) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(minRank) ||
    minRank < 1 ||
    minRank > 5 ||
    !Number.isInteger(maxRank) ||
    maxRank < minRank ||
    maxRank > 5
  )
    throw new AccessError(400, 'Choose valid filters.');
  const from = string(q.from, 10),
    to = string(q.to, 10);
  for (const date of [from, to])
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new AccessError(400, 'Choose a valid date.');
  if (from && to && from > to) throw new AccessError(400, 'Start date must precede end date.');
  return {
    sort: sort as BusinessQuery['sort'],
    ...(q.scopeId ? { scopeId: identifier(q.scopeId) } : {}),
    ...(q.skillId ? { skillId: identifier(q.skillId) } : {}),
    dataset: dataset as BusinessQuery['dataset'],
    validity: validity as BusinessQuery['validity'],
    status: String(status),
    page,
    minRank,
    maxRank,
    search: string(q.search, 100),
    category: string(q.category, 80),
    issuer: string(q.issuer, 120),
    from,
    to,
  };
}
export interface BusinessChange {
  revision: number;
  kind: 'PROJECT' | 'MEMBERSHIP' | 'RESPONSIBILITY' | 'PERSONAL_BASELINE';
  id: string;
  payload: Record<string, unknown>;
}
export function businessChange(value: unknown): BusinessChange {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessError(400, 'Invalid change.');
  const q = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(q.revision) ||
    Number(q.revision) < 1 ||
    !['PROJECT', 'MEMBERSHIP', 'RESPONSIBILITY', 'PERSONAL_BASELINE'].includes(String(q.kind)) ||
    !q.payload ||
    typeof q.payload !== 'object' ||
    Array.isArray(q.payload)
  )
    throw new AccessError(400, 'Invalid change.');
  const p = q.payload as Record<string, unknown>,
    reason = string(p.reason, 1000);
  if (!reason) throw new AccessError(400, 'Explain this change.');
  let payload: Record<string, unknown>;
  if (q.kind === 'PROJECT') {
    const name = string(p.name, 100);
    if (!name || typeof p.active !== 'boolean')
      throw new AccessError(400, 'Enter a project name and state.');
    payload = {
      name,
      active: p.active,
      departmentId: p.departmentId ? identifier(p.departmentId) : null,
      reason,
    };
  } else if (q.kind === 'MEMBERSHIP') {
    if (typeof p.active !== 'boolean') throw new AccessError(400, 'Choose membership state.');
    payload = {
      personId: identifier(p.personId),
      projectId: identifier(p.projectId),
      active: p.active,
      reason,
    };
  } else if (q.kind === 'RESPONSIBILITY') {
    if (
      !['BUSINESS_OPERATIONS', 'SYSTEM_ADMIN'].includes(String(p.bundle)) ||
      !['ORGANIZATION', 'DELIVERY_UNIT', 'DEPARTMENT', 'PROJECT'].includes(String(p.kind)) ||
      !['ALLOW', 'DENY'].includes(String(p.effect)) ||
      typeof p.active !== 'boolean'
    )
      throw new AccessError(400, 'Choose an implemented responsibility and scope.');
    if (p.bundle === 'SYSTEM_ADMIN' && p.kind !== 'ORGANIZATION')
      throw new AccessError(400, 'System Admin requires organization scope.');
    const suppliedExpiry = p.validUntil ? string(p.validUntil, 40) : null;
    if (
      suppliedExpiry &&
      (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(suppliedExpiry) ||
        !Number.isFinite(Date.parse(suppliedExpiry)) ||
        (p.active === true && Date.parse(suppliedExpiry) <= Date.now()))
    )
      throw new AccessError(400, 'Choose a future expiry.');
    const validUntil = suppliedExpiry ? new Date(suppliedExpiry).toISOString() : null;
    if (p.effect === 'DENY' && !validUntil)
      throw new AccessError(400, 'A scoped exception needs an expiry.');
    payload = {
      personId: identifier(p.personId),
      bundle: p.bundle,
      kind: p.kind,
      scopeId: p.kind === 'ORGANIZATION' ? null : identifier(p.scopeId),
      effect: p.effect,
      active: p.active,
      validUntil,
      reason,
    };
  } else {
    if (typeof p.enabled !== 'boolean')
      throw new AccessError(400, 'Choose personal baseline state.');
    payload = { enabled: p.enabled, reason };
  }
  return {
    revision: Number(q.revision),
    kind: q.kind as BusinessChange['kind'],
    id: identifier(q.id),
    payload,
  };
}
export function previewBusiness(
  actor: string,
  current: Record<string, unknown>,
  change: BusinessChange,
) {
  if (current.revision !== change.revision)
    throw new AccessError(409, 'Access changed. Reload before previewing.');
  const rows = (key: string) => (current[key] ?? []) as Record<string, unknown>[];
  const person = rows('people').find(p => p.id === change.payload.personId);
  if (
    ['MEMBERSHIP', 'RESPONSIBILITY'].includes(change.kind) &&
    (!person || (change.payload.active === true && !person.active))
  )
    throw new AccessError(400, 'Choose a current person in this account.');
  const binding =
    change.kind === 'MEMBERSHIP'
      ? rows('projects').find(p => p.id === change.payload.projectId)
      : change.kind === 'RESPONSIBILITY' && change.payload.kind !== 'ORGANIZATION'
        ? (change.payload.kind === 'PROJECT' ? rows('projects') : rows('nodes')).find(
            p =>
              p.id === change.payload.scopeId &&
              (change.payload.kind === 'PROJECT' || p.kind === change.payload.kind),
          )
        : undefined;
  if (
    (change.kind === 'MEMBERSHIP' ||
      (change.kind === 'RESPONSIBILITY' && change.payload.kind !== 'ORGANIZATION')) &&
    (!binding || (change.payload.active === true && !binding.active))
  )
    throw new AccessError(400, 'Choose a valid current scope binding.');
  if (
    change.kind === 'PROJECT' &&
    change.payload.departmentId &&
    !rows('nodes').some(
      n => n.id === change.payload.departmentId && n.kind === 'DEPARTMENT' && n.active,
    )
  )
    throw new AccessError(400, 'Choose an active department.');
  if (
    change.kind === 'PROJECT' &&
    rows('projects').some(
      p =>
        p.id !== change.id &&
        String(p.name).toLocaleLowerCase() === String(change.payload.name).toLocaleLowerCase(),
    )
  )
    throw new AccessError(409, 'Project name already exists.');
  const before =
    change.kind === 'PERSONAL_BASELINE'
      ? { enabled: current.personalBaseline }
      : change.kind === 'MEMBERSHIP'
        ? (rows('memberships').find(
            m => m.personId === change.payload.personId && m.projectId === change.payload.projectId,
          ) ?? null)
        : (rows(change.kind === 'PROJECT' ? 'projects' : 'responsibilities').find(
            row => row.id === change.id,
          ) ?? null);
  const actions =
    change.kind === 'RESPONSIBILITY'
      ? [
          'Scoped analytics and authorized exports',
          'Scoped demand and explainable matching',
          'Master amendment proposals',
          ...(change.payload.bundle === 'SYSTEM_ADMIN'
            ? ['Catalogue management', 'People/access administration', 'Audit reading']
            : []),
        ]
      : change.kind === 'PERSONAL_BASELINE'
        ? [
            'Own profile, skills and certification claims',
            'Personal learning and participant requests/incidents',
            'Published skill catalogue',
          ]
        : ['No new authority'];
  return {
    receipt: createHash('sha256').update(JSON.stringify({ actor, current, change })).digest('hex'),
    change,
    before,
    after: { id: change.id, ...change.payload },
    impact: {
      person: person?.name,
      binding: binding?.name,
      actions,
      baselineAffectedPeople:
        change.kind === 'PERSONAL_BASELINE' ? current.baselineAffectedPeople : undefined,
    },
    warnings: [
      'Membership is separate from reporting and never grants authority.',
      'Business analytics excludes private drafts and attachments. Claim approval still requires the exact assigned current manager.',
      'Existing unsupported role grants are retained for explicit review.',
    ],
  };
}
