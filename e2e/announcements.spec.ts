import { test, expect, fixture } from './browser-fixture';
import { fileURLToPath } from 'node:url';

const grant = '11111111-1111-4111-8111-111111111111';
const scope = '22222222-2222-4222-8222-222222222222';
const announcement = '33333333-3333-4333-8333-333333333333';
const person = { name: 'Test Employee', email: 'employee@soprasteria.com', employeeId: '710904' };
const interval = { startsAt: '2000-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z' };

test('publisher uploads a poster, retries the AI design and publishes the previewed poll', async ({
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
        aiAvailable: true,
      },
    }),
  );
  let request;
  const designRequests: string[] = [];
  const prompt = 'Use a blue and red background with green vote buttons';
  await page.route('**/api/announcements/design', route => {
    designRequests.push(route.request().postDataJSON().prompt);
    if (designRequests.length === 1)
      return route.fulfill({ status: 422, json: { error: 'AI design did not pass validation.' } });
    return route.fulfill({
      json: {
        id: '44444444-4444-4444-8444-444444444444',
        feedback: prompt,
        reply: 'Updated the background and vote buttons.',
        design: {
          format: 'sandbox-v1',
          html: '<section class="ann-card"><h2 id="ann-title"></h2><p id="ann-message"></p><button id="ann-vote-0" type="button"></button><button id="ann-vote-1" type="button"></button></section>',
          css: '.ann-card { background: linear-gradient(135deg, #1e3a8a, #991b1b); color: white; } button { background: #166534; color: white; }',
          bindings: [
            { elementId: 'ann-title', kind: 'content', key: 'title' },
            { elementId: 'ann-message', kind: 'content', key: 'message' },
            { elementId: 'ann-vote-0', kind: 'vote', key: '0' },
            { elementId: 'ann-vote-1', kind: 'vote', key: '1' },
          ],
        },
      },
    });
  });
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
  await dialog.getByText('Announcement image (optional)', { exact: true }).click();
  await dialog
    .getByLabel('Upload image')
    .setInputFiles(
      fileURLToPath(new URL('../apps/web/public/brand/assistant-robot-red.webp', import.meta.url)),
    );
  await dialog.getByLabel('Image description').fill('Training poster');
  await expect(dialog.getByLabel('Show image before the form or poll')).toBeChecked();
  await dialog.getByRole('button', { name: 'Continue to preview', exact: true }).click();
  await expect(dialog.getByText('12 eligible employees in the selected audience.')).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Training poster' })).toBeVisible();
  await expect(dialog.locator('.announcement-poster button')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Mobile' }).click();
  await dialog.getByRole('button', { name: 'Banner preview' }).click();
  await expect(dialog.locator('.announcement-strip img')).toHaveCount(0);
  await dialog.locator('.announcement-strip').getByRole('button', { name: 'Open poll' }).click();
  await dialog.locator('.announcement-poster').getByRole('button', { name: 'Open poll' }).click();
  const designPrompt = dialog.getByLabel('Message the design assistant');
  await designPrompt.fill(prompt);
  await designPrompt.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('You can keep using the current preview.');
  await expect(designPrompt).toHaveValue(prompt);
  await dialog.getByRole('button', { name: 'Azure' }).click();
  await expect(dialog.getByText('Preview vote accepted. Nothing was submitted.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry design' }).click();
  await expect(dialog.getByText('Updated the background and vote buttons.')).toBeVisible();
  await expect(designPrompt).toHaveValue('');
  expect(designRequests).toEqual([prompt, prompt]);
  const sandbox = dialog.frameLocator('iframe[title="Training topic design"]');
  const vote = sandbox.getByRole('button', { name: 'SQL' });
  await expect(vote).toHaveCSS('background-color', 'rgb(22, 101, 52)');
  await expect(sandbox.locator('.ann-card')).toHaveCSS('background-image', /linear-gradient/);
  await vote.click();
  await expect(dialog.getByText('Preview vote accepted. Nothing was submitted.')).toBeVisible();
  await dialog.getByText('Adjust appearance', { exact: true }).click();
  await dialog.getByLabel('Button color').selectOption('navy');
  await dialog.getByRole('button', { name: 'Apply appearance' }).click();
  await expect(vote).toHaveCSS('background-color', 'rgb(24, 34, 53)');
  await dialog.getByRole('button', { name: 'Compare previous' }).click();
  await expect(vote).toHaveCSS('background-color', 'rgb(22, 101, 52)');
  await expect(dialog.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Show current design' }).click();
  await expect(vote).toHaveCSS('background-color', 'rgb(24, 34, 53)');
  await dialog.getByRole('button', { name: 'Undo design change' }).click();
  await expect(vote).toHaveCSS('background-color', 'rgb(22, 101, 52)');
  const publish = dialog.getByRole('button', { name: 'Publish announcement' });
  await expect(publish).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check audience' }).click();
  await publish.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Announcement published for the selected schedule.')).toBeVisible();
  expect(request).toMatchObject({
    id: announcement,
    receipt: 'fixture-receipt',
    grantId: grant,
    publish: true,
    definition: {
      kind: 'POLL',
      imagePopup: true,
      popup: true,
      options: ['Azure', 'SQL'],
      exports: ['grade'],
      selectedVersion: '44444444-4444-4444-8444-444444444444',
      audience: [{ id: scope, kind: 'PROJECT' }],
    },
  });
});

