import { test, expect, fixture, ids } from './browser-fixture';
import type { Page } from '@playwright/test';
const project = '99999999-9999-4999-8999-000000000001',
  department = '99999999-9999-4999-8999-000000000002',
  unit = '99999999-9999-4999-8999-000000000003',
  portfolio = '99999999-9999-4999-8999-000000000004';
const administration = {
  revision: 4,
  personalBaseline: true,
  baselineAffectedPeople: 2,
  projects: [
    {
      id: project,
      name: 'Customer Insights Modernisation',
      departmentId: department,
      active: true,
    },
  ],
  memberships: [{ personId: ids.person, projectId: project, active: true }],
  responsibilities: [],
  people: [
    {
      id: ids.person,
      name: 'Aditi Menon',
      employeeCode: 'EMP-1042',
      active: true,
      employeeAccess: true,
    },
    {
      id: department,
      name: 'Rohan Mehta',
      employeeCode: 'EMP-1007',
      active: true,
      employeeAccess: true,
      hasDirectReports: true,
      managerAccess: true,
    },
  ],
  nodes: [
    {
      id: unit,
      name: 'India Delivery',
      kind: 'DELIVERY_UNIT',
      active: true,
      parentId: null,
      scopeValid: true,
    },
    {
      id: portfolio,
      name: 'Financial Services',
      kind: 'PORTFOLIO',
      active: true,
      parentId: unit,
      scopeValid: true,
    },
    {
      id: department,
      name: 'Northstar Bank',
      kind: 'DEPARTMENT',
      active: true,
      parentId: portfolio,
      scopeValid: true,
    },
  ],
  historicalGrantsForReview: [
    { bundle: 'Historical scope', reason: 'Unsupported historical grant requires review' },
  ],
};
async function profiles(page: Page) {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/business/administration', r => r.fulfill({ json: administration }));
  await page.route('**/api/business/context', r =>
    r.fulfill({ json: { canManage: true, canView: true, revision: 5, scopes: [] } }),
  );
  await page.goto('/test/e2e/harness.html?fixture=access-profiles');
}
test('access profiles: explicit project scope preview precedes a receipt-bound save', async ({
  page,
}) => {
  const previews: Record<string, any>[] = [],
    writes: Record<string, unknown>[] = [];
  await profiles(page);
  await page.route('**/api/business/administration/preview', r => {
    const body = r.request().postDataJSON();
    previews.push(body);
    return r.fulfill({
      json: {
        receipt: 'reviewed-preview-1',
        change: body,
        before: { bundle: 'None' },
        after: body.payload,
        impact: { affectedPeople: 1 },
        warnings: ['Existing DENY assignments remain effective.'],
      },
    });
  });
  await page.route('**/api/business/administration', r => {
    if (r.request().method() === 'POST') {
      writes.push(r.request().postDataJSON());
      return r.fulfill({ json: { saved: true } });
    }
    return r.fulfill({ json: administration });
  });
  const form = page.locator('#bo-access-assignment-form');
  await form.getByRole('combobox', { name: 'Person', exact: false }).selectOption(ids.person);
  await form
    .getByRole('combobox', { name: 'Responsibility', exact: true })
    .selectOption('BUSINESS_OPERATIONS');
  await form.getByRole('combobox', { name: 'Scope', exact: true }).selectOption('PROJECT');
  await form.getByRole('combobox', { name: 'Scope binding', exact: false }).selectOption(project);
  await form
    .getByPlaceholder('Why is this change needed?')
    .fill('Aditi supports customer reporting capability analysis for this project.');
  await form.getByRole('button', { name: 'Preview change', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Review configuration change' });
  await expect(preview).toContainText('Existing DENY assignments remain effective.');
  expect(writes).toHaveLength(0);
  expect(previews[0].payload.scopeId).toBe(project);
  await preview.getByRole('button', { name: 'Back', exact: true }).click();
  await form
    .getByRole('combobox', { name: 'Responsibility', exact: true })
    .selectOption('SYSTEM_ADMIN');
  await expect(form.getByRole('combobox', { name: 'Scope', exact: true })).toBeDisabled();
  await expect(form.getByRole('combobox', { name: 'Scope', exact: true })).toHaveValue(
    'ORGANIZATION',
  );
  await form
    .getByRole('combobox', { name: 'Responsibility', exact: true })
    .selectOption('BUSINESS_OPERATIONS');
  await form.getByRole('combobox', { name: 'Scope', exact: true }).selectOption('PROJECT');
  await form.getByRole('combobox', { name: 'Scope binding', exact: false }).selectOption(project);
  await form.getByRole('button', { name: 'Preview change', exact: true }).click();
  await preview.getByRole('button', { name: 'Confirm & save', exact: true }).click();
  await expect(
    page.getByText('Configuration saved and access refreshed', { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].previewReceipt).toBe('reviewed-preview-1');
  expect(writes[0].revision).toBe(4);
});
test('access profiles: project, membership, baseline and historical grants remain separate controls', async ({
  page,
}) => {
  await profiles(page);
  await page.getByRole('searchbox', { name: 'Find person' }).fill('missing-employee');
  await expect(page.getByRole('cell', { name: 'Aditi Menon', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Find person' }).fill('');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('Name', { exact: false }).fill('Finance Reporting Automation');
  await page
    .getByRole('combobox', { name: 'Project account/client', exact: true })
    .selectOption(department);
  await page.getByRole('button', { name: 'Memberships', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Person', exact: false })).toHaveValue(
    ids.person,
  );
  await expect(page.getByRole('combobox', { name: 'Project', exact: false })).toHaveValue(project);
  await page.getByRole('button', { name: 'Employee baseline', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Employee baseline', exact: true }),
  ).toBeChecked();
  await page.getByRole('checkbox', { name: 'Employee baseline', exact: true }).uncheck();
  await expect(page.getByText(/Existing explicit denies remain effective/)).toBeVisible();
  await page.getByText('Historical grants needing explicit review (1)', { exact: true }).click();
  await expect(page.getByText(/Unsupported historical grant requires review/)).toBeVisible();
});

test('access profiles: Portfolio analytics preview keeps the exact binding and never becomes System Admin', async ({
  page,
}) => {
  await profiles(page);
  const previews: Record<string, any>[] = [];
  await page.route('**/api/business/administration/preview', async r => {
    const body = r.request().postDataJSON();
    previews.push(body);
    await r.fulfill({
      json: {
        receipt: 'portfolio-reviewed',
        change: body,
        before: null,
        after: body.payload,
        impact: {},
        warnings: [],
      },
    });
  });
  const form = page.locator('#bo-access-assignment-form');
  await form.getByRole('combobox', { name: 'Person', exact: false }).selectOption(ids.person);
  await form.getByRole('combobox', { name: 'Scope', exact: true }).selectOption('PORTFOLIO');
  await form.getByRole('combobox', { name: 'Scope binding', exact: false }).selectOption(portfolio);
  await form
    .getByPlaceholder('Why is this change needed?')
    .fill('Aditi supports the Financial Services portfolio.');
  await form.getByRole('button', { name: 'Preview change', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Review configuration change' });
  await expect(preview).toBeVisible();
  expect(previews[0].payload).toMatchObject({
    kind: 'PORTFOLIO',
    scopeId: portfolio,
    bundle: 'BUSINESS_OPERATIONS',
  });
  await preview.getByRole('button', { name: 'Back', exact: true }).click();
  await form
    .getByRole('combobox', { name: 'Responsibility', exact: true })
    .selectOption('SYSTEM_ADMIN');
  await expect(form.getByRole('combobox', { name: 'Scope', exact: true })).toHaveValue(
    'ORGANIZATION',
  );
  await expect(form.getByRole('combobox', { name: 'Scope binding', exact: false })).toHaveCount(0);
});
