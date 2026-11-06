import { test, expect, fixture, ids } from './browser-fixture';
import { commonLevels } from '../apps/web/src/proficiency';
import type { Page } from '@playwright/test';
const choice = {
  id: '11111111-1111-4111-8111-000000000001',
  name: 'SQL',
  category: 'Databases',
  definitionRevision: 2,
  levels: commonLevels(),
};
async function intake(page: Page) {
  await fixture(page, { role: 'employee', realistic: true });
  await page.route('**/api/capability-submissions/availability', r =>
    r.fulfill({ json: { aiAvailable: false, fileAvailable: true } }),
  );
  await page.route('**/api/capability-submissions/options', r =>
    r.fulfill({ json: { claims: [], certifications: [], definitions: [] } }),
  );
  await page.route('**/api/my-skills/catalogue?**', r =>
    r.fulfill({
      json: {
        skills: [choice],
        total: 1,
        page: 1,
        pageSize: 25,
        categories: [{ name: 'Databases', count: 1 }],
      },
    }),
  );
  await page.goto('/test/e2e/harness.html?fixture=composer');
  return page.getByRole('dialog', { name: 'SQL', exact: true });
}
test('intake: proficiency and date validation keep drafts editable; discard requires explicit confirmation', async ({
  page,
}) => {
  const skill = await intake(page);
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(skill).toContainText('Choose your proficiency.');
  await skill.getByRole('radio', { name: 'L3 Experienced', exact: true }).check();
  await skill.getByLabel('Last used', { exact: true }).fill('2027-01-01');
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(skill).toContainText(/today|future/i);
  await skill.getByLabel('Last used', { exact: true }).fill('2026-11-01');
  await skill.getByLabel('Experience in months', { exact: false }).fill('18');
  await skill
    .getByLabel('Describe your experience', { exact: true })
    .fill(
      'Optimised monthly customer reporting queries using execution plans and window functions.',
    );
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /keep editing/i }).click();
  await expect(confirm).not.toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByText('Form closed without saving', { exact: true })).toBeVisible();
});
test('intake: one skill submission carries exact revisions and follows save before submit', async ({
  page,
}) => {
  const catalogueReads: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/my-skills/catalogue')
      catalogueReads.push(url.searchParams.get('pageSize') ?? '');
  });
  const skill = await intake(page),
    calls: Record<string, unknown>[] = [];
  await page.route('**/api/capability-submissions', r => {
    const body = r.request().postDataJSON();
    calls.push({ path: 'save', ...body });
    return r.fulfill({
      json: {
        id: body.id,
        revision: 1,
        status: 'DRAFT',
        skills: body.skills.map((s: any) => ({
          ...s,
          revision: 1,
          name: choice.name,
          skillId: choice.id,
          levels: choice.levels,
        })),
        certifications: [],
        stagedFiles: [],
      },
    });
  });
  await page.route('**/api/capability-submissions/submit', r => {
    const body = r.request().postDataJSON();
    calls.push({ path: 'submit', ...body });
    return r.fulfill({
      json: { id: body.id, revision: 2, status: 'SUBMITTED', skills: [], certifications: [] },
    });
  });
  await skill.getByRole('radio', { name: 'L2 Autonomous', exact: true }).check();
  await skill.getByLabel('Experience in months', { exact: false }).fill('12');
  expect(catalogueReads).toEqual(['25']);
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => catalogueReads).toEqual(['25', '12']);
  await page
    .locator('.form-dialog-footer')
    .getByRole('button', { name: 'Review', exact: true })
    .click();
  await expect(page.getByText('Review your linked capabilities', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /submit.*review/i }).click();
  await expect(page.getByText('Capability saved', { exact: true })).toBeVisible();
  expect(calls.map(c => c.path)).toEqual(['save', 'submit']);
  expect(calls[0].revision).toBe(0);
  expect(calls[1].revision).toBe(1);
  expect(calls[0]).not.toHaveProperty('actorId');
  expect(calls[0]).not.toHaveProperty('reviewerId');
});
