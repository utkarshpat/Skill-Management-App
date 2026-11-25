import { test, expect, fixture, ids } from './browser-fixture';
import { fileURLToPath } from 'node:url';
const id = '33333333-3333-4333-8333-333333333333';
const person = { name: 'Test Employee', email: 'employee@soprasteria.com', employeeId: '710904' };

test('a stale announcement response keeps typed answers and retries against the refreshed revision', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  const writes: { revision: number; responseRevision: number; answers: Record<string, string> }[] =
    [];
  await page.route('**/api/announcements/feed*', route =>
    route.fulfill({
      json: {
        person,
        canPublish: false,
        items: [
          {
            id,
            revision: writes.length ? 2 : 1,
            startsAt: '2000-01-01T00:00:00Z',
            endsAt: '2099-01-01T00:00:00Z',
            answered: false,
            definition: {
              kind: 'FORM',
              title: 'Training registration',
              message: 'Share your training plans',
              cta: 'Register',
              fields: [{ id: 'details', label: 'Training details', type: 'text', required: true }],
            },
          },
        ],
      },
    }),
  );
  await page.route(`**/api/announcements/${id}/respond`, route => {
    writes.push(route.request().postDataJSON());
    return writes.length === 1
      ? route.fulfill({ status: 409, json: { error: { message: 'The announcement changed.' } } })
      : route.fulfill({ json: { responseRevision: 1 } });
  });
  await page.goto(`/announcements?announcement=${id}`);
  const dialog = page.getByRole('dialog', { name: 'Training registration' });
  const answer = dialog.getByLabel('Training details');
  await answer.fill('The Friday session works for me.');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(dialog.locator('p[role="alert"]')).toHaveText('The announcement changed.');
  await expect(answer).toHaveValue('The Friday session works for me.');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  await expect.poll(() => writes.map(write => write.revision)).toEqual([1, 2]);
  expect(writes[1].answers).toEqual({ details: 'The Friday session works for me.' });
});

for (const kind of ['FORM', 'POLL']) {
  test(
    'dismissed ' + kind + ' reopens from notifications without marquee and records one response',
    async ({ page }) => {
      await fixture(page, { role: 'employee' });
      let answered = false;
      let submissions = 0;
      const poster = kind === 'POLL';
      const title = kind === 'FORM' ? 'Training registration' : 'Team training poll';
      await page.route('**/api/announcements/feed*', route =>
        route.fulfill({
          json: {
            person,
            canPublish: false,
            items: [
              {
                id,
                revision: 1,
                startsAt: '2000-01-01T00:00:00Z',
                endsAt: '2099-01-01T00:00:00Z',
                answered,
                ...(poster &&
                  answered && { savedAnswers: { vote: 'Afternoon' }, responseRevision: 1 }),
                hasImage: poster,
                definition: {
                  kind,
                  title,
                  message: 'Choose your batch',
                  cta: 'Register',
                  popup: true,
                  imagePopup: poster,
                  imageAlt: 'Training poster',
                  marquee: false,
                  ...(poster && {
                    allowResponseUpdates: true,
                    design: {
                      format: 'appearance-v1',
                      order: ['title', 'message', 'image', 'action'],
                      appearance: { button: 'green' },
                    },
                  }),
                  options: ['Morning', 'Afternoon'],
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
          },
        }),
      );
      if (poster)
        await page.route('**/api/announcements/*/image', route =>
          route.fulfill({
            contentType: 'image/webp',
            path: fileURLToPath(
              new URL('../apps/web/public/brand/assistant-robot-red.webp', import.meta.url),
            ),
          }),
        );
      await page.route('**/api/notifications', route =>
        route.fulfill({
          json: {
            personId: ids.person,
            items: [
              {
                id: 'announcement-' + id,
                at: '2026-11-18T00:00:00Z',
                title,
                body: 'Choose your batch',
                href: '/announcements?announcement=' + id,
              },
            ],
          },
        }),
      );
      await page.route('**/api/announcements/*/respond', route => {
        submissions++;
        expect(route.request().postDataJSON()).toEqual({
          revision: 1,
          responseRevision: 0,
          answers: kind === 'FORM' ? { batch: 'Afternoon' } : { vote: 'Afternoon' },
        });
        answered = true;
        return route.fulfill({ json: { saved: true } });
      });
      await page.goto('/profile');
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('link', { name: 'Announcements', exact: true })).toHaveCount(0);
      if (poster) {
        await expect(dialog.getByRole('img', { name: 'Training poster' })).toBeVisible();
        await expect(dialog.locator('.announcement-poster button')).toHaveCount(1);
        await expect(page.locator('.announcement-strip img')).toHaveCount(0);
      }
      await dialog.getByRole('button', { name: 'Close ' + title }).click();
      await expect(dialog).toBeHidden();
      const reopen = async () => {
        await page.getByRole('button', { name: /^Notifications/ }).click();
        const drawer = page.getByRole('dialog', { name: 'Notifications', exact: true });
        await drawer.getByRole('link', { name: 'Open announcement', exact: true }).click();
        await expect(drawer).toBeHidden();
        await expect(dialog).toBeVisible();
      };
      await reopen();
      if (kind === 'FORM') {
        await expect(dialog.locator('.announcement-identity dd').nth(1)).toHaveText(person.email);
        await dialog.getByLabel('Preferred batch').selectOption('Afternoon');
        await dialog.getByRole('button', { name: 'Register', exact: true }).click();
        await expect(page.getByText('Response submitted.', { exact: true })).toBeVisible();
      } else {
        await dialog.getByRole('button', { name: 'Open poll', exact: true }).click();
        await expect(dialog.getByRole('img', { name: 'Training poster' })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Afternoon', exact: true }).click();
        await expect(page.getByText('Vote recorded.', { exact: true })).toBeVisible();
      }
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/announcements$/);
      await reopen();
      await expect(dialog.getByText('Response recorded', { exact: true })).toBeVisible();
      await expect(
        dialog.getByRole('button', {
          name: kind === 'FORM' ? 'Register' : 'Afternoon',
          exact: true,
        }),
      ).toHaveCount(0);
      if (poster) {
        await dialog.getByRole('button', { name: 'Edit response' }).click();
        const selected = dialog.getByRole('button', { name: 'Afternoon', exact: true });
        const other = dialog.getByRole('button', { name: 'Morning', exact: true });
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await expect(other).toHaveCSS('background-color', 'rgb(22, 101, 52)');
        await expect(selected).not.toHaveCSS('background-color', 'rgb(22, 101, 52)');
      }
      expect(submissions).toBe(1);
    },
  );
}

test('stale or out-of-scope announcement notification cannot open a form', async ({ page }) => {
  await fixture(page, { role: 'employee' });
  await page.route('**/api/announcements/feed*', route =>
    route.fulfill({ json: { person, canPublish: false, items: [] } }),
  );
  await page.goto('/announcements?announcement=' + id);
  await expect(
    page.getByText('This announcement has ended or is no longer available in your scope.'),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
