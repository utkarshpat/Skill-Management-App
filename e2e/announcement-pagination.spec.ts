import { test, expect, fixture, ids } from './browser-fixture';
const oldId = '44444444-4444-4444-8444-444444444444';
const freshId = '55555555-5555-4555-8555-555555555555';
const definition = {
  kind: 'FORM',
  title: 'Expired training',
  message: 'Original content',
  cta: 'Apply',
  audience: [{ kind: 'PROJECT', id: ids.api }],
  fields: [],
  options: [],
  exports: [],
  versions: [],
  popup: false,
  marquee: false,
  imageAlt: '',
  imagePosition: 'center',
};

test('older expired announcements can be republished as a separate previewed announcement', async ({
  page,
}) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/announcements/feed*', r =>
    r.fulfill({
      json: { items: [], person: { name: 'Admin', employeeId: '100' }, canPublish: true },
    }),
  );
  await page.route('**/api/announcements/manage*', r =>
    r.fulfill({
      json: {
        actorId: ids.person,
        grants: [{ id: ids.api, kind: 'PROJECT', scopeId: ids.api }],
        scopes: [{ id: ids.api, kind: 'PROJECT', grantId: ids.api, label: 'Project' }],
        aiAvailable: false,
        canExport: true,
        page: Number(new URL(r.request().url()).searchParams.get('page') ?? 1),
        hasMore: !r.request().url().includes('page=2'),
        items: r.request().url().includes('page=2')
          ? [
              {
                id: oldId,
                title: 'Expired training',
                revision: 4,
                grantId: ids.api,
                state: 'PUBLISHED',
                startsAt: '2026-11-01T00:00:00Z',
                endsAt: '2026-11-02T00:00:00Z',
              },
            ]
          : [],
      },
    }),
  );
  await page.route('**/api/announcements/' + oldId + '/draft', r =>
    r.fulfill({
      json: {
        id: oldId,
        revision: 4,
        grantId: ids.api,
        state: 'PUBLISHED',
        startsAt: '2026-11-01T00:00:00Z',
        endsAt: '2026-11-02T00:00:00Z',
        definition,
      },
    }),
  );
  const saves: Record<string, unknown>[] = [];
  await page.route('**/api/announcements/draft', r => {
    const body = r.request().postDataJSON();
    saves.push(body);
    return r.fulfill({
      json: body.preview
        ? { id: freshId, audienceCount: 1, receipt: 'receipt' }
        : { id: freshId, revision: 1, state: 'PUBLISHED' },
    });
  });
  await page.goto('/announcements');
  await page
    .getByRole('group', { name: 'Your announcement pages' })
    .getByRole('button', { name: 'More announcements' })
    .click();
  const row = page.locator('.announcement-list-item').filter({ hasText: 'Expired training' });
  await expect(row.getByText('Expired', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Republish', exact: true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Expired training');
  await expect(editor.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Original content',
  );
  await editor.getByRole('button', { name: 'Continue to preview', exact: true }).click();
  await editor.getByRole('button', { name: 'Publish announcement' }).click();
  expect(saves[0]).not.toHaveProperty('id');
  expect(saves[0].revision).toBe(0);
  expect(saves[1]).toMatchObject({ id: freshId, publish: true, receipt: 'receipt', revision: 0 });
  expect(saves.every(s => s.id !== oldId)).toBe(true);
});

