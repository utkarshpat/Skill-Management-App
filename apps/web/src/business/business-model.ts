export interface BusinessScope {
  id: string;
  kind: string;
  scopeId: string | null;
  label: string;
  effect: string;
  bundle: string;
}
/** Presentation only: preserve an already selected server binding and all stored grants. */
export function businessScopeChoices(scopes: BusinessScope[], selectedId = '') {
  const choices = new Map<string, BusinessScope>();
  for (const scope of scopes) {
    if (scope.effect !== 'ALLOW') continue;
    const key = `${scope.kind}:${scope.scopeId?.toLowerCase() ?? ''}`;
    if (!choices.has(key) || scope.id === selectedId) choices.set(key, scope);
  }
  return [...choices.values()];
}
export function businessScopeLabel(scope: BusinessScope) {
  const kind = scope.kind.replaceAll('_', ' ');
  return kind.toLowerCase() === scope.label.toLowerCase()
    ? scope.label
    : `${kind} · ${scope.label}`;
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
  rows: Record<string, string | number | boolean | null>[];
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

/** Names may change or be reused; identity and drill-down always follow skill IDs. */
export function businessCoverageRows(coverage: BusinessDashboard['coverage']) {
  const rows = new Map<
    string,
    { id: string; label: string; cells: Map<number, BusinessDashboard['coverage'][number]> }
  >();
  for (const cell of coverage) {
    let row = rows.get(cell.id);
    if (!row) {
      row = { id: cell.id, label: cell.label, cells: new Map() };
      rows.set(cell.id, row);
    }
    row.cells.set(cell.rank, cell);
  }
  return [...rows.values()];
}

/** Reporting dates use UTC, matching the server's calendar boundaries. */
export function businessPeriod(preset: 'all' | '30' | '90' | 'ytd', now = new Date()) {
  if (preset === 'all') return { from: '', to: '' };
  const start = new Date(now);
  if (preset === 'ytd') start.setUTCMonth(0, 1);
  else start.setUTCDate(start.getUTCDate() - Number(preset));
  return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

/** Counts in the People dataset are paginated; they cannot establish a scope-wide ranking. */
export function businessPeoplePage(rows: BusinessDashboard['rows']) {
  return [...rows]
    .sort(
      (a, b) =>
        (Number(b.currentCertifications) || 0) - (Number(a.currentCertifications) || 0) ||
        (Number(b.reviewedSkills) || 0) - (Number(a.reviewedSkills) || 0) ||
        String(a.employee).localeCompare(String(b.employee)),
    )
    .slice(0, 8);
}

export { businessReportHtml } from './business-report-document';
