import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
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
};
async function fixture(page: Page, state: State) {
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
      displayName: 'Synthetic ' + state.role,
      employeeCode: 'E2E',
      roles: [state.role],
      active: true,
      roleIds: [],
      overrides: [],
    };
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
        profile: { ...person, status: 'ACTIVE', organization: 'Synthetic workspace' },
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
      page.getByRole('heading', { name: 'Synthetic ' + role, exact: true }),
    ).toBeVisible();
    const menu = page.getByRole('button', { name: 'Account menu for Synthetic ' + role });
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
    page.getByRole('heading', { name: 'Synthetic employee', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Account menu for Synthetic employee' }).click();
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
    page.getByRole('heading', { name: 'Synthetic employee', exact: true }),
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
