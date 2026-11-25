import { test, expect, fixture, ids, type State } from './browser-fixture';
import { certificates, people, plan, request as workforceRequest } from './workforce-data';

for (const role of ['employee', 'manager', 'admin'] as const) {
  test(`${role}: own profile, navigation and keyboard account menu`, async ({ page }) => {
    await fixture(page, { role });
    let accessReads = 0;
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/effective-access') accessReads++;
    });
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { name: people[role].displayName, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Effective access/i)).toHaveCount(0);
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
    expect(accessReads).toBe(0);
  });
}
test('sidebar uses slim theme scrollbars in light and dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 450 });
  await fixture(page, { role: 'admin' });
  await page.goto('/profile');
  const sidebar = page.locator('.sidebar-scroll');
  await expect(sidebar).toBeVisible();
  const readScrollbar = () =>
    sidebar.evaluate(element => {
      const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
      return {
        width: getComputedStyle(element, '::-webkit-scrollbar').width,
        thumb: thumb.backgroundImage,
        nativeColor: getComputedStyle(element).scrollbarColor,
        thumbInset: thumb.borderLeftWidth,
        thumbClip: thumb.backgroundClip,
      };
    });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  const dark = await readScrollbar();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  const light = await readScrollbar();
  expect(light.width).toBe('6px');
  expect(dark.width).toBe('6px');
  expect(light.thumb).toContain('linear-gradient');
  expect(dark.thumb).toContain('linear-gradient');
  expect(dark.thumb).not.toBe(light.thumb);
  expect(light.nativeColor).toBe('auto');
  expect(dark.nativeColor).toBe('auto');
  expect(light.thumbInset).toBe('2px');
  expect(dark.thumbInset).toBe('2px');
  expect(light.thumbClip).toBe('content-box');
  expect(dark.thumbClip).toBe('content-box');
});

test('collapsed desktop navigation keeps named icons and restores the full mobile drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await fixture(page, { role: 'admin' });
  await page.goto('/access?view=overview');
  const sidebar = page.locator('.desktop-sidebar');
  const dashboard = sidebar.getByRole('button', { name: 'Dashboard', exact: true });
  const expand = sidebar.getByRole('button', { name: 'Expand sidebar' });
  const collapse = sidebar.getByRole('button', { name: 'Collapse sidebar' });
  await expect(dashboard).toHaveAttribute('aria-current', 'page');
  const expandedWidth = (await sidebar.boundingBox())!.width;
  const expandedToggle = (await collapse.boundingBox())!;
  await collapse.press('Enter');
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  expect((await sidebar.boundingBox())!.width).toBeLessThan(expandedWidth / 2);
  const collapsedToggle = (await expand.boundingBox())!;
  expect(collapsedToggle.y).toBe(expandedToggle.y);
  expect(collapsedToggle.x).toBeLessThan(expandedToggle.x);
  await expect(sidebar.getByRole('link', { name: 'Sopra Steria' }).locator('img')).toHaveAttribute(
    'src',
    '/brand/sopra-steria-mark.svg',
  );
  await expect(dashboard).toHaveAttribute('title', 'Dashboard');
  await expect(dashboard.locator('span')).toBeHidden();
  await expect(sidebar.getByRole('link', { name: 'My profile' }).locator('span')).toBeHidden();
  await expect(sidebar.getByRole('button', { name: 'Reorder Dashboard' })).toHaveCount(0);
  await page.reload();
  await expect(expand).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(drawer.getByText('Dashboard', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Sopra Steria' }).locator('img')).toHaveAttribute(
    'src',
    '/brand/sopra-steria.svg',
  );
  await page.setViewportSize({ width: 1280, height: 850 });
  await expand.click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(dashboard.locator('span')).toBeVisible();
  const people = sidebar.getByRole('button', { name: 'People & Access', exact: true });
  await people.press('Enter');
  await expect(people).toHaveAttribute('aria-current', 'page');
  await expect(expand).toBeVisible();
  await expand.click();
  await sidebar.getByRole('link', { name: 'My profile' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(expand).toBeVisible();
});

test('navigation drawer keeps focus and toasts across the tablet breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 850 });
  await fixture(page, { role: 'employee' });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(drawer).toBeVisible();
  await page.setViewportSize({ width: 760, height: 850 });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Close navigation' }).focus();
  await page.keyboard.press('Shift+Tab');
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { kind: 'info', message: 'Drawer notification' },
      }),
    ),
  );
  await expect(drawer.getByText('Drawer notification', { exact: true })).toBeVisible();
  await expect(page.getByText('Drawer notification', { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 900, height: 850 });
  await expect(drawer).toHaveCount(0);
  await expect(page.getByText('Drawer notification', { exact: true })).toBeVisible();
});
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
test('one Microsoft button retries a failed sign-in with account selection', async ({ page }) => {
  await page.route('**/api/auth/config', route =>
    route.fulfill({
      json: {
        enabled: true,
        tenantId: ids.tenant,
        webClientId: ids.api,
        apiClientId: ids.api,
        cookieSession: true,
        backendSignIn: true,
        sessionActive: false,
      },
    }),
  );
  await page.route('**/api/auth/login?*', route =>
    route.fulfill({ contentType: 'text/html', body: '<title>Microsoft sign-in</title>' }),
  );
  await page.goto('/profile?signin=failed');
  const card = page.getByRole('region', { name: /^(Welcome back|Skill Management App)$/ });
  const signIn = card.getByRole('button', { name: 'Continue with Microsoft' });
  await expect(card.getByRole('button')).toHaveCount(1);
  const login = page.waitForRequest(
    request => new URL(request.url()).pathname === '/api/auth/login',
  );
  await signIn.click();
  const params = new URL((await login).url()).searchParams;
  expect(params.get('mode')).toBe('choose');
  expect(params.get('returnTo')).toBe('/profile');
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
  let masterReads = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/business/workflow/masters') masterReads++;
  });
  await page.goto('/test/e2e/harness.html?fixture=business');
  const create = page.getByRole('button', { name: 'New catalogue request' });
  await expect(create).toBeEnabled();
  expect(masterReads).toBe(0);
  await create.click();
  await expect(page.getByRole('heading', { name: 'What would you like to change?' })).toBeVisible();
  await page.getByRole('button', { name: 'Provider', exact: true }).click();
  await page.getByRole('button', { name: /Update an existing entry/ }).click();
  await page.getByRole('combobox').selectOption('issuer');
  expect(masterReads).toBe(1);
  await page.getByRole('button', { name: /Next: entry details/ }).click();
  await expect(page.getByText('Update provider: Synthetic issuer')).toBeVisible();
});
test('review search and category keep the assigned approvals workbench visible', async ({
  page,
}) => {
  await fixture(page, { role: 'manager' });
  await page.goto('/test/e2e/harness.html?fixture=reviews');
  await expect(page.getByRole('region', { name: 'Assigned skill approvals' })).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'Search approvals by employee or skill' })
    .fill('Synthetic');
  await expect(page.getByRole('region', { name: 'Assigned skill approvals' })).toBeVisible();
  await page.getByLabel('Approval category').selectOption('Synthetic');
  await expect(page.getByRole('region', { name: 'Assigned skill approvals' })).toBeVisible();
});

