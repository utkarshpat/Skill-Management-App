export interface BusinessScope {
  id: string;
  kind: string;
  scopeId: string | null;
  label: string;
  effect: string;
  bundle: string;
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
  scopes: BusinessScope[];
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
export const businessFilterKeys = [
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
] as const;
export function businessFilters(params: URLSearchParams) {
  const filters = new URLSearchParams();
  for (const key of businessFilterKeys) {
    const value = params.get(key);
    if (value) filters.set(key, value);
  }
  if (!filters.has('dataset')) filters.set('dataset', 'people');
  return filters;
}
export function updateBusinessFilters(params: URLSearchParams, patch: Record<string, string>) {
  const result = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch))
    value ? result.set(key, value) : result.delete(key);
  if (patch.dataset && patch.dataset !== params.get('dataset') && !('sort' in patch))
    result.delete('sort');
  if (!('page' in patch)) result.delete('page');
  return result;
}
