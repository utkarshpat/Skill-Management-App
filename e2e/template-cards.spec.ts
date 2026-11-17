import { expect, fixture, ids, test } from './browser-fixture';

test('templates show two built-in cards and create/edit custom bundles', async ({ page }, info) => {
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
  await page.route('**/api/announcements/feed', route =>
    route.fulfill({
      json: { items: [], canPublish: false, person: { name: 'Admin', employeeId: '100' } },
    }),
  );
  await page.goto('/access?view=roles');
  const cards = page.getByRole('region', { name: 'Access templates' });
  await expect(cards.getByRole('heading', { name: '2 templates' })).toBeVisible();
  await expect(cards.locator('article')).toHaveCount(2);
  await expect(cards.getByRole('heading', { name: 'Business Analytics' })).toBeVisible();
  await expect(cards.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create access template' });
  await editor.getByLabel('Template name').fill('Service support');
  await editor.getByRole('button', { name: 'Cancel' }).click();
  Object.assign(response, { roles: [role] });
  await page.reload();
  await expect(cards.getByRole('heading', { name: '3 templates' })).toBeVisible();
  await cards.getByRole('button', { name: 'Edit template Delivery Support' }).click();
  const editing = page.getByRole('dialog', { name: 'Edit access template' });
  await expect(editing.getByLabel('Template name')).toHaveValue('Delivery Support');
  await editing.getByRole('button', { name: 'Cancel' }).click();
  await page.screenshot({ path: info.outputPath('template-cards.png'), fullPage: true });
});
