import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { component, refreshDevelopmentLogin, click, fill, change } from './support/interactions';
const { OrganizationSetup } =
  component<typeof import('../src/OrganizationSetup')>('OrganizationSetup.tsx');
const initial = {
  revision: 12,
  nodes: [
    { id: 'du', kind: 'DELIVERY_UNIT', name: 'DU UK', parentId: null, active: true },
    {
      id: 'portfolio',
      kind: 'PORTFOLIO',
      name: 'Healthcare Delivery',
      parentId: 'du',
      active: true,
    },
    { id: 'client', kind: 'DEPARTMENT', name: 'NHS SBS IT', parentId: 'portfolio', active: true },
    { id: 'project', kind: 'TEAM', name: 'NHS Reporting', parentId: 'client', active: true },
    {
      id: 'old-client',
      kind: 'DEPARTMENT',
      name: 'Archived Client',
      parentId: 'du',
      active: false,
    },
  ],
  people: [
    { id: 'aditi', displayName: 'Aditi Menon', employeeCode: '710902', active: true },
    { id: 'rohan', displayName: 'Rohan Mehta', employeeCode: '710903', active: true },
    { id: 'priya', displayName: 'Priya Nair', employeeCode: '710904', active: true },
  ],
  assignments: [
    { personId: 'aditi', teamId: 'project', departmentId: null, managerId: 'rohan' },
    { personId: 'rohan', teamId: null, departmentId: 'client', managerId: 'priya' },
    { personId: 'priya', teamId: null, departmentId: 'client', managerId: null },
  ],
};
let state: typeof initial,
  view: Awaited<ReturnType<typeof render>> | undefined,
  toolbar: HTMLDivElement;
let failure = 0,
  saveFailure = 0,
  previewFailure = 0,
  changed = 0;
let writes: { url: string; body: any }[] = [],
  edited: string[] = [],
  assigned: string[] = [];
