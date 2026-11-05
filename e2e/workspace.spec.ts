import { test, expect, fixture, ids, type State } from './browser-fixture';
import { people, plan, request as workforceRequest } from './workforce-data';

for (const role of ['employee', 'manager', 'admin'] as const) {
  test(`${role}: own profile, navigation and keyboard account menu`, async ({ page }) => {
    await fixture(page, { role });
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { name: people[role].displayName, exact: true }),
    ).toBeVisible();
    const menu = page.getByRole('button', { name: 'Account menu for ' + people[role].displayName });
    await expect(page.getByRole('region', { name: 'Account menu', exact: true })).toBeHidden();
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: 'Account menu', exact: true })).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  });
}
test('workspace error stops spinner; retry recovers and sign out ends session', async ({
  page,
}) => {
  const state: State = { role: 'employee', failure: 500 };
  await fixture(page, state);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
  await expect(page.locator('.session-loading')).toHaveCount(0);
  state.failure = undefined;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: people.employee.displayName, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Account menu for ' + people.employee.displayName })
    .click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeVisible();
});
test('unprovisioned identity card: verified IDs, no overflow, retry after activation', async ({
  page,
}) => {
  const state: State = { role: 'employee', failure: 403, pending: true };
  await fixture(page, state);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Your access is not set up yet' })).toBeVisible();
  await expect(page.getByText(ids.person, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  state.failure = undefined;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: people.employee.displayName, exact: true }),
  ).toBeVisible();
});
test('generic errors never display identity-binding instructions', async ({ page }) => {
  await fixture(page, { role: 'employee', failure: 500 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
  await expect(page.getByText(/identity is verified/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
});
test('failed sign out on recovery card shows feedback and permits retry', async ({ page }) => {
  await fixture(page, { role: 'employee', failure: 500 });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__syntheticSignoutFailure = true;
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Sign out could not finish. Please try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__syntheticSignoutFailure = false;
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeVisible();
});
test('unknown route offers working return without pretending to be dashboard', async ({ page }) => {
  await fixture(page, { role: 'employee' });
  await page.goto('/unknown-synthetic');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to your workspace' })).toHaveAttribute(
    'href',
    '/workspace',
  );
});
test('picker: external value, deselection, selection, search and retry controls', async ({
  page,
}) => {
  await fixture(page, { role: 'employee' });
  await page.goto('/test/e2e/harness.html?fixture=picker');
  await page.getByRole('button', { name: 'Load existing value' }).click();
  await expect(
    page.getByRole('radio', { name: 'Associate certifications', exact: true }),
  ).toBeChecked();
  await expect(page.getByRole('button', { name: 'Remove Existing certificate' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Existing certificate' }).click();
  await expect(page.getByText('0/20 selected')).toBeVisible();
  await page.getByRole('checkbox').check();
  await expect(page.getByText('1/20 selected')).toBeVisible();
  await page.getByRole('radio', { name: 'No associated certifications' }).check();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
});
test('amendments: approver starts at type selection and can edit Provider', async ({ page }) => {
  await fixture(page, { role: 'admin' });
  await page.goto('/test/e2e/harness.html?fixture=business');
  await page.getByRole('button', { name: 'New catalogue request' }).click();
  await expect(page.getByRole('heading', { name: 'What would you like to change?' })).toBeVisible();
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  await page.getByRole('button', { name: /Update an existing entry/ }).click();
  await page.getByRole('combobox').selectOption('issuer');
  await page.getByRole('button', { name: /Next: entry details/ }).click();
  await expect(page.getByText('Update provider: Synthetic issuer')).toBeVisible();
});
test('review search and category do not collapse the history disclosure', async ({ page }) => {
  await fixture(page, { role: 'manager' });
  await page.goto('/test/e2e/harness.html?fixture=reviews');
  await expect(page.locator('summary').filter({ hasText: 'Legacy reviews' })).toBeVisible();
  await expect(page.locator('details.review-legacy-history')).toHaveAttribute('open', '');
  await page.getByRole('searchbox', { name: 'Search review employee or skill' }).fill('Synthetic');
  await expect(page.locator('details.review-legacy-history')).toHaveAttribute('open', '');
  await page.getByLabel('Review category').selectOption('Synthetic');
  await expect(page.locator('details.review-legacy-history')).toHaveAttribute('open', '');
});

test('workforce: employee filters delivered skills and reads review feedback', async ({ page }) => {
  await fixture(page, { role: 'employee', realistic: true });
  await page.goto('/my-skills');
  await expect(page.getByRole('button', { name: 'View SQL claim' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search your skills' }).fill('Python');
  await expect(page.getByRole('button', { name: 'View SQL claim' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Python draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear skill filters' }).click();
  await page.getByRole('button', { name: 'View SQL claim' }).click();
  await expect(
    page.getByText('Rohan confirmed the query optimisation and data-quality work.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('workforce: learning plan pause and resume persist through refreshed reads', async ({
  page,
}) => {
  const state: State = { role: 'employee', realistic: true, mutations: [] };
  await fixture(page, state);
  await page.goto('/learning');
  await expect(page.getByRole('heading', { name: plan.title, exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  expect(state.mutations?.map(x => x.action)).toEqual(['PAUSE', 'RESUME']);
  expect(state.mutations?.map(x => [x.id, x.revision])).toEqual([
    [plan.id, 2],
    [plan.id, 3],
  ]);
  await page.getByRole('button', { name: 'Continue learning', exact: true }).click();
  await expect(page.getByPlaceholder('What did you learn? What needs more practice?')).toHaveValue(
    'Compare joins using representative transaction data.',
  );
  await page
    .getByPlaceholder('What did you learn? What needs more practice?')
    .fill('Used partitioned window functions to compare monthly customer totals.');
  await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(page.getByText('Session saved. Completion is logged separately.')).toBeVisible();
  expect(state.mutations?.at(-1)).toMatchObject({
    planId: plan.id,
    taskId: plan.tasks[1].id,
    revision: 1,
    minutes: 40,
    notes: 'Used partitioned window functions to compare monthly customer totals.',
  });
  await page.getByRole('button', { name: 'Resources', exact: true }).click();
  await expect(page.getByRole('link', { name: 'SQL window functions reference' })).toHaveAttribute(
    'href',
    /learn.microsoft.com/,
  );
});

test('workforce: employee opens workshop request with the correct reporting manager', async ({
  page,
}) => {
  const state: State = { role: 'employee', realistic: true, mutations: [] };
  await fixture(page, state);
  await page.goto('/requests');
  await page.getByRole('button', { name: 'Open REQ-2026-0142' }).click();
  await expect(
    page.getByRole('heading', { name: workforceRequest.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('definition').filter({ hasText: people.manager.displayName }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start work', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  await page
    .getByLabel('Your comment', { exact: true })
    .fill('The workshop exercises match our customer reporting queries.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(
    page.getByText('The workshop exercises match our customer reporting queries.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled();
  await page
    .getByLabel('Cancellation reason', { exact: true })
    .fill('The delivery team has arranged an internal SQL workshop.');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('button', { name: 'Cancel request', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('The delivery team has arranged an internal SQL workshop.', { exact: true }),
  ).toBeVisible();
  expect(state.mutations?.map(x => [x.action, x.revision])).toEqual([
    ['COMMENT', 1],
    ['CANCEL', 2],
  ]);
});

test('workforce: expired reviewed credential remains visible with renewal context', async ({
  page,
}) => {
  await fixture(page, { role: 'employee', realistic: true });
  await page.goto('/my-skills');
  await page.getByText('1 need attention', { exact: true }).click();
  await page.getByRole('button', { name: /Microsoft Power BI Data Analyst.*Expired/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Credential ID: MS-PL300-1042', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Expired.*2026-07-10$/)).toBeVisible();
  await expect(
    dialog.getByText('Manager feedback: Credential details reviewed by Rohan Mehta.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});
