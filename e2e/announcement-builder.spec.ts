import { test, expect, fixture, ids } from './browser-fixture';

test('two-step builder refines with context, retries safely and rechecks the selected design before publishing', async ({
  page,
}, info) => {
  await fixture(page, { role: 'admin' });
  const grant = ids.api;
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const versions = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
  await page.route('**/api/announcements/feed*', route =>
    route.fulfill({
      json: { items: [], canPublish: true, person: { name: 'Admin', employeeId: '100' } },
    }),
  );
  await page.route('**/api/announcements/manage*', route =>
    route.fulfill({
      json: {
        actorId: ids.person,
        grants: [{ id: grant, kind: 'PROJECT', scopeId: grant }],
        scopes: [{ id: grant, kind: 'PROJECT', grantId: grant, label: 'Training project' }],
        items: [],
        aiAvailable: true,
      },
    }),
  );
  const saves: any[] = [];
  let saved: any;
  let published = 0;
  await page.route('**/api/announcements/draft', route => {
    const body = route.request().postDataJSON();
    saves.push(body);
    if (!body.preview) {
      saved = body;
      if (body.publish) published++;
    }
    return route.fulfill({
      json: body.preview
        ? { id, audienceCount: 8, receipt: 'current-receipt' }
        : { id, revision: 1, state: body.publish ? 'PUBLISHED' : 'DRAFT' },
    });
  });
  await page.route('**/api/announcements/' + id + '/draft', route =>
    route.fulfill({ json: { ...saved, id, revision: 1, state: 'DRAFT' } }),
  );
  let responseWrites = 0;
  await page.route('**/api/announcements/*/respond', route => {
    responseWrites++;
    return route.fulfill({ json: {} });
  });
  const designs: any[] = [];
  await page.route('**/api/announcements/design', route => {
    const body = route.request().postDataJSON();
    designs.push(body);
    if (designs.length === 2)
      return route.fulfill({
        status: 503,
        json: { error: { message: 'Design is temporarily unavailable. Please retry.' } },
      });
    const refined = designs.length > 2;
    return route.fulfill({
      json: {
        id: versions[refined ? 1 : 0],
        feedback: body.prompt,
        reply: refined
          ? 'I used two columns and kept the registration action connected.'
          : 'I created a branded registration form from your details.',
        design: {
          html: '<section><div data-slot="title"></div><div data-slot="message"></div><div data-slot="image"></div><div data-slot="action"></div></section>',
          css: `section { color: #126b70; background-color: #ffffff; --form-layout: ${refined ? 'two-column' : 'single'}; --button-width: full; --visual-style: ${refined ? 'soft' : 'spotlight'}; --heading-scale: ${refined ? 'balanced' : 'hero'}; --corner-style: ${refined ? 'soft' : 'rounded'}; --button-style: ${refined ? 'outline' : 'solid'}; }`,
          order: ['title', 'message', 'image', 'action'],
          color: '#126b70',
          background: '#ffffff',
          align: 'left',
          layout: 'stack',
          formLayout: refined ? 'two-column' : 'single',
          buttonWidth: 'full',
          visualStyle: refined ? 'soft' : 'spotlight',
          headingScale: refined ? 'balanced' : 'hero',
          cornerStyle: refined ? 'soft' : 'rounded',
          buttonStyle: refined ? 'outline' : 'solid',
        },
      },
    });
  });
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const editor = page.locator('dialog.announcement-manager');
  await expect(editor.getByLabel('Step 1 of 2 - Basic details')).toBeVisible();
  await expect(editor.getByLabel('Message the design assistant')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Continue to AI design' }).click();
  await expect(
    editor.getByRole('region', { name: 'New announcement content' }).getByRole('alert'),
  ).toContainText('Complete the highlighted field');
  expect(designs).toHaveLength(0);
  await editor.getByLabel('Title', { exact: true }).fill('Cloud training');
  await editor.getByLabel('Message', { exact: true }).fill('Register for your preferred batch.');
  await editor.getByRole('button', { name: 'Add field' }).click();
  await editor.getByLabel('Field 1 label').fill('Preferred batch');
  await editor.getByLabel('Field type').selectOption('choice');
  await editor.getByLabel('Options (one per line)').fill('Morning\nEvening');
  await editor.getByRole('button', { name: 'Continue to AI design' }).click();
  await expect(
    editor.getByText('I created a branded registration form from your details.'),
  ).toBeVisible();
  await expect(editor.getByLabel('Step 2 of 2 - Design & preview')).toBeVisible();
  const headingBox = (await editor
    .getByRole('heading', { name: 'New announcement', exact: true })
    .boundingBox())!;
  const stepBox = (await editor.getByLabel('Step 2 of 2 - Design & preview').boundingBox())!;
  expect(
    Math.abs(headingBox.y + headingBox.height / 2 - stepBox.y - stepBox.height / 2),
  ).toBeLessThan(4);
  await expect(editor.getByText('Design settings', { exact: true })).toHaveCount(0);
  const controls = editor.getByLabel('Preview controls');
  const controlBoxes = await controls
    .getByRole('button')
    .evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().y));
  expect(Math.max(...controlBoxes) - Math.min(...controlBoxes)).toBeLessThan(2);
  await expect(controls.getByRole('button', { name: 'Desktop', exact: true })).toHaveText('');
  await expect(controls.getByRole('button', { name: 'Mobile', exact: true })).toHaveText('');
  const publish = editor.getByRole('button', { name: 'Publish announcement', exact: true });
  await expect(publish).toBeDisabled();
  const preview = editor.getByRole('region', { name: 'Live announcement preview' });
  const chat = editor.getByRole('region', { name: 'AI design chat' });
  await expect(preview.locator('.announcement-card')).toHaveClass(/style-spotlight/);
  await expect(preview.locator('.announcement-card')).toHaveCSS('border-radius', '24px');
  const previewBox = (await preview.boundingBox())!;
  const chatBox = (await chat.boundingBox())!;
  if (page.viewportSize()!.width > 760)
    expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(chatBox.x);
  else expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(chatBox.y);
  expect(designs[0].definition.fields).toMatchObject([
    { label: 'Preferred batch', type: 'choice', options: ['Morning', 'Evening'] },
  ]);
  const prompt = editor.getByLabel('Message the design assistant');
  await prompt.fill('Use two columns and keep the primary button full width');
  await prompt.press('Enter');
  await expect(
    editor.getByRole('region', { name: 'New announcement content' }).getByRole('alert'),
  ).toContainText('Design is temporarily unavailable');
  await expect(prompt).toHaveValue('Use two columns and keep the primary button full width');
  await expect(
    editor.getByText('I created a branded registration form from your details.'),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    editor.getByText('I used two columns and kept the registration action connected.'),
  ).toBeVisible();
  await expect(preview.locator('.announcement-card')).toHaveClass(/style-soft/);
  expect(designs[2].definition.versions).toMatchObject([
    { id: versions[0], reply: 'I created a branded registration form from your details.' },
  ]);
  expect(designs[2].definition.selectedVersion).toBe(versions[0]);
  await editor.getByRole('button', { name: 'Use this version' }).click();
  await expect(publish).toBeDisabled();
  await preview.getByLabel('Preferred batch').selectOption('Evening');
  await preview.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(editor.getByText('Preview response accepted. Nothing was submitted.')).toBeVisible();
  expect(responseWrites).toBe(0);
  await editor.getByRole('button', { name: 'Review audience' }).click();
  await expect(publish).toBeEnabled();
  expect(saves.at(-1).definition.selectedVersion).toBe(versions[0]);
  await editor.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(publish).toBeDisabled();
  await prompt.fill('Make the spacing more generous');
  await expect(editor.getByText('Draft saved on this device.')).toBeVisible();
  // Wait for the debounced local snapshot, without relying on an arbitrary timeout.
  await expect
    .poll(() =>
      page.evaluate(
        actor => JSON.parse(localStorage.getItem('announcement-draft:v1:' + actor) || '{}').prompt,
        ids.person,
      ),
    )
    .toBe('Make the spacing more generous');
  await page.reload();
  await page.getByRole('button', { name: 'Resume local draft' }).click();
  await expect(editor.getByLabel('Step 2 of 2 - Design & preview')).toBeVisible();
  await expect(prompt).toHaveValue('Make the spacing more generous');
  await expect(publish).toBeDisabled();
  await editor.getByRole('button', { name: 'Review audience' }).click();
  await expect(publish).toBeEnabled();
  await page.screenshot({
    path: info.outputPath('announcement-design-studio.png'),
    fullPage: true,
  });
  await publish.click();
  await expect(editor).toHaveCount(0);
  expect(published).toBe(1);
  expect(saved).toMatchObject({
    id,
    receipt: 'current-receipt',
    revision: 1,
    publish: true,
    definition: { selectedVersion: versions[0] },
  });
});
