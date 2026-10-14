import { AccessError } from '../../shared/errors.js';
import type { BusinessDashboard } from './business.js';
export function coverageExport(data: BusinessDashboard, kind: unknown) {
  if (typeof kind !== 'string' || !['skill-coverage', 'credential-headcount'].includes(kind))
    throw new AccessError(400, 'Choose a supported coverage report.');
  if (data.coverageComplete !== true)
    throw new AccessError(503, 'Full catalogue reporting is unavailable. Apply migration 083.');
  const rows: BusinessDashboard['rows'] =
    kind === 'skill-coverage'
      ? data.coverage.map(cell => ({
          skillId: cell.id,
          skill: cell.label,
          category: cell.category ?? '',
          rank: cell.rank,
          reviewedHolders: cell.holders,
          authorizedEmployees: data.summary.employees,
        }))
      : [
          ...(data.credentialCoverage ?? []).map(c => ({
            ...c,
            catalogueStatus: 'Active catalogue',
          })),
          ...(data.uncataloguedCredentials ?? []).map(c => ({
            ...c,
            id: '',
            category: '',
            catalogueStatus: 'Uncatalogued or retired',
          })),
        ];
  const columns =
    kind === 'skill-coverage'
      ? ['skillId', 'skill', 'category', 'rank', 'reviewedHolders', 'authorizedEmployees']
      : [
          'id',
          'name',
          'issuer',
          'category',
          'catalogueStatus',
          'reviewedHolders',
          'currentHolders',
          'expiredHolders',
        ];
  return {
    data: { ...data, rows, total: rows.length, page: 1, pageSize: rows.length },
    options: {
      columns,
      metadata: [
        ['Report', String(kind)],
        [
          'Counting',
          'Distinct employees per skill/rank or credential; groups overlap and must not be summed as workforce headcount.',
        ],
      ],
    },
  };
}
