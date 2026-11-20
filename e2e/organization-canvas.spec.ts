import { expect, fixture, test } from './browser-fixture';

test('organization canvas fits a tall tree and supports pan and anchored zoom', async ({
  page,
}, testInfo) => {
  await fixture(page, { role: 'admin', businessAdministration: true });
  const nodes = [
    { id: 'du', kind: 'DELIVERY_UNIT', name: 'Delivery Unit', parentId: null, active: true },
    { id: 'portfolio', kind: 'PORTFOLIO', name: 'Portfolio', parentId: 'du', active: true },
    { id: 'client', kind: 'DEPARTMENT', name: 'Client', parentId: 'portfolio', active: true },
  ];
  const people = Array.from({ length: 24 }, (_, index) => ({
    id: `employee-${index}`,
    displayName: `Employee ${index}`,
    employeeCode: `E-${index}`,
    active: true,
  }));
  const assignments = people.map((person, index) => ({
    personId: person.id,
    managerId: index === 22 ? people[0].id : null,
    teamId: null,
    departmentId: 'client',
  }));
  await page.route('**/api/access/organization', route =>
    route.fulfill({ json: { revision: 1, nodes, people, assignments } }),
  );
  await page.goto('/access?view=organization');
  await page.getByRole('button', { name: 'Expand all' }).click();
  const viewport = page.getByRole('region', { name: 'Visual tree' });
  const canvas = viewport.locator('.visual-tree-canvas');
  const zoom = page.getByTestId('tree-zoom');
  await page.getByRole('button', { name: 'Fit tree' }).click();
  await expect.poll(async () => parseInt(await zoom.innerText())).toBeLessThan(25);
  const view = (await viewport.boundingBox())!;
  const fitted = (await canvas.boundingBox())!;
  expect(fitted.y).toBeGreaterThan(view.y);
  expect(fitted.y + fitted.height).toBeLessThan(view.y + view.height);

  const x = Math.round(view.x + view.width / 2);
  const y = Math.round(view.y + view.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y - 35, { steps: 5 });
  await page.mouse.up();
  const panned = (await canvas.boundingBox())!;
  expect(panned.x).toBeCloseTo(fitted.x + 45);
  expect(panned.y).toBeCloseTo(fitted.y - 35);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(panned.width);
  const zoomed = (await canvas.boundingBox())!;
  expect((x - zoomed.x) / zoomed.width).toBeCloseTo((x - panned.x) / panned.width);

  if (testInfo.project.name === 'mobile') {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 20, y, id: 0 },
        { x: x + 20, y, id: 1 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 40, y, id: 0 },
        { x: x + 40, y, id: 1 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => (await canvas.boundingBox())!.width)
      .toBeGreaterThan(zoomed.width);
    await client.detach();
  }

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(zoom).toHaveText('100%');
  await expect.poll(async () => (await canvas.boundingBox())!.x - view.x).toBeCloseTo(25);
  await page.getByRole('button', { name: 'Zoom in tree' }).click();
  await expect(zoom).toHaveText('125%');
  await viewport.focus();
  const beforeKey = (await canvas.boundingBox())!.y;
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await canvas.boundingBox())!.y).toBeLessThan(beforeKey);
  await page.getByRole('button', { name: 'Fit tree' }).click();
  await viewport.getByRole('button', { name: 'Delivery Unit' }).click();
  await expect(
    viewport.getByRole('button', { name: 'Delivery Unit', pressed: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Collapse all' }).click();
  const search = page.getByRole('textbox', { name: 'Search hierarchy' });
  await search.fill('E-23');
  await expect(viewport.getByRole('button', { name: 'Employee 23' })).toBeVisible();
  await expect(viewport.getByRole('button', { name: 'Portfolio' })).toBeVisible();
  await expect(viewport.getByRole('button', { name: 'Client' })).toBeVisible();
  await expect(viewport.getByRole('button', { name: 'Employee 0 E-0', exact: true })).toHaveCount(0);
  await search.fill('Employee 22');
  await expect(viewport.getByRole('button', { name: 'Employee 22' })).toBeVisible();
  await expect(viewport.getByRole('button', { name: 'Employee 23' })).toHaveCount(0);
  await viewport.getByRole('button', { name: 'Employee 22' }).click();
  await expect(page.getByRole('heading', { name: 'Saved reporting chain' })).toBeVisible();
  await expect(viewport.getByRole('button', { name: 'Employee 0 E-0', exact: true })).toBeVisible();
});
