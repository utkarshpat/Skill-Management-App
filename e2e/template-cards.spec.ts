import { expect, fixture, ids, test } from './browser-fixture';

test('templates show Employee, Business Analytics and Admin and create/edit custom bundles', async ({
  page,
}, info) => {
  await fixture(page, { role: 'admin', businessAdministration: true });
  const role = {
    id: '88888888-8888-4888-8888-000000000003',
    name: 'Delivery Support',
    permissions: [{ permission: 'request.view', scope: 'OWN', effect: 'ALLOW' }],
  };
  const catalogue = [
    { code: 'profile.view', label: 'View profiles', implemented: true, scopes: ['OWN'] },
    { code: 'request.view', label: 'View requests', implemented: true, scopes: ['OWN'] },
  ];
  const response = {
    revision: 7,
    currentPerson: {
      id: ids.person,
      displayName: 'Admin',
      employeeCode: '100',
      active: true,
      roleIds: [],
    },
    canManageUsers: true,
    canViewAudit: true,
    people: [],
    roles: [],
    catalogue,
    audit: [],
    presets: [],
  };
  await page.route('**/api/access', route => route.fulfill({ json: response }));
  await page.route('**/api/business/administration', route =>
    route.fulfill({
      json: {
        revision: 7,
        personalBaseline: true,
        baselineAffectedPeople: 2,
        templateFeatures: [],
        projects: [],
        memberships: [],
        responsibilities: [],
        people: [],
        nodes: [],
        historicalGrantsForReview: [],
      },
    }),
  );
  let previews = 0;
  await page.route('**/api/access/preview', route => {
    previews += 1;
    return route.fulfill({ json: { receipt: 'template-preview', impacts: [] } });
  });
  await page.route('**/api/announcements/feed', route =>
    route.fulfill({
      json: { items: [], canPublish: false, person: { name: 'Admin', employeeId: '100' } },
    }),
  );
  await page.goto('/access?view=overview');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Templates 0 Manage permissions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create template', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Templates 0 Manage permissions' }).click();
  const cards = page.getByRole('region', { name: 'Access templates' });
  await expect(cards.getByRole('heading', { name: '3 templates' })).toBeVisible();
  await expect(cards.locator('article')).toHaveCount(3);
  await cards.getByRole('button', { name: 'Edit Employee access' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Enable default employee access' }),
  ).toBeChecked();
  await expect(page.getByText(/Existing explicit denies remain effective/)).toBeVisible();
  await page.getByRole('button', { name: 'Modules', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Learn & Grow' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Requests & Incidents' })).not.toBeChecked();
  await cards.getByRole('button', { name: 'Close employee access settings' }).click();
  await expect(cards.getByRole('heading', { name: 'Business Analytics' })).toBeVisible();
  await expect(cards.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await cards.getByRole('button', { name: 'Edit Business Analytics modules' }).click();
  await expect(page.getByRole('heading', { name: 'Business Analytics modules' })).toBeVisible();
  await cards.getByRole('button', { name: 'Edit Admin modules' }).click();
  await expect(page.getByRole('heading', { name: 'Admin modules' })).toBeVisible();
  await cards.getByRole('button', { name: 'Close admin modules settings' }).click();
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create access template' });
  await editor.getByLabel('Template name').fill('Service support');
  await expect(editor.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  const preview = editor.getByRole('button', { name: 'Preview change' });
  await expect(preview).toBeDisabled();
  await editor.getByRole('button', { name: 'Customize individual permissions' }).click();
  await editor.getByRole('checkbox', { name: 'View requests · Own records' }).check();
  await expect(preview).toBeEnabled();
  expect(previews).toBe(0);
  await preview.click();
  const review = page.getByRole('dialog', { name: 'Preview access change' });
  await expect(review.getByRole('list', { name: 'Selected permissions' })).toContainText(
    'View requests · Own records · Allow',
  );
  expect(previews).toBe(1);
  await review.getByRole('button', { name: 'Back to edit' }).click();
  await expect(editor.getByLabel('Template name')).toHaveValue('Service support');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  Object.assign(response, { roles: [role] });
  await page.reload();
  await expect(cards.getByRole('heading', { name: '4 templates' })).toBeVisible();
  await cards.getByRole('button', { name: 'Edit template Delivery Support' }).click();
  const editing = page.getByRole('dialog', { name: 'Edit access template' });
  await expect(editing.getByLabel('Template name')).toHaveValue('Delivery Support');
  await editing.getByRole('button', { name: 'Cancel' }).click();
  await page.screenshot({ path: info.outputPath('template-cards.png'), fullPage: true });
});
