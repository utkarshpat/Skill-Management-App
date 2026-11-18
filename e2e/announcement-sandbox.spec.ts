import { test, expect, fixture, ids } from './browser-fixture';
const announcement = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const person = { name: 'Test Employee', email: 'employee@soprasteria.com', employeeId: '710904' };
function design(fieldId: string) {
  return {
    format: 'sandbox-v1',
    html: `<section class="ann-custom"><div class="ann-intro"><h2 id="ann-title"></h2><p id="ann-message"></p><button id="ann-open">Open registration</button></div><form id="ann-form"><div class="ann-grid"><label for="ann-name">Name</label><input id="ann-name"><label for="ann-email">Work email</label><input id="ann-email"><label for="ann-employee-id">Employee ID</label><input id="ann-employee-id"><label for="ann-field-${fieldId}">Preferred batch</label><select id="ann-field-${fieldId}"><option>Untrusted extra option</option></select></div><button id="ann-submit">Register now</button></form></section>`,
    css: '.ann-custom{padding:24px;border-radius:26px;background:linear-gradient(120deg,#eefafa,#fff);color:#182235}.ann-intro{border-bottom:2px solid #126b70;margin-bottom:16px}h2{font-size:30px;letter-spacing:-1px}.ann-grid{display:grid;gap:8px}input,select{min-height:44px;width:100%;border:1px solid #a9bfc4;border-radius:10px;padding:8px}button{background:#126b70;color:#fff;border:0;border-radius:12px;padding:12px 20px;min-height:44px;margin-top:12px}@media(min-width:600px){.ann-grid{grid-template-columns:1fr 2fr;align-items:center}}',
    bindings: [
      { elementId: 'ann-title', kind: 'content', key: 'title' },
      { elementId: 'ann-message', kind: 'content', key: 'message' },
      { elementId: 'ann-form', kind: 'form', key: 'response' },
      { elementId: 'ann-open', kind: 'action', key: 'open-form' },
      { elementId: 'ann-submit', kind: 'action', key: 'submit' },
      { elementId: 'ann-name', kind: 'identity', key: 'name' },
      { elementId: 'ann-email', kind: 'identity', key: 'email' },
      { elementId: 'ann-employee-id', kind: 'identity', key: 'employeeId' },
      { elementId: 'ann-field-' + fieldId, kind: 'field', key: fieldId },
    ],
  };
}
function definition(fieldId = 'batch') {
  return {
    kind: 'FORM',
    title: 'Training registration',
    message: 'Pick the batch that suits you.',
    cta: 'Register',
    fields: [
      {
        id: fieldId,
        label: 'Preferred batch',
        type: 'choice',
        required: true,
        options: ['Morning', 'Evening'],
      },
    ],
    options: [],
    audience: [{ kind: 'PROJECT', id: ids.api }],
    exports: [],
    versions: [],
    popup: false,
    marquee: false,
    imageAlt: '',
    imagePosition: 'center',
    design: design(fieldId),
  };
}

