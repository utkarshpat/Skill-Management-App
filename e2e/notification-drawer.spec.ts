import { test, expect, fixture, ids } from './browser-fixture';

test('notification drawer supports search, read controls, keyboard dismissal and navigation', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  await page.route('**/api/notifications', route =>
    route.fulfill({
      json: {
        personId: ids.person,
        items: [
          {
            id: 'review',
            at: '2026-11-09T10:00:00Z',
            title: 'SQL review approved',
            body: 'Rohan Mehta reviewed your SQL evidence.',
            href: '/my-skills?claim=sql',
            actorName: 'Rohan Mehta',
          },
          {
            id: 'request',
            at: '2026-11-08T10:00:00Z',
            title: 'Request updated',
            body: 'Your reporting assignment request has a new comment.',
            href: '/requests?record=reporting',
          },
        ],
      },
    }),
  );
  await page.goto('/profile');
  const trigger = page.getByRole('button', { name: /^Notifications/ });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(drawer).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer.getByText('SQL review approved', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      return box ? Math.abs(box.x + box.width - page.viewportSize()!.width) : 999;
    })
    .toBeLessThan(2);
  await page.screenshot({
    path: `artifacts/e2e/notification-drawer-${test.info().project.name}.png`,
  });
  const box = (await drawer.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBe(page.viewportSize()!.height);
  expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await drawer.getByRole('searchbox', { name: 'Search notifications' }).fill('rohan');
  await expect(drawer.locator('.notification-list li')).toHaveCount(1);
  await drawer.getByRole('button', { name: 'Mark read', exact: true }).click();
  await drawer.getByRole('button', { name: /^Unread/ }).click();
  await expect(drawer.getByText('No matching notifications')).toBeVisible();
  await drawer.getByRole('button', { name: 'View all updates' }).click();
  await expect(drawer.locator('.notification-list li')).toHaveCount(2);
  await drawer.getByRole('button', { name: 'Read all', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Read all', exact: true })).toBeDisabled();
  await drawer.getByRole('button', { name: 'Close notifications' }).click();
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await drawer.getByRole('link', { name: 'View skill claim' }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/my-skills\?claim=sql/);
});