test('publisher styles a standard form with AI unavailable and saves the design', async ({
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
        scopes: [{ id: scope, label: 'NHS IT Projects', kind: 'PROJECT', grantId: grant }],
        items: [],
        aiAvailable: false,
      },
    }),
  );
  await page.route('**/api/announcements/draft', route =>
    route.fulfill({
      json: route.request().postDataJSON().preview
        ? { id: announcement, audienceCount: 12, receipt: 'fixture-receipt' }
        : { id: announcement, revision: 1, state: 'DRAFT' },
    }),
  );
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const dialog = page.locator('dialog.announcement-manager');
  await dialog.getByLabel('Title', { exact: true }).fill('Training registration');
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Field 1 label').fill('Preferred time');
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Field 2 label').fill('Comments');
  await dialog.getByRole('button', { name: 'Continue to preview', exact: true }).click();
  await dialog.getByText('Adjust appearance', { exact: true }).click();
  await dialog.getByLabel('Background').selectOption('blue-red');
  await dialog.getByLabel('Button color').selectOption('green');
  await dialog.getByLabel('Spacing').selectOption('compact');
  await dialog.getByLabel('Form layout').selectOption('two');
  await dialog.getByRole('button', { name: 'Apply appearance' }).click();
  const preview = dialog.getByRole('region', { name: 'Live announcement preview' });
  await expect(preview.locator('.announcement-card')).toHaveCSS(
    'background-image',
    /linear-gradient/,
  );
  await expect(preview.locator('.announcement-card')).toHaveCSS('padding-top', '14px');
  await expect(preview.getByRole('heading', { name: 'Training registration' })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  const appearancePanel = await preview.locator('.announcement-appearance').boundingBox();
  const previewStage = await preview.locator('.announcement-preview-stage').boundingBox();
  expect(appearancePanel!.y + appearancePanel!.height).toBeLessThan(previewStage!.y);
  await preview.getByRole('button', { name: 'Mobile' }).click();
  const fieldPositions = async () => {
    const first = await preview.getByRole('textbox', { name: 'Preferred time' }).boundingBox();
    const second = await preview.getByRole('textbox', { name: 'Comments' }).boundingBox();
    return { stacked: second!.y > first!.y, sideBySide: second!.x > first!.x };
  };
  await expect.poll(fieldPositions).toEqual({ stacked: true, sideBySide: false });
  if (page.viewportSize()!.width > 800) {
    await preview.getByRole('button', { name: 'Desktop' }).click();
    await expect.poll(fieldPositions).toEqual({ stacked: false, sideBySide: true });
  }
  await expect(preview.getByRole('button', { name: 'Register' })).toHaveCSS(
    'background-color',
    'rgb(22, 101, 52)',
  );
  await preview.getByRole('button', { name: 'Register' }).click();
  await expect(dialog.getByText('Preview response accepted. Nothing was submitted.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Publish announcement' })).toBeDisabled();
  const request = page.waitForRequest(request =>
    request.url().endsWith('/api/announcements/draft'),
  );
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  expect((await request).postDataJSON().definition.design).toMatchObject({
    format: 'appearance-v1',
    appearance: { background: 'blue-red', button: 'green', spacing: 'compact', columns: 'two' },
  });
  await expect(dialog.getByText('Draft saved.', { exact: true })).toBeVisible();
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
