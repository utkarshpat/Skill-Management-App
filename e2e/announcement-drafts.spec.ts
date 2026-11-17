import { test, expect, fixture, ids } from './browser-fixture';

test('audience hierarchy, local draft recovery and banner/popup preview remain consistent', async ({
  page,
}, info) => {
  await fixture(page, { role: 'admin' });
  const grant = ids.api;
  const du = '88888888-8888-4888-8888-000000000001';
  const pf = '88888888-8888-4888-8888-000000000002';
  const client = '88888888-8888-4888-8888-000000000003';
  const project = '88888888-8888-4888-8888-000000000004';
  await page.route('**/api/announcements/feed', route =>
    route.fulfill({
      json: {
        canPublish: true,
        person: { name: 'Admin', employeeId: '100' },
        items: [],
      },
    }),
  );
  await page.route('**/api/announcements/manage', route =>
    route.fulfill({
      json: {
        actorId: ids.person,
        grants: [{ id: grant, kind: 'DELIVERY_UNIT', scopeId: du }],
        items: [],
        aiAvailable: true,
        scopes: [
          { id: du, kind: 'DELIVERY_UNIT', grantId: grant, label: 'UK Delivery Unit' },
          {
            id: pf,
            kind: 'PORTFOLIO',
            grantId: grant,
            label: 'NHS Portfolio',
            parentId: du,
            parentKind: 'DELIVERY_UNIT',
          },
          {
            id: client,
            kind: 'DEPARTMENT',
            grantId: grant,
            label: 'NHS Account',
            parentId: pf,
            parentKind: 'PORTFOLIO',
          },
          {
            id: project,
            kind: 'PROJECT',
            grantId: grant,
            label: 'NHS Project',
            parentId: client,
            parentKind: 'DEPARTMENT',
          },
        ],
      },
    }),
  );
  await page.route('**/api/announcements/draft', route =>
    route.fulfill({
      json: {
        id: ids.api,
        audienceCount: 20,
        receipt: 'fixture-receipt',
      },
    }),
  );
  let designContext;
  await page.route('**/api/announcements/design', route => {
    designContext = route.request().postDataJSON();
    return route.fulfill({
      json: {
        id: project,
        feedback: 'Keep the image on the right',
        design: {
          html: '<section><div data-slot="title"></div><div data-slot="message"></div><div data-slot="image"></div><div data-slot="action"></div></section>',
          css: 'section { --form-layout: two-column; --button-width: full; }',
          order: ['title', 'message', 'image', 'action'],
          color: '#126b70',
          background: '#ffffff',
          align: 'left',
          layout: 'stack',
          formLayout: 'two-column',
          buttonWidth: 'full',
        },
      },
    });
  });
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'Manage announcements' }).click();
  const editor = page.getByRole('dialog', { name: 'Announcements' });
  await editor.getByRole('button', { name: 'New announcement' }).click();
  for (const label of ['UK Delivery Unit', 'NHS Portfolio', 'NHS Account', 'NHS Project']) {
    await expect(editor.getByRole('checkbox', { name: new RegExp(label) })).toBeChecked();
  }
  await expect(editor.getByRole('checkbox', { name: /NHS Portfolio/ })).toBeDisabled();
  await editor.getByRole('checkbox', { name: /UK Delivery Unit/ }).uncheck();
  await expect(editor.getByRole('checkbox', { name: /NHS Project/ })).not.toBeChecked();
  await editor.getByRole('checkbox', { name: /NHS Portfolio/ }).check();
  await expect(editor.getByRole('checkbox', { name: /NHS Project/ })).toBeChecked();
  await editor.getByLabel('Title', { exact: true }).fill('Azure training');
  await editor.getByLabel('Use case').selectOption('TRAINING');
  await editor.getByLabel('Design viewport').selectOption('mobile');
  await editor.getByLabel('Design prompt').fill('Keep the image on the right');
  await expect(editor.getByText('Draft saved on this device.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Manage announcements' }).click();
  await editor.getByRole('button', { name: 'Resume local draft' }).click();
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Azure training');
  await expect(editor.getByLabel('Design prompt')).toHaveValue('Keep the image on the right');
  await editor.getByRole('button', { name: 'Generate with AI' }).click();
  await expect(
    editor.getByText('Design generated. Preview it or continue refining.'),
  ).toBeVisible();
  expect(designContext).toMatchObject({
    definition: { useCase: 'TRAINING', designViewport: 'mobile' },
    viewport: { width: page.viewportSize()!.width, height: page.viewportSize()!.height },
  });
  await editor.getByRole('button', { name: 'Preview', exact: true }).click();
  await editor.getByRole('button', { name: 'Mobile', exact: true }).click();
  await expect(editor.locator('.announcement-preview-stage.is-mobile')).toBeVisible();
  await editor.getByRole('button', { name: 'Popup preview' }).click();
  await expect(editor.getByText('Announcement popup', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Form preview' }).click();
  await expect(editor.getByLabel('Work email')).toHaveValue('employee@example.com');
  await page.screenshot({ path: info.outputPath('announcement-preview.png'), fullPage: true });
});