test('active feed pages expose older announcements and direct links resolve beyond page one', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  const reads: string[] = [];
  await page.route('**/api/announcements/feed*', r => {
    const url = new URL(r.request().url());
    reads.push(url.search);
    const older =
      url.searchParams.get('page') === '2' || url.searchParams.get('announcement') === oldId;
    return r.fulfill({
      json: {
        person: { name: 'Employee', email: 'employee@soprasteria.com', employeeId: '100' },
        canPublish: false,
        page: older ? 2 : 1,
        hasMore: !older,
        items: [
          {
            id: older ? oldId : freshId,
            revision: 1,
            startsAt: '2026-11-01T00:00:00Z',
            endsAt: '2099-01-01T00:00:00Z',
            answered: false,
            definition: { ...definition, title: older ? 'Older active event' : 'New event' },
          },
        ],
      },
    });
  });
  await page.goto('/announcements');
  await page
    .getByRole('group', { name: 'Active announcement pages' })
    .getByRole('button', { name: 'More announcements' })
    .click();
  await expect(page.getByRole('heading', { name: 'Older active event' })).toBeVisible();
  await page.goto('/announcements?announcement=' + oldId);
  await expect(page.getByRole('dialog', { name: 'Older active event' })).toBeVisible();
  expect(reads.some(q => q.includes('announcement=' + oldId))).toBe(true);
});

test('responses beyond the first hundred remain reachable without stale rows', async ({ page }) => {
  await fixture(page, { role: 'admin' });
  await page.route('**/api/announcements/feed*', r =>
    r.fulfill({
      json: { items: [], person: { name: 'Admin', employeeId: '100' }, canPublish: true },
    }),
  );
  await page.route('**/api/announcements/manage*', r =>
    r.fulfill({
      json: {
        actorId: ids.person,
        grants: [{ id: ids.api, kind: 'PROJECT', scopeId: ids.api }],
        scopes: [],
        aiAvailable: false,
        canExport: false,
        items: [
          {
            id: oldId,
            title: 'Training responses',
            revision: 1,
            grantId: ids.api,
            state: 'PUBLISHED',
            startsAt: '2026-11-01T00:00:00Z',
            endsAt: '2099-01-01T00:00:00Z',
          },
        ],
      },
    }),
  );
  await page.route('**/api/announcements/*/responses*', r => {
    const second = new URL(r.request().url()).searchParams.get('page') === '2';
    return r.fulfill({
      json: {
        definition: { title: 'Training responses', kind: 'FORM', fields: [] },
        page: second ? 2 : 1,
        hasMore: !second,
        responses: [
          {
            name: second ? 'Older response' : 'Recent response',
            employeeId: second ? '101' : '1',
            email: 'employee@soprasteria.com',
            answers: {},
          },
        ],
      },
    });
  });
  await page.goto('/announcements');
  await page.getByRole('tab', { name: 'Responses', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Recent response', exact: true })).toBeVisible();
  await page
    .getByRole('group', { name: 'Response pages' })
    .getByRole('button', { name: 'More responses' })
    .click();
  await expect(page.getByRole('cell', { name: 'Older response', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Recent response', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous responses' }).click();
  await expect(page.getByRole('cell', { name: 'Recent response', exact: true })).toBeVisible();
});

test('notification drawer reaches older announcement pages and keeps its first-page badge', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  await page.route('**/api/notifications*', r => {
    const second = new URL(r.request().url()).searchParams.get('announcementPage') === '2';
    return r.fulfill({
      json: {
        personId: ids.person,
        hasMoreAnnouncements: !second,
        items: [
          {
            id: 'announcement-' + (second ? oldId : freshId),
            at: '2026-11-01T00:00:00Z',
            title: second ? 'Older announcement' : 'Recent announcement',
            body: 'Training',
            href: '/announcements?announcement=' + (second ? oldId : freshId),
          },
        ],
      },
    });
  });
  await page.goto('/profile');
  const trigger = page.getByRole('button', { name: /^Notifications/ });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await drawer
    .getByRole('group', { name: 'Announcement notification pages' })
    .getByRole('button', { name: 'More announcements' })
    .click();
  await expect(drawer.getByText('Older announcement', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(trigger).toHaveAccessibleName('Notifications, 1 unread');
  await drawer.getByRole('button', { name: 'Close notifications' }).click();
  await trigger.click();
  await expect(drawer.getByText('Recent announcement', { exact: true })).toBeVisible();
});
