import { test, expect, fixture, ids } from './browser-fixture';
import { people, request as workshop } from './workforce-data';
for (const kind of ['REQUEST', 'INCIDENT'] as const)
  test(`request composer: ${kind} validates steps, survives recipient failure and submits once with a stable ID`, async ({
    page,
  }) => {
    await fixture(page, { role: 'employee', realistic: true });
    const recipient = '55555555-5555-4555-8555-000000000001',
      writes: Record<string, any>[] = [];
    let failedLookup = false,
      failSave = true,
      created: Record<string, any> | undefined;
    await page.route('**/api/workflows/**', r => {
      const url = new URL(r.request().url());
      if (url.pathname.endsWith('/options')) {
        const q = url.searchParams.get('q') ?? '';
        if (q === 'offline')
          return r.fulfill({
            status: 503,
            json: { error: { message: 'Recipient search temporarily unavailable' } },
          });
        return r.fulfill({
          json: {
            canRequest: true,
            canIncident: true,
            recipients:
              q === 'nobody'
                ? []
                : ['REQUEST', 'INCIDENT'].map(type => ({
                    id: recipient,
                    name: people.manager.displayName,
                    kind: type,
                    reportingManager: true,
                  })),
          },
        });
      }
      return r.fulfill({
        json: {
          record: {
            ...workshop,
            ...created,
            requesterName: people.employee.displayName,
            recipientName: people.manager.displayName,
            status: 'SUBMITTED',
            revision: 1,
          },
          events: [],
        },
      });
    });
    await page.route('**/api/workflows', r => {
      if (r.request().method() !== 'POST') return r.fallback();
      const body = r.request().postDataJSON();
      writes.push(body);
      created = body;
      return failSave
        ? r.fulfill({
            status: 409,
            json: { error: { message: 'Recipient access changed. Review before retrying.' } },
          })
        : r.fulfill({ json: { id: body.id, saved: true } });
    });
    await page.goto('/requests');
    await page.getByRole('button', { name: 'New request', exact: true }).click();
    let dialog = page.getByRole('dialog');
    const next = () =>
      dialog
        .locator('.form-dialog-footer')
        .getByRole('button', { name: 'Next', exact: true })
        .click();
    if (kind === 'INCIDENT')
      await dialog.getByRole('radio', { name: 'Incident', exact: true }).check();
    await next();
    await expect(dialog.locator('.form-dialog-message')).toContainText(
      'Choose what you need help with.',
    );
    await dialog.getByRole('radio', { name: /Learn & Grow/ }).check();
    await next();
    await next();
    await expect(dialog.locator('.form-dialog-message')).toContainText(
      'Enter a subject and description.',
    );
    const title =
      kind === 'REQUEST' ? 'Approve advanced SQL workshop' : 'SQL learning plan does not save';
    await dialog.getByRole('textbox', { name: /Subject/ }).fill(title);
    await dialog
      .getByRole('textbox', { name: /Description/ })
      .fill(
        'Customer reporting delivery needs the SQL learning plan. Please review the workshop and its task schedule.',
      );
    await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('HIGH');
    await next();
    const search = dialog.getByRole('searchbox', { name: 'Search recipient by name' });
    await search.fill('nobody');
    await expect(dialog.getByText(/No match. Try another name/)).toBeVisible();
    await next();
    await expect(dialog.locator('.form-dialog-message')).toContainText(
      'Choose who should receive this.',
    );
    await search.fill('offline');
    await expect(dialog.locator('.form-dialog-message')).toContainText(
      'Recipient search temporarily unavailable',
    );
    await search.fill('Rohan');
    await dialog.getByRole('radio', { name: /Rohan Mehta/ }).check();
    await next();
    await expect(dialog).toContainText(title);
    await expect(dialog).toContainText('Rohan Mehta');
    await dialog
      .getByRole('button', {
        name: kind === 'REQUEST' ? 'Submit request' : 'Submit incident',
        exact: true,
      })
      .click();
    await expect(dialog.locator('.form-dialog-message')).toContainText('Recipient access changed');
    await expect(dialog).toContainText(title);
    failSave = false;
    await dialog
      .getByRole('button', {
        name: kind === 'REQUEST' ? 'Submit request' : 'Submit incident',
        exact: true,
      })
      .click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[0].id).toBe(writes[1].id);
    expect(writes[1]).toMatchObject({
      action: 'CREATE',
      kind,
      category: 'LEARNING',
      priority: 'HIGH',
      recipientId: recipient,
    });
    expect(writes[1]).not.toHaveProperty('actorId');
    expect(writes[1]).not.toHaveProperty('status');
  });
