import { test, expect, fixture, ids } from './browser-fixture';
import { claims, certificates } from './workforce-data';
import { commonLevels } from '../apps/web/src/proficiency';
import type { Page } from '@playwright/test';
const submission = '88888888-8888-4888-8888-000000000001';
const submitted = {
  id: submission,
  revision: 5,
  status: 'SUBMITTED',
  canReroute: true,
  skills: claims.map((s, i) => ({
    ...s,
    name: s.skillName,
    needsReview: i === 0,
    levels: commonLevels(),
    lastUsedTiming: 'ON_OR_BEFORE_TODAY',
  })),
  certifications: certificates(ids.person).map((c, i) => ({
    ...c,
    needsReview: i === 0,
    skillIds: [claims[0].skillId],
  })),
};
async function review(page: Page, state: { fail?: boolean }, mode = 'capability-review') {
  await fixture(page, { role: 'manager' });
  await page.route('**/api/capability-submissions/' + submission, r =>
    r.fulfill({ json: submitted }),
  );
  await page.route('**/api/capability-submissions/' + submission + '/files/**', r =>
    r.fulfill({ json: { items: [] } }),
  );
  const writes: Record<string, any>[] = [];
  await page.route('**/api/capability-submissions/decision', r => {
    writes.push(r.request().postDataJSON());
    return state.fail
      ? r.fulfill({
          status: 409,
          json: {
            error: { message: 'The saved submission version changed. Reload before deciding.' },
          },
        })
      : r.fulfill({ json: { saved: true } });
  });
  await page.goto('/test/e2e/harness.html?fixture=' + mode);
  return writes;
}
test('manager review: notes required per pending item; mixed decisions preserve exact item revisions', async ({
  page,
}) => {
  const writes = await review(page, {}),
    save = page.getByRole('button', { name: 'Save review decisions (2)', exact: true });
  await save.click();
  await expect(page.locator('.form-dialog-message').getByRole('alert')).toContainText(
    'feedback notes for every pending item',
  );
  expect(writes).toHaveLength(0);
  const sql = page
    .locator('article')
    .filter({ has: page.getByRole('radiogroup', { name: 'Decision for SQL' }) });
  await sql.getByRole('radio', { name: 'Request changes', exact: true }).click();
  await sql
    .getByRole('textbox', { name: /Feedback notes/ })
    .fill('Add the execution-plan example and distinguish your contribution.');
  const credential = page.locator('article').filter({
    has: page.getByRole('radiogroup', {
      name: 'Decision for Oracle Database SQL Certified Associate',
    }),
  });
  await credential.getByRole('radio', { name: 'Reject', exact: true }).click();
  await credential
    .getByRole('textbox', { name: /Feedback notes/ })
    .fill('Issuer details do not match the submitted credential.');
  await expect(
    page.getByRole('radiogroup', { name: 'Decision for Power BI', exact: true }),
  ).toHaveCount(0);
  await save.click();
  await expect(page.getByText('Review decision confirmed', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].revision).toBe(5);
  expect(writes[0].decisions.map((d: any) => [d.kind, d.action, d.revision])).toEqual([
    ['SKILL', 'REQUEST_CHANGES', 3],
    ['CERTIFICATION', 'REJECT', 2],
  ]);
});
test('manager review: stale write shows conflict and retains notes without false success', async ({
  page,
}) => {
  const state = { fail: true },
    writes = await review(page, state);
  await page
    .getByRole('textbox', { name: /Feedback notes/ })
    .nth(0)
    .fill('Query work needs one more example.');
  await page
    .getByRole('textbox', { name: /Feedback notes/ })
    .nth(1)
    .fill('Credential details reviewed.');
  await page.getByRole('button', { name: 'Save review decisions (2)', exact: true }).click();
  await expect(page.locator('.form-dialog-message').getByRole('alert')).toContainText(
    'submission version changed',
  );
  await expect(page.getByRole('textbox', { name: /Feedback notes/ }).nth(0)).toHaveValue(
    'Query work needs one more example.',
  );
  await expect(page.getByText('Review decision confirmed', { exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(1);
});
test('employee history: view-only snapshots show saved proficiency and can reroute only the reviewed record set', async ({
  page,
}) => {
  const writes = await review(page, {}, 'capability-history');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save review decisions/ })).toHaveCount(0);
  await expect(page.getByText(/Experienced/).first()).toBeVisible();
  await page.route('**/api/capability-submissions/reroute', r => {
    writes.push(r.request().postDataJSON());
    return r.fulfill({ json: { saved: true } });
  });
  await page.getByRole('button', { name: 'Send to current manager', exact: true }).click();
  await expect(page.getByText('Review decision confirmed', { exact: true })).toBeVisible();
  expect(writes[0].revision).toBe(5);
  expect(writes[0].skills).toHaveLength(3);
  expect(writes[0]).not.toHaveProperty('managerId');
});
