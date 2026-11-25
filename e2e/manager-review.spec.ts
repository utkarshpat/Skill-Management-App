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
async function review(
  page: Page,
  state: { fail?: boolean; competitorWon?: boolean; changedPending?: boolean },
  mode = 'capability-review',
) {
  await fixture(page, { role: 'manager' });
  await page.route('**/api/capability-submissions/' + submission, r =>
    r.fulfill({
      json: state.competitorWon
        ? {
            ...submitted,
            revision: 6,
            status: 'REVIEWED',
            skills: submitted.skills.map(row => ({
              ...row,
              status: 'APPROVED',
              needsReview: false,
            })),
            certifications: submitted.certifications.map(row => ({
              ...row,
              status: 'APPROVED',
              needsReview: false,
            })),
          }
        : state.changedPending
          ? {
              ...submitted,
              revision: submitted.revision + 1,
              skills: submitted.skills.map(row =>
                row.needsReview ? { ...row, revision: row.revision + 1 } : row,
              ),
            }
          : submitted,
    }),
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
test('manager review: change requests require notes and approvals can be saved without them', async ({
  page,
}) => {
  const writes = await review(page, {}),
    save = page.getByRole('button', { name: 'Save approval decisions (2)', exact: true });
  const sql = page
    .locator('article')
    .filter({ has: page.getByRole('radiogroup', { name: 'Decision for SQL' }) });
  await sql.getByRole('radio', { name: 'Request changes', exact: true }).click();
  await save.click();
  await expect(page.locator('.form-dialog-message').getByRole('alert')).toContainText(
    'Add feedback for each rejection or change request.',
  );
  expect(writes).toHaveLength(0);
  await sql
    .getByRole('textbox', { name: /Feedback notes/ })
    .fill('Add the execution-plan example and distinguish your contribution.');
  await expect(
    page.getByRole('radiogroup', { name: 'Decision for Power BI', exact: true }),
  ).toHaveCount(0);
  await save.click();
  await expect(page.getByText('Approval decision confirmed', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].revision).toBe(5);
  expect(writes[0].decisions.map((d: any) => [d.kind, d.action, d.revision])).toEqual([
    ['SKILL', 'REQUEST_CHANGES', 3],
    ['CERTIFICATION', 'APPROVE', 2],
  ]);
  expect(writes[0].decisions[1].feedback).toBe('');
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
  await page.getByRole('button', { name: 'Save approval decisions (2)', exact: true }).click();
  await expect(page.locator('.form-dialog-message').getByRole('alert')).toContainText(
    'submission version changed',
  );
  await expect(page.getByRole('textbox', { name: /Feedback notes/ }).nth(0)).toHaveValue(
    'Query work needs one more example.',
  );
  await expect(page.getByText('Approval decision confirmed', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Save approval decisions (2)', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh request', exact: true })).toBeEnabled();
  expect(writes).toHaveLength(1);
});
test('manager review: a concurrent winning decision is displayed after the stale save', async ({
  page,
}) => {
  const state = { fail: true, competitorWon: false };
  const writes = await review(page, state);
  const save = page.getByRole('button', { name: 'Save approval decisions (2)' });
  await expect(save).toBeEnabled();
  state.competitorWon = true;
  await save.click();
  await expect(page.getByText('Decision recorded', { exact: true })).toBeVisible();
  await expect(save).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /Feedback notes/ })).toHaveCount(0);
  expect(writes).toHaveLength(1);
});
test('manager review requires a fresh decision on a changed item while keeping untouched notes', async ({
  page,
}) => {
  const state = { fail: true, changedPending: false };
  const writes = await review(page, state);
  const sql = page.getByRole('radiogroup', { name: 'Decision for SQL' });
  await sql.getByRole('radio', { name: 'Approve', exact: true }).press('ArrowLeft');
  await expect(sql.getByRole('radio', { name: 'Reject', exact: true })).toBeFocused();
  const notes = page.getByRole('textbox', { name: /Feedback notes/ });
  await notes.nth(0).fill('More evidence needed.');
  await notes.nth(1).fill('Issuer details checked.');
  state.changedPending = true;
  const save = page.getByRole('button', { name: 'Save approval decisions (2)' });
  await save.click();
  await expect(sql.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(save).toBeDisabled();
  await expect(notes.nth(1)).toHaveValue('Issuer details checked.');
  state.fail = false;
  await sql.getByRole('radio', { name: 'Reject', exact: true }).check();
  await notes.nth(0).fill('Updated evidence still insufficient.');
  await save.click();
  await expect
    .poll(() => writes.map(write => [write.decisions[0].action, write.decisions[0].revision]))
    .toEqual([
      ['REJECT', 3],
      ['REJECT', 4],
    ]);
});

test('an exact legacy link opens the authorized certificate approval and a conflict refreshes the queue', async ({
  page,
}) => {
  await fixture(page, { role: 'manager', realistic: true });
  const record = { ...certificates(ids.person)[0], canReview: true, status: 'SUBMITTED' };
  let revision = record.revision;
  const writes: number[] = [];
  await page.route('**/api/certifications?**', route =>
    route.fulfill({
      json: {
        page: 1,
        pageSize: 25,
        total: 1,
        records: [{ ...record, revision }],
        canReview: true,
      },
    }),
  );
  await page.route('**/api/certifications', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    writes.push(route.request().postDataJSON().revision);
    if (writes.length > 1) return route.fulfill({ json: { saved: true } });
    revision++;
    return route.fulfill({
      status: 409,
      json: { error: { message: 'Certification revision changed.' } },
    });
  });
  await page.goto(`/certifications?tab=queue&certification=${record.id}`);
  const dialog = page.getByRole('dialog', { name: 'Open certification approval' });
  const approve = dialog.getByRole('button', { name: 'Approve', exact: true });
  await approve.click();
  await expect(approve).toBeDisabled();
  await dialog.getByRole('button', { name: 'Refresh approval queue' }).click();
  await page.getByRole('button', { name: 'Open certification approval', exact: true }).click();
  await approve.click();
  await expect.poll(() => writes).toEqual([record.revision, record.revision + 1]);
});
test('certification search can be cleared after zero results and notification links ignore the filter', async ({
  page,
}) => {
  await fixture(page, { role: 'manager', realistic: true });
  const record = { ...certificates(ids.person)[0], canReview: true, status: 'SUBMITTED' };
  await page.route('**/api/certifications?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const pageNumber = Number(params.get('page'));
    const filtered = Boolean(params.get('search'));
    return route.fulfill({
      json: {
        page: pageNumber,
        pageSize: 1,
        total: filtered ? 0 : 2,
        records: filtered ? [] : [pageNumber === 1 ? { ...record, id: ids.person } : record],
        canReview: true,
      },
    });
  });
  await page.route('**/api/notifications', route =>
    route.fulfill({
      json: {
        personId: ids.person,
        items: [
          {
            id: 'approval-needed',
            at: new Date().toISOString(),
            title: 'Certification approval requested',
            body: 'A certification is ready for approval.',
            href: '/skill-reviews?certification=' + record.id,
            actionLabel: 'Open certification approval',
          },
        ],
      },
    }),
  );
  await page.goto('/skill-reviews');
  const search = page.getByRole('searchbox', { name: 'Search employee or certification' });
  await search.fill('no-match');
  await expect(page.getByText('No matching certifications')).toBeVisible();
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await page.getByRole('link', { name: 'Open certification approval' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open certification approval' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /close/i }).click();
  await expect(search).toHaveValue('no-match');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Open certification approval', exact: true }),
  ).toBeVisible();
});