test('workforce: employee filters delivered skills and reads approval feedback', async ({
  page,
}) => {
  await fixture(page, { role: 'employee', realistic: true });
  await page.goto('/my-skills');
  await expect(page.getByRole('button', { name: 'View SQL claim' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search skills and certifications' }).fill('Python');
  await expect(page.getByRole('button', { name: 'View SQL claim' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Python draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear portfolio filters' }).click();
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
    dialog.getByText('Credential details reviewed by Rohan Mehta.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('portfolio combines skills and certificates with one type switch and shared status filters', async ({
  page,
}) => {
  await fixture(page, { role: 'employee', realistic: true });
  const records = certificates(ids.person);
  await page.route('**/api/capability-submissions?**', route =>
    route.fulfill({ json: { records: [] } }),
  );
  await page.route('**/api/certifications?**', route =>
    route.fulfill({
      json: {
        snapshotRevision: 1,
        records: [
          ...records,
          {
            ...records[0],
            id: '66666666-6666-4666-8666-000000000003',
            certificationName: 'Pending AWS credential',
            status: 'SUBMITTED',
          },
        ],
        total: 3,
        page: 1,
        pageSize: 25,
        canManage: true,
      },
    }),
  );
  await page.goto('/my-skills');
  const sections = page.getByRole('group', { name: 'Portfolio type' });
  const all = sections.getByRole('button', { name: /^All\b/ });
  const certifications = sections.getByRole('button', { name: /^Certifications\b/ });
  const pending = page.getByRole('listitem', { name: 'Pending AWS credential' });
  const skill = page.getByRole('button', { name: 'View SQL claim' });
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(skill).toBeVisible();
  await expect(pending).toBeVisible();
  const chips = page.getByRole('group', { name: 'Status quick filters' });
  await chips.getByRole('button', { name: /^Needs action/ }).click();
  await expect(pending).toBeVisible();
  await expect(skill).toHaveCount(0);
  await chips.getByRole('button', { name: /^Approved/ }).click();
  await expect(pending).toHaveCount(0);
  await expect(skill).toBeVisible();
  await page.getByRole('button', { name: 'Clear portfolio filters' }).click();
  await certifications.click();
  await expect(certifications).toHaveAttribute('aria-pressed', 'true');
  await expect(skill).toHaveCount(0);
  const expired = page.getByRole('listitem', { name: 'Microsoft Power BI Data Analyst' });
  await expect(expired.getByText('Expired', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: /^Pending:.*Filter pending items/ }).click();
  await expect(pending).toBeVisible();
  await expect(expired).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('admin home opens the dashboard, catalogue marks the active destination, and unavailable tabs explain access', async ({
  page,
}) => {
  await fixture(page, { role: 'admin', businessAdministration: false });
  await page.goto('/');
  await expect(page).toHaveURL(/\/access\?view=overview$/);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.goto('/access?view=profiles');
  await expect(page.getByRole('heading', { name: 'Access is not assigned' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to your workspace' })).toBeVisible();
  const mobile = page.viewportSize()!.width < 600;
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Skill catalogue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skill catalogue', exact: true })).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('button', { name: 'Skill catalogue', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('link', { name: 'Sopra Steria' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  if (mobile) await expect(page.getByRole('dialog', { name: 'Workspace navigation' })).toBeHidden();
});
