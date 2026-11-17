import { test, expect, fixture } from './browser-fixture';

test('catalogue bulk upload previews the file before confirmation and exports Excel', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/excel/catalogue/access', route =>
    route.fulfill({ json: { canImport: true } }),
  );
  await page.route('**/api/excel/catalogue/export*', route =>
    route.fulfill({
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: 'Workbook response',
    }),
  );
  await page.route('**/api/excel/catalogue/preview', route =>
    route.fulfill({
      json: {
        changed: 1,
        added: 1,
        updated: 0,
        unchanged: 0,
        duplicates: 0,
        preview: 'preview-receipt',
        examples: [{ row: 2, section: 'SKILL', label: 'Azure Platform' }],
      },
    }),
  );
  let applied = 0;
  await page.route('**/api/excel/catalogue/import', route => {
    expect(route.request().headers()['x-workbook-preview']).toBe('preview-receipt');
    applied++;
    return route.fulfill({ json: { changed: 1, duplicates: 0 } });
  });
  await page.goto('/skills');
  await page.getByRole('button', { name: 'Bulk action' }).click();
  const dialog = page.getByRole('dialog', { name: 'Catalogue Excel' });
  await expect(dialog).toBeVisible();
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download current data (.xlsx)' }).click();
  expect((await downloading).suggestedFilename()).toBe('catalogue-export.xlsx');
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['Test workbook'], 'catalogue.xlsx'));
    return data;
  });
  await dialog.locator('.excel-bulk-drop').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(dialog.getByText('catalogue.xlsx')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm import' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Preview import' }).click();
  await expect(dialog.getByText('1 to add · 0 to update · 0 unchanged')).toBeVisible();
  expect(applied).toBe(0);
  await dialog.getByRole('button', { name: 'Confirm import' }).click();
  await expect(dialog.getByText('1 imported.')).toBeVisible();
  expect(applied).toBe(1);
});

test('catalogue readers do not see Excel actions', async ({ page }) => {
  await fixture(page, { role: 'employee' });
  const loaded = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/skills',
  );
  await page.goto('/skills');
  await loaded;
  await expect(page.getByRole('button', { name: 'Bulk action' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download Excel', exact: true })).toHaveCount(0);
});

test('employees do not see Excel actions on their certifications', async ({ page }) => {
  await fixture(page, { role: 'employee', realistic: true });
  const loaded = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/certifications',
  );
  await page.goto('/certifications');
  await loaded;
  await expect(page.getByRole('button', { name: 'Bulk action' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download Excel', exact: true })).toHaveCount(0);
});
