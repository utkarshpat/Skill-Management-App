import { test, expect, fixture } from './browser-fixture';

const grant = '11111111-1111-4111-8111-111111111111';
const scope = '22222222-2222-4222-8222-222222222222';
const announcement = '33333333-3333-4333-8333-333333333333';
const person = { name: 'Test Employee', email: 'employee@soprasteria.com', employeeId: '710904' };
const interval = { startsAt: '2000-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z' };

test('publisher configures a poll in the UI and publishes only the previewed version', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/announcements/feed', route =>
    route.fulfill({ json: { items: [], person, canPublish: true } }),
  );
  await page.route('**/api/announcements/manage', route =>
    route.fulfill({
      json: {
        actorId: '11111111-1111-4111-8111-111111111111',
        grants: [{ id: grant, kind: 'PROJECT', scopeId: scope }],
        scopes: [{ id: scope, label: 'NHS IT Projects', kind: 'PROJECT', grantId: grant }],
        items: [],
        aiAvailable: true,
      },
    }),
  );
  let request;
  await page.route('**/api/announcements/draft', route => {
    request = route.request().postDataJSON();
    return route.fulfill({
      json: request.preview
        ? { id: announcement, audienceCount: 12, receipt: 'fixture-receipt' }
        : { id: announcement, revision: 1, state: 'PUBLISHED' },
    });
  });
  await page.goto('/profile');
  await expect(page.getByRole('button', { name: 'Manage announcements' })).toHaveCount(0);
  if (page.viewportSize()!.width < 800) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await page.getByRole('link', { name: 'Announcements', exact: true }).click();
  await expect(page).toHaveURL(/\/announcements$/);
  await page.getByRole('button', { name: 'Manage announcements' }).click();
  const dialog = page.getByRole('dialog', { name: 'Announcements' });
  await dialog.getByRole('button', { name: 'New announcement' }).click();
  await dialog.getByLabel('Title', { exact: true }).fill('Training topic');
  await dialog.getByLabel('Interaction').selectOption('POLL');
  await dialog.getByLabel('Option 1').fill('Azure');
  await dialog.getByLabel('Option 2').fill('SQL');
  await dialog.getByLabel('Grade').check();
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(dialog.getByText('12 eligible employees in the selected audience.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Mobile' }).click();
  await dialog.locator('.announcement-strip').getByRole('button', { name: 'Azure' }).click();
  await expect(dialog.getByText('Preview vote accepted.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish announcement' }).click();
  await expect(dialog.getByText('Announcement published for the selected schedule.')).toBeVisible();
  expect(request).toMatchObject({
    id: announcement,
    receipt: 'fixture-receipt',
    grantId: grant,
    publish: true,
    definition: {
      kind: 'POLL',
      options: ['Azure', 'SQL'],
      exports: ['grade'],
      audience: [{ id: scope, kind: 'PROJECT' }],
    },
  });
});

test('employee opens a scoped form from the banner and submits only custom fields', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  await page.route('**/api/announcements/feed', route =>
    route.fulfill({
      json: {
        items: [
          {
            id: announcement,
            revision: 1,
            ...interval,
            answered: false,
            hasImage: false,
            definition: {
              kind: 'FORM',
              title: 'Training registration',
              message: '',
              cta: 'Register',
              popup: false,
              marquee: false,
              fields: [
                {
                  id: 'batch',
                  label: 'Preferred batch',
                  type: 'choice',
                  required: true,
                  options: ['Morning', 'Afternoon'],
                },
              ],
            },
          },
        ],
        canPublish: false,
        person,
      },
    }),
  );
  let response;
  let responseAttempts = 0;
  await page.route('**/api/announcements/*/respond', route => {
    response = route.request().postDataJSON();
    if (++responseAttempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Please retry your response.' } },
      });
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto('/profile');
  await page
    .getByRole('region', { name: 'Announcements' })
    .getByRole('button', { name: 'Register' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Training registration' });
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(person.name);
  await expect(dialog.getByLabel('Work email')).toHaveValue(person.email);
  await expect(dialog.getByLabel('Employee ID')).toHaveValue(person.employeeId);
  await expect(dialog.getByLabel('Work email')).not.toBeEditable();
  await dialog.getByLabel('Preferred batch').selectOption('Afternoon');
  await dialog.getByRole('button', { name: 'Register' }).click();
  await expect(
    dialog.getByRole('region', { name: 'Training registration content' }).getByRole('alert'),
  ).toHaveText('Please retry your response.');
  await expect(dialog.getByLabel('Preferred batch')).toHaveValue('Afternoon');
  await dialog.getByRole('button', { name: 'Register' }).click();
  await expect(dialog.getByText('Response submitted.')).toBeVisible();
  expect(response).toEqual({ revision: 1, answers: { batch: 'Afternoon' } });
});

test('publisher refreshes collected responses and downloads the authorized export', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/announcements/feed', route =>
    route.fulfill({ json: { items: [], person, canPublish: true } }),
  );
  await page.route('**/api/announcements/manage', route =>
    route.fulfill({
      json: {
        actorId: grant,
        grants: [{ id: grant, kind: 'PROJECT', scopeId: scope }],
        scopes: [],
        canExport: true,
        items: [
          {
            id: announcement,
            title: 'Training registration',
            state: 'PUBLISHED',
            revision: 1,
            ...interval,
          },
        ],
      },
    }),
  );
  let reads = 0;
  await page.route('**/api/announcements/*/responses', route =>
    route.fulfill({
      json: {
        definition: {
          title: 'Training registration',
          kind: 'FORM',
          fields: [{ id: 'batch', label: 'Preferred batch' }],
        },
        responses: [
          {
            name: person.name,
            employeeId: person.employeeId,
            answers: { batch: ++reads === 1 ? 'Morning' : 'Afternoon' },
          },
        ],
      },
    }),
  );
  await page.route('**/api/announcements/*/export', route =>
    route.fulfill({
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: 'export-fixture',
    }),
  );
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'Manage announcements' }).click();
  const dialog = page.getByRole('dialog', { name: 'Announcements' });
  await dialog.getByRole('button', { name: 'View responses' }).click();
  const panel = dialog.getByRole('region', { name: 'Recent responses' });
  await expect(panel.getByRole('cell', { name: 'Morning', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh responses' }).click();
  await expect(panel.getByRole('cell', { name: 'Afternoon', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download responses' }).click();
  expect((await download).suggestedFilename()).toBe('announcement-responses.xlsx');
});
