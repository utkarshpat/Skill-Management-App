/** Account-bound SQL projection. These summaries never authorize a resource or write. */
export interface BusinessScope {
  id: string;
  bundle: 'BUSINESS_OPERATIONS' | 'SYSTEM_ADMIN';
  kind: 'ORGANIZATION' | 'DELIVERY_UNIT' | 'DEPARTMENT' | 'PROJECT';
  scopeId: string | null;
  label: string;
  effect: 'ALLOW' | 'DENY';
  validUntil: string | null;
  reason: string;
}
export interface BusinessProjection {
  personalBaseline: boolean;
  systemAdmin: boolean;
  adminDenied?: boolean;
  demandView?: boolean;
  demandCreate?: boolean;
  matchingView?: boolean;
  matchingRun?: boolean;
  shortlist?: boolean;
  approve?: boolean;
  scopes: BusinessScope[];
  view: boolean;
  export: boolean;
  manage: boolean;
  amend: boolean;
}
export const personalBaselinePermissions = new Set([
  'profile.view',
  'skill.view',
  'skill.claim',
  'learning.view',
  'learning.manage',
  'request.view',
  'request.create',
  'request.assign',
  'request.resolve',
  'incident.view',
  'incident.create',
  'incident.assign',
  'incident.resolve',
]);
export const systemAdminPermissions = new Set([
  'permissions.manage',
  'users.manage',
  'audit.view',
  'skill.catalogue.manage',
]);
