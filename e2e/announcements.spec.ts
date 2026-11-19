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
  await page.route('**/api/announcements/feed*', route =>
    route.fulfill({ json: { items: [], person, canPublish: true } }),
  );
  await page.route('**/api/announcements/manage', route =>
    route.fulfill({
      json: {
        actorId: '11111111-1111-4111-8111-111111111111',
        grants: [{ id: grant, kind: 'PROJECT', scopeId: scope }],
        scopes: [{ id: scope, label: 'NHS IT Projects', kind: 'PROJECT', grantId: grant }],
        items: [],
        aiAvailable: false,
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
  await expect(page.getByRole('tab')).toHaveText(['Announcements', 'Responses']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'New announcement' }).click();
  const dialog = page.locator('dialog.announcement-manager');
  await dialog.getByLabel('Title', { exact: true }).fill('Training topic');
  await dialog.getByLabel('Interaction').selectOption('POLL');
  await dialog.getByLabel('Option 1').fill('Azure');
  await dialog.getByLabel('Option 2').fill('SQL');
  await dialog.getByText('Export columns (optional)', { exact: true }).click();
  await dialog.getByLabel('Grade').check();
  await dialog.getByRole('button', { name: 'Continue to AI design', exact: true }).click();
  await expect(dialog.getByText('12 eligible employees in the selected audience.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Mobile' }).click();
  await dialog.getByRole('button', { name: 'Banner preview' }).click();
  await dialog.locator('.announcement-strip').getByRole('button', { name: 'Open poll' }).click();
  await dialog.getByRole('button', { name: 'Azure' }).click();
  await expect(dialog.getByText('Preview vote accepted. Nothing was submitted.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish announcement' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Announcement published for the selected schedule.')).toBeVisible();
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
  await page.route('**/api/announcements/feed*', route =>
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
                  type: 'radio',
                  required: true,
                  options: ['Morning', 'Afternoon'],
                },
                {
                  id: 'confirm',
                  label: 'I can attend',
                  type: 'checkbox',
                  required: true,
                  options: [],
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
  await expect(dialog.locator('.announcement-identity dd')).toHaveText([
    person.name,
    person.email,
    person.employeeId,
  ]);
  await expect(dialog.locator('.announcement-identity input')).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Morning' }).check();
  await dialog.getByRole('radio', { name: 'Afternoon' }).check();
  await expect(dialog.getByRole('radio', { name: 'Morning' })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: 'I can attend' }).check();
  await dialog.getByRole('button', { name: 'Register' }).click();
  await expect(
    dialog.getByRole('region', { name: 'Training registration content' }).getByRole('alert'),
  ).toHaveText('Please retry your response.');
  await expect(dialog.getByRole('radio', { name: 'Afternoon' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'I can attend' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Register' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Response submitted.', { exact: true })).toBeVisible();
  expect(response).toEqual({
    revision: 1,
    responseRevision: 0,
    answers: { batch: 'Afternoon', confirm: true },
  });
});

test('publisher refreshes collected responses and downloads the authorized export', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/announcements/feed*', route =>
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
  await page.getByRole('tab', { name: 'Responses', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const panel = page.getByRole('region', { name: 'Recent responses' });
  await expect(panel.getByRole('cell', { name: 'Morning', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh responses' }).click();
  await expect(panel.getByRole('cell', { name: 'Afternoon', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download responses' }).click();
  expect((await download).suggestedFilename()).toBe('announcement-responses.xlsx');
});

test('feed failures show an actionable error instead of an empty feed', async ({ page }) => {
  await fixture(page, { role: 'employee' });
  let unavailable = true;
  await page.route('**/api/announcements/feed*', route =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: { message: 'Announcements are waking up.' } } })
      : route.fulfill({ json: { items: [], person, canPublish: false } }),
  );
  await page.goto('/announcements');
  const workspace = page.getByRole('region', { name: 'Announcements', exact: true });
  await expect(workspace.getByRole('alert')).toContainText('Announcements are waking up.');
  await expect(workspace.getByText('No active announcements')).toHaveCount(0);
  unavailable = false;
  await workspace.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(workspace.getByText('No active announcements', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Responses', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New announcement' })).toHaveCount(0);
});

test('two-tab workspace switches responses without stale rows and recovers from failures', async ({
  page,
}, info) => {
  await fixture(page, { role: 'admin' });
  const second = '44444444-4444-4444-8444-444444444444';
  await page.route('**/api/announcements/feed*', route =>
    route.fulfill({ json: { items: [], person, canPublish: true } }),
  );
  await page.route('**/api/announcements/manage', route =>
    route.fulfill({
      json: {
        actorId: grant,
        grants: [{ id: grant, kind: 'PROJECT', scopeId: scope }],
        scopes: [],
        canExport: false,
        items: [
          {
            id: announcement,
            title: 'Cloud skills workshop',
            state: 'PUBLISHED',
            revision: 1,
            ...interval,
          },
          {
            id: second,
            title: 'Next quarter training preferences',
            state: 'CLOSED',
            revision: 2,
            ...interval,
          },
          {
            id: scope,
            title: 'Engineering community meetup',
            state: 'DRAFT',
            revision: 1,
            ...interval,
          },
        ],
      },
    }),
  );
  let retry = false;
  await page.route('**/api/announcements/*/responses', route => {
    const isSecond = route.request().url().includes(second);
    if (isSecond && !retry)
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Responses temporarily unavailable.' } },
      });
    return route.fulfill({
      json: {
        definition: {
          title: isSecond ? 'Next quarter training preferences' : 'Cloud skills workshop',
          kind: 'FORM',
          fields: [{ id: 'topic', label: 'Preferred topic' }],
        },
        responses: [
          {
            name: 'Alex Morgan',
            employeeId: 'EMP-1024',
            email: 'alex@example.com',
            answers: { topic: isSecond ? 'Data engineering' : 'Cloud architecture' },
          },
        ],
      },
    });
  });
  await page.goto('/announcements');
  await expect(page.getByRole('tab')).toHaveText(['Announcements', 'Responses']);
  await expect(page.getByRole('button', { name: 'Edit draft' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('announcements-workspace.png'), fullPage: true });
  const announcementsTab = page.getByRole('tab', { name: 'Announcements', exact: true });
  const responsesTab = page.getByRole('tab', { name: 'Responses', exact: true });
  await announcementsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(responsesTab).toBeFocused();
  await expect(responsesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('cell', { name: 'Cloud architecture', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download responses' })).toHaveCount(0);
  const selector = page.getByRole('combobox', { name: 'Announcement', exact: true });
  await expect(selector.locator('option')).toHaveCount(2);
  await selector.selectOption(second);
  await expect(
    page.getByRole('region', { name: 'Recent responses' }).getByRole('alert'),
  ).toContainText('Responses temporarily unavailable.');
  await expect(page.getByRole('cell', { name: 'Cloud architecture', exact: true })).toHaveCount(0);
  retry = true;
  await page.getByRole('button', { name: 'Retry responses' }).click();
  await expect(page.getByRole('cell', { name: 'Data engineering', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('announcement-responses.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: info.outputPath('announcement-responses-dark.png'),
    fullPage: true,
  });
});

test('publisher can retry management loading and close an announcement without a manager dialog', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  let closed = false;
  let retry = false;
  let feedReads = 0;
  await page.route('**/api/announcements/feed*', route => {
    feedReads++;
    return route.fulfill({ json: { items: [], person, canPublish: true } });
  });
  await page.route('**/api/announcements/manage', route =>
    retry
      ? route.fulfill({
          json: {
            grants: [{ id: grant, kind: 'PROJECT', scopeId: scope }],
            scopes: [],
            items: [
              {
                id: announcement,
                title: 'Training registration',
                state: closed ? 'CLOSED' : 'PUBLISHED',
                revision: closed ? 2 : 1,
                ...interval,
              },
            ],
          },
        })
      : route.fulfill({
          status: 503,
          json: { error: { message: 'Publishing workspace unavailable.' } },
        }),
  );
  await page.route('**/api/announcements/*/close', route => {
    expect(route.request().postDataJSON()).toEqual({ revision: 1 });
    closed = true;
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto('/announcements');
  const workspace = page.getByRole('region', { name: 'Announcements', exact: true });
  await expect(workspace.getByRole('alert')).toContainText('Publishing workspace unavailable.');
  retry = true;
  await workspace.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New announcement' })).toBeVisible();
  await page.locator('summary[aria-label="More actions for Training registration"]').click();
  await page.getByRole('button', { name: 'Close announcement', exact: true }).click();
  expect(closed).toBe(false);
  const previousFeedReads = feedReads;
  await page.getByRole('button', { name: 'Confirm close', exact: true }).click();
  await expect(page.getByText('Announcement closed.', { exact: true })).toBeVisible();
  await expect(page.locator('.announcement-state')).toHaveText('Closed');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(feedReads).toBeGreaterThan(previousFeedReads);
});

test('closing the editor refreshes saved drafts in the inline list', async ({ page }) => {
  await fixture(page, { role: 'admin' });
  let saved = false;
  await page.route('**/api/announcements/feed*', route =>
    route.fulfill({ json: { items: [], person, canPublish: true } }),
  );
  await page.route('**/api/announcements/manage', route =>
    route.fulfill({
      json: {
        grants: [{ id: grant, kind: 'PROJECT', scopeId: scope }],
        scopes: [],
        items: saved
          ? [
              {
                id: announcement,
                title: 'Saved workshop draft',
                state: 'DRAFT',
                revision: 1,
                ...interval,
              },
            ]
          : [],
      },
    }),
  );
  await page.route('**/api/announcements/draft', route => {
    saved = true;
    return route.fulfill({ json: { id: announcement, revision: 1, state: 'DRAFT' } });
  });
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Title', { exact: true }).fill('Saved workshop draft');
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(editor.getByText('Draft saved.', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Close Edit announcement', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const savedRow = page.getByRole('article').filter({ hasText: 'Saved workshop draft' });
  await expect(savedRow.getByRole('button', { name: 'Edit draft' })).toBeVisible();
});