test('free HTML/CSS runs only inside the sandbox and preview actions never submit real data', async ({
  page,
}, info) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/announcements/feed*', r =>
    r.fulfill({ json: { items: [], person, canPublish: true } }),
  );
  await page.route('**/api/announcements/manage*', r =>
    r.fulfill({
      json: {
        actorId: ids.person,
        grants: [{ id: ids.api, kind: 'PROJECT', scopeId: ids.api }],
        scopes: [{ id: ids.api, kind: 'PROJECT', grantId: ids.api, label: 'Training project' }],
        items: [],
        aiAvailable: true,
      },
    }),
  );
  await page.route('**/api/announcements/draft', r =>
    r.fulfill({ json: { id: announcement, receipt: 'receipt', audienceCount: 4 } }),
  );
  await page.route('**/api/announcements/design', r => {
    const body = r.request().postDataJSON();
    return r.fulfill({
      json: {
        id: announcement,
        feedback: body.prompt,
        reply: 'I designed a custom responsive form.',
        design: design(body.definition.fields[0].id),
      },
    });
  });
  let writes = 0,
    external = 0;
  await page.route('**/api/announcements/*/respond', r => {
    writes++;
    return r.fulfill({ json: {} });
  });
  page.on('request', r => {
    if (r.url().includes('blocked-external.example')) external++;
  });
  await page.goto('/announcements');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const editor = page.locator('dialog.announcement-manager');
  await editor.getByLabel('Title', { exact: true }).fill('Designer training');
  await editor.getByRole('button', { name: 'Add field' }).click();
  await editor.getByLabel('Field 1 label').fill('Preferred batch');
  await editor.getByLabel('Field type').selectOption('choice');
  await editor.getByLabel('Options (one per line)').fill('Morning\nEvening');
  await editor.getByRole('button', { name: 'Continue to AI design' }).click();
  const iframe = editor.locator('iframe.announcement-sandbox');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const frame = editor.frameLocator('iframe.announcement-sandbox');
  await expect(frame.getByRole('heading', { name: 'Designer training' })).toBeVisible();
  await expect(frame.getByLabel('Name', { exact: true })).toHaveValue('Preview Employee');
  await expect(frame.getByLabel('Name', { exact: true })).toBeDisabled();
  await expect(frame.getByLabel('Preferred batch').locator('option')).toHaveText([
    'Select an option',
    'Morning',
    'Evening',
  ]);
  await frame.getByLabel('Preferred batch').selectOption('Evening');
  await frame.getByRole('button', { name: 'Register now' }).click();
  await expect(editor.getByText('Preview response accepted. Nothing was submitted.')).toBeVisible();
  expect(writes).toBe(0);
  const content = page.frames().find(frame => frame.url().endsWith('/announcement-sandbox.html'));
  expect(
    await content!.evaluate(() => {
      try {
        void window.parent.document.body;
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(
    await content!.evaluate(async () => {
      try {
        await fetch('https://blocked-external.example/collect');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  expect(external).toBe(0);
  await page.screenshot({ path: info.outputPath('sandbox-designer-preview.png'), fullPage: true });
});

test('live sandbox buttons use authenticated app submission and retain values through retry', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  await page.route('**/api/announcements/feed*', r =>
    r.fulfill({
      json: {
        items: [
          {
            id: announcement,
            revision: 2,
            startsAt: '2000-01-01T00:00:00Z',
            endsAt: '2099-01-01T00:00:00Z',
            definition: definition(),
            answered: false,
            hasImage: false,
          },
        ],
        person,
        canPublish: false,
      },
    }),
  );
  const sent: any[] = [];
  await page.route('**/api/announcements/*/respond', r => {
    sent.push(r.request().postDataJSON());
    return r.fulfill(
      sent.length === 1
        ? { status: 503, json: { error: { message: 'Try your response again.' } } }
        : { json: { saved: true } },
    );
  });
  await page.goto('/profile');
  const banner = page.frameLocator('iframe.announcement-sandbox');
  await banner.getByRole('button', { name: 'Open registration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Training registration' });
  const form = dialog.frameLocator('iframe.announcement-sandbox');
  await expect(form.getByLabel('Work email')).toHaveValue(person.email);
  await form.getByLabel('Preferred batch').selectOption('Evening');
  await form.getByRole('button', { name: 'Register now' }).click();
  await expect(
    dialog.getByRole('region', { name: 'Training registration content' }).getByRole('alert'),
  ).toHaveText('Try your response again.');
  await expect(form.getByLabel('Preferred batch')).toHaveValue('Evening');
  await form.getByRole('button', { name: 'Register now' }).click();
  await expect(dialog.getByText('Response submitted.')).toBeVisible();
  expect(sent).toEqual([
    { revision: 2, answers: { batch: 'Evening' } },
    { revision: 2, answers: { batch: 'Evening' } },
  ]);
  await expect(form.getByRole('button', { name: 'Register now' })).toBeDisabled();
});

test('sandbox poll IDs map only to configured options and recorded votes become read only', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  const def = {
    ...definition(),
    kind: 'POLL',
    fields: [],
    options: ['Azure', 'SQL'],
    design: {
      format: 'sandbox-v1',
      html: '<h2 id="ann-title"></h2><p id="ann-message"></p><button id="ann-vote-0">Wrong label</button><button id="ann-vote-1">Wrong label</button>',
      css: 'button{min-height:44px;background:#126b70;color:white;margin:6px}',
      bindings: [
        { elementId: 'ann-title', kind: 'content', key: 'title' },
        { elementId: 'ann-message', kind: 'content', key: 'message' },
        { elementId: 'ann-vote-0', kind: 'vote', key: '0' },
        { elementId: 'ann-vote-1', kind: 'vote', key: '1' },
      ],
    },
  };
  await page.route('**/api/announcements/feed*', r =>
    r.fulfill({
      json: {
        items: [
          {
            id: announcement,
            revision: 1,
            startsAt: '2000-01-01T00:00:00Z',
            endsAt: '2099-01-01T00:00:00Z',
            definition: def,
            answered: false,
            hasImage: false,
          },
        ],
        person,
        canPublish: false,
      },
    }),
  );
  const sent: any[] = [];
  await page.route('**/api/announcements/*/respond', r => {
    sent.push(r.request().postDataJSON());
    return r.fulfill({ json: { saved: true } });
  });
  await page.goto('/profile');
  const frame = page.frameLocator('iframe.announcement-sandbox');
  await frame.getByRole('button', { name: 'SQL', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'SQL', exact: true })).toBeDisabled();
  expect(sent).toEqual([{ revision: 1, answers: { vote: 'SQL' } }]);
});
