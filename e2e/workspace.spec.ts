import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { people, claims, plan, certificates, request as workforceRequest } from './workforce-data';
const require = createRequire(import.meta.url);
const v8toIstanbul = require('v8-to-istanbul');
const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  api: '22222222-2222-4222-8222-222222222222',
  person: '33333333-3333-4333-8333-333333333333',
};
type State = {
  role: 'employee' | 'manager' | 'admin';
  failure?: number;
  pending?: boolean;
  logoutFailure?: boolean;
  realistic?: boolean;
  mutations?: Record<string, unknown>[];
};
async function fixture(page: Page, state: State) {
  const practice = {
    session: {
      revision: 1,
      notes: 'Compare joins using representative transaction data.',
      minutes: 40,
      resources: [
        {
          label: 'SQL window functions reference',
          url: 'https://learn.microsoft.com/en-us/sql/t-sql/queries/select-over-clause-transact-sql',
        },
      ],
    },
    quizzes: [],
    attempts: [],
  };
  const currentPlan = structuredClone(plan);
  const currentRequest = structuredClone(workforceRequest);
  const requestEvents = [
    {
      id: 'event-1',
      revision: 1,
      action: 'CREATE',
      body: currentRequest.description,
      actorName: people.employee.displayName,
      at: currentRequest.createdAt,
    },
  ];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/dev-login') return json({}, 404);
    if (path === '/api/auth/config')
      return json({
        enabled: true,
        tenantId: ids.tenant,
        apiClientId: ids.api,
        webClientId: ids.api,
      });
    if (route.request().headers().authorization !== 'Bearer synthetic-e2e-access-token')
      return json({ error: { message: 'Synthetic token required' } }, 401);
    const person = {
      id: ids.person,
      ...people[state.role],
      roles: [state.role],
      active: true,
      roleIds: [],
      overrides: [],
    };
    const method = route.request().method();
    if (state.realistic) {
      if (path.endsWith('/evidence')) return json({ revision: 3, canUpload: false, items: [] });
      if (path.startsWith('/api/skill-reviews/'))
        return json({ history: [], total: 0, pageSize: 25 });
      if (path === '/api/my-skills')
        return json({ claims, total: claims.length, page: 1, pageSize: 25, canClaim: true });
      if (path === '/api/certifications')
        return json({
          snapshotRevision: 1,
          records: certificates(ids.person),
          total: 2,
          page: 1,
          pageSize: 25,
          canManage: true,
          canSubmitNew: true,
          canReview: false,
          canUploadImage: true,
        });
      if (path.startsWith('/api/capability-submissions/links/')) return json({ links: [] });
      if (path.startsWith('/api/capability-submissions/')) return json({ records: [] });
      if (path === '/api/learning') {
        if (method === 'POST') {
          const body = route.request().postDataJSON();
          state.mutations?.push(body);
          if (body.id !== currentPlan.id || body.revision !== currentPlan.revision)
            return json({ error: { message: 'Stale plan' } }, 409);
          if (body.action === 'PAUSE') currentPlan.status = 'PAUSED';
          if (body.action === 'RESUME') currentPlan.status = 'ACTIVE';
          currentPlan.revision++;
          return json({ id: currentPlan.id });
        }
        return json({ actorId: ids.person, plans: [currentPlan], canManage: true });
      }
      if (path.includes('/practice')) {
        if (method === 'POST') {
          const body = route.request().postDataJSON();
          state.mutations?.push(body);
          if (body.revision !== practice.session.revision)
            return json({ error: { message: 'Stale session' } }, 409);
          practice.session = {
            revision: practice.session.revision + 1,
            notes: body.notes,
            minutes: body.minutes,
            resources: body.resources,
          };
        }
        return json(practice);
      }
      if (path.endsWith('/image')) return json({ items: [] });
      if (path.startsWith('/api/certifications/'))
        return json({ record: certificates(ids.person).find(c => path.endsWith(c.id)) });
      if (path === '/api/workflows/options')
        return json({
          canRequest: true,
          canIncident: true,
          recipients: [
            {
              id: '55555555-5555-4555-8555-000000000001',
              name: people.manager.displayName,
              kind: 'REQUEST',
              reportingManager: true,
            },
          ],
        });
      if (path === '/api/workflows') {
        if (method === 'POST') {
          const body = route.request().postDataJSON();
          state.mutations?.push(body);
          if (body.id !== currentRequest.id || body.revision !== currentRequest.revision)
            return json({ error: { message: 'Stale request' } }, 409);
          currentRequest.revision++;
          if (body.action === 'CANCEL') {
            currentRequest.status = 'CANCELLED';
            currentRequest.canCancel = false;
          }
          requestEvents.push({
            id: body.eventId,
            revision: currentRequest.revision,
            action: body.action,
            body: body.body,
            actorName: people.employee.displayName,
            at: '2026-11-05T03:30:00Z',
          });
          return json({ id: currentRequest.id });
        }
        return json({
          items: [currentRequest],
          total: 1,
          page: 1,
          pageSize: 25,
          summary: {
            total: 1,
            submitted: 1,
            cancelled: 0,
            inProgress: 0,
            resolved: 0,
            incidents: 0,
            highPriority: 0,
            myTotal: 1,
            assignedTotal: 0,
          },
        });
      }
      if (path === '/api/workflows/' + workforceRequest.id)
        return json({ record: currentRequest, events: requestEvents });
    }
    const capabilities = {
      ownProfile: true,
      ownSkills: true,
      claimSkills: true,
      certifications: true,
      learning: true,
      requests: true,
      catalogue: true,
      reviewSkills: state.role === 'manager',
      administration: state.role === 'admin',
      manageCatalogue: state.role === 'admin',
      amendments: state.role !== 'employee',
      approveAmendments: state.role === 'admin',
      businessOperations: false,
    };
    if (path === '/api/workspace')
      return state.failure
        ? json(
            {
              error: {
                code: state.pending ? 'ACCESS_NOT_PROVISIONED' : 'UNAVAILABLE',
                message: state.pending
                  ? 'Workspace access is not assigned.'
                  : 'Synthetic workspace unavailable',
              },
            },
            state.failure,
          )
        : json({ person, capabilities, upcoming: [], authentication: 'microsoft' });
    if (path === '/api/auth/identity') return json({ tenantId: ids.tenant, objectId: ids.person });
    if (path === '/api/me')
      return json({
        profile: { ...person, status: 'ACTIVE', organization: 'Aster Analytics' },
      });
    if (path === '/api/effective-access')
      return json({
        actorId: ids.person,
        revision: 1,
        summaryOnly: false,
        decisions: [],
        unsupportedAssignments: [],
      });
    if (path === '/api/notifications') return json({ personId: ids.person, items: [] });
    if (path === '/api/access')
      return json({
        revision: 1,
        currentPerson: person,
        authentication: 'microsoft',
        roles: [],
        people: [person],
        presets: [],
        catalogue: [],
        audit: [],
        canManageUsers: true,
        canViewSkills: true,
        canViewAudit: true,
      });
    if (path === '/api/skills/certifications')
      return json({
        revision: 1,
        total: 1,
        pageSize: 25,
        certifications: [
          {
            id: 'cert-one',
            name: 'Existing certificate',
            provider: 'Synthetic issuer',
            active: true,
          },
        ],
      });
    if (path === '/api/skills')
      return json({
        revision: 1,
        canManage: state.role === 'admin',
        total: 0,
        page: 1,
        pageSize: 25,
        skills: [],
      });
    if (path === '/api/skill-reviews')
      return json({
        claims: [],
        total: 0,
        pageSize: 25,
        categories: ['Synthetic'],
        canReadHistory: true,
        canViewTeam: true,
        canRecommend: true,
      });
    if (path === '/api/business/context')
      return json({
        actorId: ids.person,
        canView: false,
        canAmend: true,
        canApprove: state.role === 'admin',
        canExport: false,
        scopes: [],
      });
    if (path === '/api/business/workflow/masters')
      return json({
        revision: 1,
        page: 1,
        pageSize: 25,
        providerTotal: 1,
        certificationTotal: 1,
        skillTotal: 1,
        providers: [{ id: 'issuer', name: 'Synthetic issuer', active: true }],
        certifications: [],
        skills: [{ id: 'skill-a', name: 'Skill Alpha', active: true }],
      });
    if (path === '/api/business/workflow/amendments')
      return json({
        revision: 1,
        rows: [],
        total: 0,
        page: 1,
        pageSize: 25,
        canApprove: state.role === 'admin',
      });
    if (path.startsWith('/api/ai/'))
      return json({ error: { message: 'Synthetic AI disconnected' } }, 503);
    return json({ error: { message: 'Synthetic fixture does not implement ' + path } }, 503);
  });
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+05:30'));
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
});
test.afterEach(async ({ page }, info) => {
  const entries = await page.coverage.stopJSCoverage();
  const out = join(process.cwd(), 'artifacts/coverage/browser');
  mkdirSync(out, { recursive: true });
  const coverage: Record<string, unknown> = {};
  for (const entry of entries) {
    const url = new URL(entry.url || 'http://invalid');
    if (!url.pathname.startsWith('/src/') || !/\.(ts|tsx)$/.test(url.pathname) || !entry.source)
      continue;
    const path = join(process.cwd(), 'apps/web', decodeURIComponent(url.pathname));
    try {
      const converter = v8toIstanbul(path, 0, { source: entry.source });
      await converter.load();
      converter.applyCoverage(entry.functions);
      for (const [name, value] of Object.entries(converter.toIstanbul())) {
        const normalized = normalize(name);
        (value as any).path = normalized;
        coverage[normalized] = value;
      }
    } catch (error) {
      throw Error('Coverage mapping failed for ' + url.pathname + ': ' + String(error));
    }
  }
  writeFileSync(join(out, `${info.project.name}-${info.testId}.json`), JSON.stringify(coverage));
});
for (const role of ['employee', 'manager', 'admin'] as const) {
  test(`${role}: own profile, navigation and keyboard account menu`, async ({ page }) => {
    await fixture(page, { role });
    await page.goto('/profile');
    await expect(
      page.getByRole('heading', { name: people[role].displayName, exact: true }),
    ).toBeVisible();
    const menu = page.getByRole('button', { name: 'Account menu for ' + people[role].displayName });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
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
  await page.locator('summary').filter({ hasText: 'Earlier individual reviews' }).click();
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
