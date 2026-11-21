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
async function mockIntake(page: Page) {
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
}
async function intake(page: Page) {
  await mockIntake(page);
  await page.goto('/test/e2e/harness.html?fixture=composer');
  return page.getByRole('dialog', { name: 'SQL', exact: true });
}
test('intake: proficiency and date validation keep drafts editable; discard requires explicit confirmation', async ({
  page,
}) => {
  const skill = await intake(page);
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(skill).toContainText('Choose your proficiency.');
  await skill.getByRole('radio', { name: 'Experienced', exact: true }).check();
  await skill.getByLabel('Last used', { exact: true }).fill('2027-01-01');
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(skill).toContainText(/today|future/i);
  await skill.getByLabel('Last used', { exact: true }).fill('2026-11-01');
  await skill.getByLabel('Experience in months', { exact: false }).fill('601');
  await skill.getByRole('button', { name: 'Close SQL', exact: true }).click();
  await expect(page.locator('.cap-skill-card')).toContainText('Needs details');
  await page
    .locator('.form-dialog-footer')
    .getByRole('button', { name: 'Preview', exact: true })
    .click();
  await expect(skill.getByRole('alert')).toContainText(
    'Enter experience between 0 and 600 months.',
  );
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
  await skill.getByRole('radio', { name: 'Autonomous', exact: true }).check();
  await skill.getByLabel('Experience in months', { exact: false }).fill('12');
  expect(catalogueReads).toEqual(['25']);
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => catalogueReads).toEqual(['25', '12']);
  await page
    .locator('.form-dialog-footer')
    .getByRole('button', { name: 'Preview', exact: true })
    .click();
  await expect(page.getByText('Preview your linked capabilities', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(page.getByText('Capability saved', { exact: true })).toBeVisible();
  expect(calls.map(c => c.path)).toEqual(['save', 'submit']);
  expect(calls[0].revision).toBe(0);
  expect(calls[1].revision).toBe(1);
  expect(calls[0]).not.toHaveProperty('actorId');
  expect(calls[0]).not.toHaveProperty('reviewerId');
});

test('portfolio add actions open the right step and preserve the linked draft when switching', async ({
  page,
}) => {
  await mockIntake(page);
  await page.route('**/api/capability-submissions?view=mine', r =>
    r.fulfill({ json: { records: [] } }),
  );
  await page.goto('/my-skills');
  await page.getByRole('button', { name: 'Add certificate', exact: true }).click();
  const certificateEntry = page.getByRole('dialog', { name: 'Add certificate', exact: true });
  await expect(
    certificateEntry.getByRole('button', { name: 'Certificates', exact: true }),
  ).toHaveAttribute('aria-current', 'step');
  await certificateEntry.getByRole('button', { name: 'Close Add certificate' }).click();

  await page.getByRole('button', { name: 'Add skill', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Add skill', exact: true });
  await expect(composer.getByRole('button', { name: 'Skills', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await composer
    .locator('.cap-skill-results')
    .getByRole('button', { name: 'SQL Databases' })
    .click();
  const skill = page.getByRole('dialog', { name: 'SQL', exact: true });
  await skill.getByRole('radio', { name: 'Autonomous', exact: true }).check();
  await skill.getByLabel('Experience in months').fill('12');
  await skill.getByRole('button', { name: 'Done', exact: true }).click();

  await composer.getByRole('button', { name: 'Add certificate', exact: true }).click();
  await expect(composer.getByRole('button', { name: 'Certificates', exact: true })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await composer.locator('input[type="file"]').setInputFiles({
    name: 'sql-certificate.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic proof of SQL certification'),
  });
  await composer.getByLabel('Certification name').fill('Synthetic SQL credential');
  await composer.getByLabel(/^Issuer/).fill('Example issuer');
  await composer.getByLabel('Category').fill('Databases');
  await composer.getByLabel('Issue date').fill('2026-01-01');
  await composer.getByLabel('Lifetime valid').check();
  await composer.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(composer.locator('.cap-skill-card')).toContainText('Autonomous · 12 mos');
  await composer.getByRole('button', { name: 'Edit SQL' }).click();
  await skill.getByRole('checkbox', { name: 'Synthetic SQL credential', exact: false }).check();
  await skill.getByRole('button', { name: 'Done', exact: true }).click();
  await composer
    .locator('.form-dialog-footer')
    .getByRole('button', { name: 'Preview', exact: true })
    .click();
  await expect(composer.getByRole('list', { name: 'Certificates linked to SQL' })).toContainText(
    'Synthetic SQL credential',
  );
  await composer.getByRole('button', { name: 'Edit certificates', exact: true }).click();
  await expect(composer.getByLabel('Certification name')).toHaveValue('Synthetic SQL credential');
});
