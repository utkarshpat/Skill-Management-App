import { test, expect, fixture, ids } from './browser-fixture';
import type { Page } from '@playwright/test';
const skill = '11111111-1111-4111-8111-000000000001',
  scope = '99999999-9999-4999-8999-000000000001';
const context = {
  actorId: ids.person,
  revision: 4,
  asOf: '2026-11-05T03:30:00Z',
  canView: true,
  canExport: true,
  canManage: false,
  canAmend: false,
  canMatch: true,
  personalBaseline: true,
  scopes: [
    {
      id: scope,
      kind: 'PROJECT',
      scopeId: scope,
      label: 'Customer Insights Modernisation',
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
  ],
};
const data = {
  context,
  summary: { employees: 2, skilled: 2, certified: 1, pending: 1, expired: 1, expiring: 0 },
  coverage: [
    { id: skill, label: 'SQL', category: 'Databases', holders: 1, rank: 3 },
    { id: skill, label: 'SQL', category: 'Databases', holders: 1, rank: 2 },
  ],
  coverageComplete: true,
  credentialCoverage: [
    {
      id: skill,
      name: 'Oracle SQL',
      issuer: 'Oracle',
      category: 'Databases',
      reviewedHolders: 1,
      currentHolders: 1,
      expiredHolders: 0,
    },
  ],
  uncataloguedCredentials: [
    {
      name: 'Power BI',
      issuer: 'Microsoft',
      reviewedHolders: 1,
      currentHolders: 0,
      expiredHolders: 1,
    },
  ],
  categories: [{ label: 'Databases', value: 2 }],
  comparisons: [
    {
      id: scope,
      label: 'Customer Insights Modernisation',
      kind: 'PROJECT',
      employees: 2,
      skilled: 2,
      certified: 1,
    },
  ],
  distribution: [{ label: 'Oracle', value: 1 }],
  expiry: [{ label: 'Expired', value: 1 }],
  activity: [{ label: '2026-11', submissions: 2, decisions: 1 }],
  rows: [
    {
      id: ids.person,
      employee: 'Aditi Menon',
      employeeCode: 'EMP-1042',
      project: 'Customer Insights Modernisation',
      reviewedSkills: 1,
      currentCertifications: 1,
      primaryCapability: 'SQL',
      department: 'Analytics',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
};
async function analytics(page: Page, state: { failure?: number }, queries: URLSearchParams[]) {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/business/context', r => r.fulfill({ json: context }));
  await page.route('**/api/business/dashboard?**', r => {
    const q = new URL(r.request().url()).searchParams;
    queries.push(q);
    const rows =
      q.get('dataset') === 'people' || !q.get('dataset')
        ? data.rows
        : [
            {
              id: skill,
              name: 'SQL',
              employee: 'Aditi Menon',
              status: 'APPROVED',
              rank: 3,
              updatedAt: '2026-11-04T10:00:00Z',
              validity: 'CURRENT',
              canViewFiles: false,
            },
          ];
    return state.failure
      ? r.fulfill({
          status: state.failure,
          json: { error: { message: 'Current scope access is unavailable' } },
        })
      : r.fulfill({ json: { ...data, rows, page: Number(q.get('page') ?? 1) } });
  });
  await page.route('**/api/business/export?**', r =>
    r.fulfill({ contentType: 'text/csv', body: 'employee,skill\nAditi Menon,SQL' }),
  );
  await page.route('**/api/business/report?**', r => r.fulfill({ json: data }));
  await page.goto('/test/e2e/harness.html?fixture=analytics');
}
test('analytics: scope, chart perspectives, dataset filters and export use the current query', async ({
  page,
}) => {
  const queries: URLSearchParams[] = [];
  await analytics(page, {}, queries);
  const views = page.getByRole('navigation', { name: 'Analytics views' });
  await expect(views.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Scope filter' }).selectOption(scope);
  await expect.poll(() => queries.at(-1)?.get('scopeId')).toBe(scope);
  await views.getByRole('button', { name: 'Skill coverage', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'SQL, level 3: 1 reviewed holders; drill-through level 3',
      exact: true,
    }),
  ).toBeVisible();
  await views.getByRole('button', { name: 'Certificates & renewals', exact: true }).click();
  await expect(page.getByRole('cell').filter({ hasText: 'Oracle SQL' }).first()).toBeVisible();
  await views.getByRole('button', { name: 'People & records', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Aditi Menon', exact: true })).toBeVisible();
  const filters = page.locator('.bo-record-filters');
  await filters.getByRole('combobox', { name: 'Dataset', exact: true }).selectOption('skills');
  await filters
    .getByRole('combobox', { name: 'Review status', exact: true })
    .selectOption('APPROVED');
  await expect.poll(() => queries.at(-1)?.get('status')).toBe('APPROVED');
  expect(queries.at(-1)?.get('scopeId')).toBe(scope);
  await filters
    .getByRole('combobox', { name: 'Dataset', exact: true })
    .selectOption('certifications');
  await filters.getByRole('combobox', { name: 'Validity', exact: true }).selectOption('EXPIRED');
  await expect.poll(() => queries.at(-1)?.get('validity')).toBe('EXPIRED');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await filters.getByRole('combobox', { name: 'Dataset', exact: true }).selectOption('submissions');
  await expect.poll(() => queries.at(-1)?.get('dataset')).toBe('submissions');
});
test('analytics: denied query clears loaded employee rows and retry reloads current authorized data', async ({
  page,
}) => {
  const state: { failure?: number } = {},
    queries: URLSearchParams[] = [];
  await analytics(page, state, queries);
  await page
    .getByRole('navigation', { name: 'Analytics views' })
    .getByRole('button', { name: 'People & records', exact: true })
    .click();
  await expect(page.getByRole('cell', { name: 'Aditi Menon', exact: true })).toBeVisible();
  state.failure = 403;
  await page.getByRole('combobox', { name: 'Scope filter' }).selectOption(scope);
  await expect(page.getByRole('alert')).toContainText('Current scope access is unavailable');
  await expect(page.getByRole('cell', { name: 'Aditi Menon', exact: true })).toHaveCount(0);
  state.failure = undefined;
  await page.getByRole('button', { name: 'Retry query', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Aditi Menon', exact: true })).toBeVisible();
});