beforeEach(async () => {
  state = structuredClone(initial);
  failure = 0;
  saveFailure = 0;
  previewFailure = 0;
  changed = 0;
  writes = [];
  edited = [];
  assigned = [];
  toolbar = document.createElement('div');
  document.body.append(toolbar);
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    assert.ok(url.startsWith('/api/dev-access/organization'));
    if (init?.method !== 'POST')
      return failure ? Response.json({}, { status: failure }) : Response.json(state);
    const body = JSON.parse(String(init.body));
    writes.push({ url, body });
    if (url.endsWith('/preview'))
      return previewFailure
        ? Response.json(
            { error: { message: 'Preview is unavailable' } },
            { status: previewFailure },
          )
        : Response.json({
            receipt: 'current-organization-receipt',
            before: { managerId: 'rohan' },
            after: body,
            warnings: ['Review the current direct-manager relationship.'],
          });
    if (saveFailure)
      return Response.json(
        { error: { message: 'Organization revision changed. Preview again.' } },
        { status: saveFailure },
      );
    state.revision++;
    return Response.json({ ok: true });
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  toolbar.remove();
  mock.restoreAll();
});
after(closeBrowser);
async function mount(initialPersonId?: string) {
  view = await render(
    <OrganizationSetup
      actionsContainer={toolbar}
      endpoint="/api/dev-access/organization"
      onChanged={() => changed++}
      onEditPerson={id => edited.push(id)}
      onAssignDepartment={id => assigned.push(id)}
      roleNames={{ rohan: ['Delivery Manager'] }}
      initialPersonId={initialPersonId}
    />,
  );
  await settle();
  await settle();
}
async function submit(id: string) {
  await act(async () =>
    document
      .getElementById(id)!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  await settle();
}

test('reporting change previews exact placement and uses receipt only after explicit confirmation', async () => {
  await mount('aditi');
  assert.match(document.body.textContent!, /Rohan Mehta/);
  const manager = document.querySelector('#reporting-editor select:last-of-type');
  await fill('Direct reporting manager', 'priya');
  await submit('reporting-editor');
  assert.equal(writes.length, 1);
  assert.equal(document.querySelectorAll('.form-dialog').length, 1);
  assert.equal(document.querySelector('#reporting-editor'), null);
  assert.equal(writes[0].url, '/api/dev-access/organization/preview');
  assert.deepEqual(writes[0].body, {
    kind: 'assignment',
    personId: 'aditi',
    teamId: 'project',
    departmentId: null,
    managerId: 'priya',
    revision: 12,
  });
  assert.match(document.body.textContent!, /Review the current direct-manager relationship/);
  await click('Back to edit');
  assert.equal(writes.length, 1);
  await submit('reporting-editor');
  await click('Confirm & save');
  assert.deepEqual(writes[2].body, {
    ...writes[0].body,
    previewReceipt: 'current-organization-receipt',
  });
  assert.equal(changed, 1);
  assert.match(document.body.textContent!, /saved and audited/);
});

test('failed organization recheck requires a fresh preview and preserves assignment edits', async () => {
  await mount('aditi');
  await fill('Direct reporting manager', 'priya');
  await submit('reporting-editor');
  saveFailure = 409;
  await click('Confirm & save');
  assert.equal(changed, 0);
  assert.match(document.body.textContent!, /revision changed/);
  assert.equal(
    (document.querySelector('#reporting-editor select') as HTMLSelectElement).value,
    'aditi',
  );
  assert.equal(
    [...document.querySelectorAll('h2')].some(
      h => h.textContent === 'Review reporting & membership',
    ),
    false,
  );
  saveFailure = 0;
  await submit('reporting-editor');
  await click('Confirm & save');
  assert.equal(changed, 1);
  assert.equal(writes.filter(w => w.url.endsWith('/preview')).length, 2);
});

test('manager choices exclude self and descendants; malformed placement requires explicit repair', async () => {
  state.assignments[0].teamId = 'missing-project';
  await mount('aditi');
  const manager = [...document.querySelectorAll('label')]
    .find(l => l.textContent?.trim().startsWith('Direct reporting manager'))!
    .querySelector('select')!;
  assert.ok(![...manager.options].some(option => option.value === 'aditi'));
  await submit('reporting-editor');
  assert.equal(writes.length, 0);
  assert.match(document.body.textContent!, /Resolve the existing placement/);
  await fill('Accounts/Clients or project', '');
  await fill('Direct reporting manager', '');
  await submit('reporting-editor');
  assert.equal(writes[0].body.teamId, null);
  assert.equal(writes[0].body.departmentId, null);
  assert.equal(writes[0].body.managerId, null);
  await click('Back to edit');
  await fill('Person', 'priya');
  const currentManager = [...document.querySelectorAll('label')]
    .find(l => l.textContent?.trim().startsWith('Direct reporting manager'))!
    .querySelector('select')!;
  assert.deepEqual(
    [...currentManager.options].map(option => option.value),
    [''],
  );
  await click('Edit roles');
  assert.deepEqual(edited, ['priya']);
});

test('branch creation validates hierarchy and previews a portfolio under the selected DU', async () => {
  await mount();
  await click('Add delivery unit');
  await submit('organization-editor');
  assert.equal(writes.length, 0);
  assert.equal(
    document.querySelector<HTMLInputElement>('#organization-editor input')!.validity.valid,
    false,
  );
  await fill('Level', 'PORTFOLIO');
  await fill('Portfolio/Division name', 'Financial Services');
  await submit('organization-editor');
  assert.equal(writes.length, 0);
  assert.equal(
    document.querySelector<HTMLSelectElement>('#organization-editor select[required]')!.validity
      .valid,
    false,
  );
  await fill('Parent', 'du');
  await submit('organization-editor');
  assert.deepEqual(writes[0].body, {
    kind: 'node',
    type: 'PORTFOLIO',
    name: 'Financial Services',
    parentId: 'du',
    active: true,
    revision: 12,
  });
  await click('Back to edit');
  previewFailure = 503;
  await submit('organization-editor');
  assert.match(document.body.textContent!, /Preview is unavailable/);
  assert.equal(changed, 0);
  await click('Cancel');
  assert.equal(document.querySelector('#organization-editor'), null);
});

test('organization load denial retries without exposing an optimistic hierarchy', async () => {
  failure = 403;
  await mount();
  assert.match(document.body.textContent!, /requires people administration permission/);
  assert.equal(document.querySelector('.visual-tree-canvas'), null);
  failure = 0;
  await click('Retry');
  assert.ok(document.querySelector('.visual-tree-canvas'));
  await click('Reporting lines');
  await change(document.querySelector('[aria-label="Search hierarchy"]')!, 'Aditi');
  assert.match(document.body.textContent!, /Aditi Menon/);
  await click('Collapse all');
  await click('Expand all');
  await click('Organization');
  await change(document.querySelector('[aria-label="Search hierarchy"]')!, '');
  await act(async () =>
    [...document.querySelectorAll('label')]
      .find(l => l.textContent?.includes('Show archived'))!
      .querySelector('input')!
      .click(),
  );
  assert.match(document.body.textContent!, /Archived Client/);
});

test('client branch opens role assignment for the exact client and preselects it for a new project', async () => {
  await mount();
  await click('NHS SBS IT');
  await click('Edit branch');
  await click('Assign roles');
  assert.deepEqual(assigned, ['client']);
  await click('Add project');
  assert.equal(
    document.querySelector<HTMLSelectElement>('#organization-editor select[required]')!.value,
    'client',
  );
  await fill('Project name', 'Clinical Reporting');
  await submit('organization-editor');
  assert.deepEqual(writes[0].body, {
    kind: 'node',
    type: 'TEAM',
    name: 'Clinical Reporting',
    parentId: 'client',
    active: true,
    revision: 12,
  });
  await click('Back to edit');
  assert.equal(
    document.querySelector<HTMLInputElement>('#organization-editor input')!.value,
    'Clinical Reporting',
  );
  await click('Cancel');
  assert.equal(writes.length, 1);
});

test('archiving a branch is previewed with its existing identity and parent', async () => {
  await mount();
  await click('NHS SBS IT');
  await click('Edit branch');
  await act(async () =>
    document
      .querySelector<HTMLInputElement>('#organization-editor input[type="checkbox"]')!
      .click(),
  );
  assert.equal(writes.length, 0);
  await submit('organization-editor');
  assert.deepEqual(writes[0].body, {
    kind: 'node',
    id: 'client',
    type: 'DEPARTMENT',
    name: 'NHS SBS IT',
    parentId: 'portfolio',
    active: false,
    revision: 12,
  });
  await click('Back to edit');
  assert.equal(
    document.querySelector<HTMLInputElement>('#organization-editor input[type="checkbox"]')!
      .checked,
    false,
  );
  assert.equal(changed, 0);
});

test('opening reporting from a direct member preserves the existing placement and manager', async () => {
  await mount();
  await click('NHS SBS IT');
  await click('Rohan Mehta');
  assert.match(document.body.textContent!, /Saved reporting chain/);
  await click('Edit reporting');
  assert.deepEqual(
    [...document.querySelectorAll<HTMLSelectElement>('#reporting-editor select')].map(
      select => select.value,
    ),
    ['rohan', 'client', 'priya'],
  );
  await click('Cancel');
  assert.equal(writes.length, 0);
});

test('assigning from a project starts without an employee and previews only the chosen move', async () => {
  await mount();
  await click('NHS Reporting');
  await click('Assign a person');
  const fields = [...document.querySelectorAll<HTMLSelectElement>('#reporting-editor select')];
  assert.deepEqual(
    fields.map(select => select.value),
    ['', 'project', ''],
  );
  await fill('Person', 'rohan');
  assert.deepEqual(
    fields.map(select => select.value),
    ['rohan', 'client', 'priya'],
  );
  await fill('Accounts/Clients or project', 'project');
  await submit('reporting-editor');
  assert.deepEqual(writes[0].body, {
    kind: 'assignment',
    personId: 'rohan',
    teamId: 'project',
    departmentId: null,
    managerId: 'priya',
    revision: 12,
  });
  assert.equal(changed, 0);
});

test('tree zoom clamps to its bounds and resetting restores the original scale', async () => {
  await mount();
  const zoom = document.querySelector('[aria-label="Tree zoom"]')!;
  await click('Zoom in tree', zoom);
  await click('Zoom in tree', zoom);
  assert.match(zoom.textContent!, /150%/);
  assert.equal(
    zoom.querySelector<HTMLButtonElement>('[aria-label="Zoom in tree"]')!.disabled,
    true,
  );
  await click('Zoom out tree', zoom);
  assert.match(zoom.textContent!, /125%/);
  await click('Fit tree', zoom);
  assert.match(zoom.textContent!, /25%/);
  assert.equal(
    zoom.querySelector<HTMLButtonElement>('[aria-label="Zoom out tree"]')!.disabled,
    true,
  );
  await click('Reset', zoom);
  assert.match(zoom.textContent!, /100%/);
  assert.equal(writes.length, 0);
});

test('closing a reporting preview preserves the edit but never commits it', async () => {
  await mount('aditi');
  await fill('Direct reporting manager', 'priya');
  await submit('reporting-editor');
  await click('Close Review reporting & membership');
  const manager = [...document.querySelectorAll('label')]
    .find(label => label.textContent?.trim().startsWith('Direct reporting manager'))!
    .querySelector('select')!;
  assert.equal(manager.value, 'priya');
  await click('Close Reporting & membership');
  assert.equal(document.querySelector('#reporting-editor'), null);
  assert.equal(writes.length, 1);
  assert.equal(changed, 0);
});

test('organization reload after a rejected preview reads the current revision before retry', async () => {
  await mount();
  await click('Add delivery unit');
  await fill('Delivery unit name', 'India Delivery');
  previewFailure = 503;
  await submit('organization-editor');
  assert.match(document.body.textContent!, /Preview is unavailable/);
  previewFailure = 0;
  state.revision = 13;
  await click('Reload organization', document);
  await submit('organization-editor');
  assert.deepEqual(
    writes.map(write => write.body.revision),
    [12, 13],
  );
  await click('Back to edit');
  const close = document.querySelector<HTMLButtonElement>(
    '.form-dialog button[aria-label^="Close "]',
  )!;
  await click(close.getAttribute('aria-label')!);
  assert.equal(document.querySelector('#organization-editor'), null);
  assert.equal(changed, 0);
});