test('certification recommendation: search and select inside each picker', async ({ page }) => {
  await fixture(page, { role: 'manager' });
  await page.route('**/api/certification-recommendations/analytics', route =>
    route.fulfill({ json: { canRecommend: true, categories: [] } }),
  );
  await page.route('**/api/certification-recommendations?**', route =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20, canSend: true } }),
  );
  await page.route('**/api/certification-recommendations/people?**', route =>
    route.fulfill({
      json: { people: [{ id: ids.person, name: 'Aditi Menon', employeeCode: 'EMP-1042' }] },
    }),
  );
  await page.route('**/api/capability-submissions/catalogue?**', route =>
    route.fulfill({
      json: {
        total: 1,
        pageSize: 10,
        credentials: [
          {
            id: 'oracle-sql',
            name: 'Oracle Database SQL',
            provider: 'Oracle',
            category: 'Databases',
          },
        ],
      },
    }),
  );
  await page.goto('/skill-reviews?tab=recommendations');
  await page.getByRole('button', { name: 'Recommend a certification' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Recommend a certification' });
  const report = dialog.getByRole('combobox', { name: 'Direct report' });
  const catalogue = dialog.getByRole('combobox', { name: 'Certification catalogue' });
  const [reportBox, catalogueBox] = await Promise.all([
    report.boundingBox(),
    catalogue.boundingBox(),
  ]);
  expect(reportBox).not.toBeNull();
  expect(catalogueBox).not.toBeNull();
  if (page.viewportSize()!.width > 600) {
    expect(catalogueBox!.x).toBeGreaterThan(reportBox!.x);
    expect(catalogueBox!.y).toBe(reportBox!.y);
  } else {
    expect(catalogueBox!.x).toBe(reportBox!.x);
    expect(catalogueBox!.y).toBeGreaterThan(reportBox!.y + reportBox!.height);
  }
  await expect(dialog.getByRole('textbox', { name: /Certification name/ })).toBeHidden();
  await expect(dialog.getByRole('textbox', { name: 'Credential information link' })).toBeHidden();
  await report.fill('1042');
  await expect(dialog.getByRole('option', { name: /Aditi Menon.*EMP-1042/ })).toBeVisible();
  await report.press('ArrowDown');
  await report.press('Enter');
  await expect(report).toHaveValue('Aditi Menon');
  await catalogue.fill('Oracle');
  await dialog.getByRole('option', { name: /Oracle Database SQL.*Databases/ }).click();
  await expect(catalogue).toHaveValue('Oracle Database SQL');
  await dialog.getByText('Edit certification details', { exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: /Certification name/ })).toHaveValue(
    'Oracle Database SQL',
  );
  await expect(dialog.getByRole('textbox', { name: 'Issuer' })).toHaveValue('Oracle');
  await catalogue.click();
  await catalogue.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listbox')).toHaveCount(0);
});

test('employee history: view-only snapshots show saved proficiency and can reroute only the approved record set', async ({
  page,
}) => {
  const writes = await review(page, {}, 'capability-history');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save approval decisions/ })).toHaveCount(0);
  await expect(page.getByText(/Experienced/).first()).toBeVisible();
  await page.route('**/api/capability-submissions/reroute', r => {
    writes.push(r.request().postDataJSON());
    return r.fulfill({ json: { saved: true } });
  });
  await page.getByRole('button', { name: 'Send to current manager', exact: true }).click();
  await expect(page.getByText('Approval decision confirmed', { exact: true })).toBeVisible();
  expect(writes[0].revision).toBe(5);
  expect(writes[0].skills).toHaveLength(3);
  expect(writes[0]).not.toHaveProperty('managerId');
});
