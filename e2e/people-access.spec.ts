import { expect, fixture, ids, test } from './browser-fixture';

test('People & Access searches on demand and reviews template assignment and removal', async ({
  page,
}) => {
  await fixture(page, { role: 'admin', businessAdministration: true });
  const employee = {
    id: '88888888-8888-4888-8888-000000000002',
    displayName: 'Aditi Menon',
    employeeCode: '710902',
    active: true,
    jobTitle: 'Delivery engineer',
    grade: 'G3',
    primaryCapabilityId: null,
    overrides: [],
  };
  const template = {
    id: '88888888-8888-4888-8888-000000000003',
    name: 'Delivery Support',
    permissions: [{ permission: 'request.view', scope: 'OWN', effect: 'ALLOW' }],
  };
  let roleIds: string[] = [];
  let revision = 7;
  const previews: string[][] = [];
  const saves: string[][] = [];
  const requests: string[] = [];
  const scopedPreviews: unknown[] = [];
  const project = {
    id: template.id,
    name: 'Payments Modernisation',
    active: true,
    departmentId: null,
  };
  await page.route('**/api/business/administration?personId=' + employee.id, route =>
    route.fulfill({
      json: {
        revision,
        personalBaseline: true,
        baselineAffectedPeople: 1,
        people: [
          {
            id: employee.id,
            name: employee.displayName,
            employeeCode: employee.employeeCode,
            active: true,
          },
        ],
        projects: [project],
        memberships: [],
        responsibilities: [],
        nodes: [],
        historicalGrantsForReview: [],
      },
    }),
  );
  await page.route('**/api/business/administration/preview', route => {
    const change = route.request().postDataJSON();
    scopedPreviews.push(change.payload);
    return route.fulfill({
      json: {
        change,
        before: null,
        after: change.payload,
        impact: {},
        warnings: [],
        receipt: 'reviewed-scope',
      },
    });
  });
  await page.route('**/api/access**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    const person = { ...employee, roleIds };
    requests.push(path + url.search);
    if (path === '/api/access' && route.request().method() === 'GET') {
      if (url.search !== '?summary=1')
        return json({ error: { message: 'Unexpected full read' } }, 500);
      return json({
        revision,
        currentPerson: { ...person, id: ids.person },
        canManageUsers: true,
        canViewAudit: true,
        people: [],
        roles: [],
        audit: [],
        catalogue: [
          { code: 'request.view', label: 'View requests', implemented: true, scopes: ['OWN'] },
        ],
      });
    }
    if (path === '/api/access/directory') {
      const items =
        url.searchParams.get('kind') === 'templates'
          ? [template]
          : [
              {
                id: employee.id,
                name: employee.displayName,
                employeeCode: employee.employeeCode,
                active: true,
              },
            ];
      return json({ revision, items, total: items.length, page: 1, pageSize: 10 });
    }
    if (path === '/api/access/people/' + employee.id)
      return json({
        revision,
        person,
        roles: roleIds.length ? [template] : [],
        organization: { nodes: [], assignments: [], people: [] },
      });
    if (path === '/api/access/primary-capabilities')
      return json({ items: [], total: 0, page: 1, pageSize: 20 });
    if (path === '/api/access/preview') {
      const body = route.request().postDataJSON();
      previews.push(body.roleIds);
      return json({
        before: person,
        after: body,
        receipt: 'reviewed-' + revision,
        impacts: [],
        warnings: [],
      });
    }
    if (path === '/api/access' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (
        body.id !== employee.id ||
        body.revision !== revision ||
        body.previewReceipt !== 'reviewed-' + revision ||
        JSON.stringify(body.roleIds) !== JSON.stringify(previews.at(-1))
      )
        return json({ error: { message: 'Review the exact change before saving' } }, 409);
      roleIds = body.roleIds;
      saves.push(roleIds);
      return json({ saved: true, revision: ++revision });
    }
    return json({ error: { message: 'Unexpected People & Access request' } }, 500);
  });
  await page.goto('/access');
  const search = page.getByRole('searchbox', { name: 'Find person' });
  await expect(search).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage template definitions' })).toHaveCSS(
    'text-decoration-line',
    'none',
  );
  await expect(page.getByText(/Start with a name or employee ID/)).toBeVisible();
  expect(requests).toEqual(['/api/access?summary=1']);
  await search.fill('710902');
  await page.getByRole('button', { name: /Aditi Menon.*710902/ }).click();
  await expect(page.getByRole('region', { name: 'Selected person' })).toBeFocused();
  await page.getByRole('button', { name: 'Templates (0)' }).click();
  await page.getByLabel('Template to assign').selectOption(template.id);
  await page.getByRole('button', { name: 'Review template assignment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Assign Delivery Support to Aditi Menon/)).toBeVisible();
  expect(saves).toEqual([]);
  await dialog.getByRole('button', { name: 'Confirm & save' }).click();
  await page.getByRole('button', { name: 'Remove template Delivery Support' }).click();
  await dialog.getByRole('button', { name: 'Back to edit' }).click();
  expect(saves).toEqual([[template.id]]);
  await page.getByRole('button', { name: 'Remove template Delivery Support' }).click();
  await dialog.getByRole('button', { name: 'Confirm & save' }).click();
  await expect(page.getByText('No additional templates assigned.')).toBeVisible();
  expect(saves).toEqual([[template.id], []]);
  expect(
    requests
      .filter(path => path.includes('/people/'))
      .every(path => path === '/api/access/people/' + employee.id),
  ).toBe(true);
  expect(requests).not.toContain('/api/access/organization');

  const form = page.locator('#bo-access-assignment-form');
  const scope = form.getByRole('combobox', { name: 'Scope', exact: true });
  await page.getByRole('button', { name: 'Assign Business Analytics' }).click();
  await expect(form.getByRole('combobox', { name: 'Responsibility' })).toHaveValue(
    'BUSINESS_OPERATIONS',
  );
  await expect(scope).toHaveValue('');
  await form.getByRole('textbox', { name: 'Reason' }).fill('Review payments delivery skills');
  await form.getByRole('button', { name: 'Preview change' }).click();
  expect(scopedPreviews).toEqual([]);
  await scope.selectOption('PROJECT');
  await form.getByRole('combobox', { name: 'Scope binding' }).selectOption(project.id);
  await form.getByRole('button', { name: 'Preview change' }).click();
  await expect(dialog).toBeVisible();
  expect(scopedPreviews[0]).toMatchObject({
    personId: employee.id,
    bundle: 'BUSINESS_OPERATIONS',
    kind: 'PROJECT',
    scopeId: project.id,
  });
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Templates (0)' }).click();
  await page.getByRole('button', { name: 'Assign Admin', exact: true }).click();
  await expect(form.getByRole('combobox', { name: 'Responsibility' })).toHaveValue('SYSTEM_ADMIN');
  await expect(scope).toHaveValue('ORGANIZATION');
  await expect(scope).toBeDisabled();
  await form.getByRole('textbox', { name: 'Reason' }).fill('App administration coverage');
  await form.getByRole('button', { name: 'Preview change' }).click();
  await expect(dialog).toBeVisible();
  expect(scopedPreviews[1]).toMatchObject({
    personId: employee.id,
    bundle: 'SYSTEM_ADMIN',
    kind: 'ORGANIZATION',
    scopeId: null,
  });
});

test('fresh personal route skips /api/access while preserving Organization, Activity log and People & Access navigation', async ({
  page,
}) => {
  await fixture(page, { role: 'admin', businessAdministration: true });
  const accessRequests: string[] = [];
  await page.route('**/api/access**', async route => {
    const url = new URL(route.request().url());
    accessRequests.push(url.pathname + url.search);
    return route.fulfill({
      json: {
        revision: 3,
        currentPerson: {
          id: ids.person,
          displayName: 'Priya Nair',
          employeeCode: 'ADM-1',
          active: true,
          roleIds: [],
          overrides: [],
        },
        canManageUsers: true,
        canViewAudit: true,
        people: [],
        roles: [],
        audit: [],
        catalogue: [],
      },
    });
  });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  const sidebar = page.locator('nav[aria-label="Administration sections"]:visible');
  await expect(sidebar.getByRole('button', { name: 'Organization', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Activity log', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'People & Access', exact: true })).toBeVisible();
  expect(accessRequests).toEqual([]);

  await sidebar.getByRole('button', { name: 'People & Access', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Find person' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('people');
  expect(accessRequests).toEqual(['/api/access?summary=1']);
});

