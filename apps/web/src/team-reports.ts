import { indexCoverage } from './team-coverage';

export interface TeamReportAnalytics {
  members: number;
  reviewed: number;
  pending: number;
  coverage: { skillName: string; rank: number; people: number; memberIds: string[] }[];
  levels: { rank: number; count: number; memberIds: string[] }[];
  categories: { category: string; count: number }[];
}
export type TeamReportKind = 'summary' | 'coverage' | 'gap';
export const reportLabels: Record<TeamReportKind, string> = {
  summary: 'Team summary',
  coverage: 'Reviewed skill coverage',
  gap: 'Recorded coverage gaps',
};
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
export async function fetchTeamAnalytics(fetcher: Fetcher, query: string, signal: AbortSignal) {
  const response = await fetcher(
    '/api/skill-reviews/team?' + new URLSearchParams({ page: '1', search: query }),
    { signal },
  );
  const body = (await response.json().catch(() => undefined)) as
    { analytics?: TeamReportAnalytics; error?: { message?: string } } | undefined;
  if (!response.ok)
    throw Object.assign(
      Error(body?.error?.message ?? 'Report could not be downloaded. Refresh team data and retry.'),
      { status: response.status },
    );
  if (!body?.analytics)
    throw Error(
      'Full-team report data is unavailable. Refresh and retry; no partial-page report was downloaded.',
    );
  signal.throwIfAborted();
  return { analytics: body.analytics, at: new Date() };
}
export async function fetchTeamReport(
  fetcher: Fetcher,
  kind: TeamReportKind,
  rank: number,
  query: string,
  signal: AbortSignal,
) {
  const { analytics, at } = await fetchTeamAnalytics(fetcher, query, signal);
  return { csv: teamReportCsv(analytics, kind, rank, query, at), at };
}
export function coverageRows(
  analytics: TeamReportAnalytics,
  rank: number,
  index = indexCoverage(analytics),
) {
  return [...index.keys()]
    .map(skillName => {
      const holders = index.get(skillName)?.get(rank)?.people ?? 0;
      return {
        skillName,
        holders,
        missing: analytics.members - holders,
        percent: analytics.members ? Math.round((holders / analytics.members) * 100) : 0,
      };
    })
    .sort((a, b) => b.missing - a.missing || a.skillName.localeCompare(b.skillName));
}
export function csvCell(value: string | number) {
  const text = String(value);
  const safe =
    typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function teamReportCsv(
  analytics: TeamReportAnalytics,
  kind: TeamReportKind,
  rank: number,
  query: string,
  at: Date,
) {
  const rows: (string | number)[][] = [
    ['Report', reportLabels[kind]],
    ['Scope', 'Current active direct reports'],
    ['Search', query || 'All direct reports'],
    ['Exported at', at.toISOString()],
    ['Active members', analytics.members],
    [
      'Data basis',
      'Manager-reviewed claims; only your assigned pending reviews. Private drafts excluded.',
    ],
  ];
  if (kind === 'summary') {
    rows.push(
      [],
      ['Metric', 'Count'],
      ['Active direct reports', analytics.members],
      ['Manager-reviewed claims', analytics.reviewed],
      ['Assigned pending reviews', analytics.pending],
      [],
      ['Reviewed category', 'Claim count'],
      ...analytics.categories.map(c => [c.category, c.count]),
      [],
      ['Reviewed level', 'Claim count'],
      ...analytics.levels.map(l => ['L' + l.rank, l.count]),
    );
  } else {
    rows.push(
      ['Minimum reviewed level', 'L' + rank],
      [
        'Interpretation',
        'Missing recorded coverage is not proof of a skill deficiency. No role-based targets are configured. Skills without any reviewed record are not included.',
      ],
      [],
      [
        'Skill',
        'Minimum level',
        'Active members',
        'Reviewed holders',
        'Without reviewed coverage',
        'Coverage percent',
      ],
    );
    rows.push(
      ...coverageRows(analytics, rank)
        .filter(r => kind !== 'gap' || r.missing > 0)
        .map(r => [r.skillName, 'L' + rank, analytics.members, r.holders, r.missing, r.percent]),
    );
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
