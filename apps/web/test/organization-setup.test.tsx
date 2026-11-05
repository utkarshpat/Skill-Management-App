import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { act } from 'react';
import { closeBrowser, demoResponse, render, settle } from './support/browser';

Object.assign(globalThis, {
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const require = createRequire(import.meta.url);
const { refreshDevelopmentLogin } = require('../src/auth.ts') as typeof import('../src/auth');
const { OrganizationSetup } = (() => {
  const css = require.extensions['.css'];
  // Node has no stylesheet loader; keep the actual component and dialog code.
  require.extensions['.css'] = () => {};
  try {
    return require('../src/OrganizationSetup.tsx') as typeof import('../src/OrganizationSetup');
  } finally {
    if (css) require.extensions['.css'] = css;
    else delete require.extensions['.css'];
  }
})();
const employee = '10000000-0000-4000-8000-000000000001';
const client = '10000000-0000-4000-8000-000000000002';
const project = '10000000-0000-4000-8000-000000000003';
const manager = '10000000-0000-4000-8000-000000000004';
const snapshot = {
  revision: 7,
  nodes: [
    { id: 'unit', kind: 'DELIVERY_UNIT', name: 'Example Unit', parentId: null, active: true },
    {
      id: 'portfolio',
      kind: 'PORTFOLIO',
      name: 'Example Division',
      parentId: 'unit',
      active: true,
    },
    { id: client, kind: 'DEPARTMENT', name: 'Example Client', parentId: 'portfolio', active: true },
    { id: project, kind: 'TEAM', name: 'Example Project', parentId: client, active: true },
    {
      id: 'archived',
      kind: 'DEPARTMENT',
      name: 'Archived Client',
      parentId: 'portfolio',
      active: false,
    },
  ],
  people: [
    { id: employee, displayName: 'Test Employee', employeeCode: 'TEST', active: true },
    { id: manager, displayName: 'Test Manager', employeeCode: 'MGR', active: true },
    { id: 'inactive', displayName: 'Inactive Person', employeeCode: 'OLD', active: false },
  ],
  assignments: [] as {
    personId: string;
    departmentId: string | null;
    teamId: string | null;
    managerId: string | null;
  }[],
};
let responseSnapshot = structuredClone(snapshot);
let mounted: Awaited<ReturnType<typeof render>> | undefined;
let toolbar: HTMLDivElement;
const writes: { path: string; body: Record<string, unknown> }[] = [];
beforeEach(async () => {
  responseSnapshot = structuredClone(snapshot);
  writes.length = 0;
  toolbar = document.createElement('div');
  document.body.append(toolbar);
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    assert.match(path, /^\/api\/access\/organization(?:\/preview)?$/);
    if (init?.method !== 'POST') return Response.json(responseSnapshot);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    writes.push({ path, body });
    if (path.endsWith('/preview'))
      return Response.json({
        receipt: 'server-preview-receipt',
        before: null,
        after: {
          personId: body.personId,
          departmentId: body.departmentId,
          teamId: body.teamId,
          managerId: body.managerId,
        },
        warnings: ['Placement does not automatically grant access.'],
      });
    return Response.json({ saved: true });
  });
  await refreshDevelopmentLogin();
  await mount();
});
async function mount() {
  mounted = await render(
    <OrganizationSetup
      actionsContainer={toolbar}
      onChanged={() => {}}
      onEditPerson={() => {}}
      onAssignDepartment={() => {}}
      roleNames={{}}
    />,
  );
  await settle();
}
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  toolbar.remove();
  mock.restoreAll();
});
after(closeBrowser);

async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    node => node.textContent?.trim() === text,
  );
  assert.ok(button, `Missing button: ${text}`);
  await act(async () => button.click());
}

async function editNode(name: string) {
  const node = Array.from(document.querySelectorAll<HTMLButtonElement>('.visual-node-select')).find(
    button => button.querySelector('strong')?.textContent === name,
  );
  assert.ok(node);
  await act(async () => node.click());
  const edit = document.querySelector<HTMLElement>(`[aria-label="Edit ${name}"]`);
  assert.ok(edit);
  await act(async () => edit.click());
}

test('add-child follows Portfolio/Division and switching level resets an incompatible parent', async () => {
  await editNode('Example Unit');
  assert.doesNotMatch(document.body.textContent!, /People directly in this/);
  await click('Add portfolio/division');
  let fields = document.querySelectorAll<HTMLSelectElement>('#organization-editor select');
  assert.equal(fields[0].value, 'PORTFOLIO');
  assert.equal(fields[1].value, 'unit');
  assert.deepEqual(
    Array.from(fields[1].options, option => option.value),
    ['', 'unit'],
  );
  await select(fields[0], 'DEPARTMENT');
  fields = document.querySelectorAll<HTMLSelectElement>('#organization-editor select');
  assert.equal(fields[1].value, '');
  assert.deepEqual(
    Array.from(fields[1].options, option => option.value),
    ['', 'portfolio'],
  );
  await select(fields[0], 'TEAM');
  assert.deepEqual(
    Array.from(fields[1].options, option => option.value),
    ['', client],
  );
  assert.equal(writes.length, 0);
});

test('unmapped legacy placement stays visible and cannot be silently cleared when changing reporting', async () => {
  await mounted!.unmount();
  responseSnapshot.nodes.find(n => n.id === client)!.parentId = 'unit';
  responseSnapshot.assignments = [
    { personId: employee, departmentId: client, teamId: null, managerId: manager },
  ];
  await mount();
  assert.match(
    document.body.textContent!,
    /existing accounts\/clients need approved Portfolio\/Division mapping/,
  );
  await editNode('Example Client');
  const parent = document.querySelectorAll<HTMLSelectElement>('#organization-editor select')[1];
  assert.equal(parent.value, 'unit');
  assert.equal(parent.selectedOptions[0].disabled, true);
  assert.match(parent.selectedOptions[0].textContent!, /Needs mapping/);
  await click('Cancel');
  await click('Reporting lines');
  await click('Assign person');
  const fields = document.querySelectorAll<HTMLSelectElement>('#reporting-editor select');
  await select(fields[0], employee);
  assert.equal(fields[1].value, client);
  assert.equal(fields[1].selectedOptions[0].disabled, true);
  assert.match(fields[1].selectedOptions[0].textContent!, /Needs mapping/);
  assert.equal(
    Array.from(fields[1].options).some(o => ['unit', 'portfolio', project].includes(o.value)),
    false,
  );
  await act(async () =>
    document
      .querySelector('#reporting-editor')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.equal(writes.length, 0);
  assert.match(document.body.textContent!, /Resolve the existing placement mapping/);
  await select(fields[1], '');
  await act(async () =>
    document
      .querySelector('#reporting-editor')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  assert.equal(writes[0].body.departmentId, null);
  assert.equal(writes[0].body.teamId, null);
  assert.equal(writes[0].body.managerId, manager);
});
async function select(field: HTMLSelectElement, value: string) {
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('organization tree and editor display new names while preserving kind and parent values', async () => {
  assert.match(mounted!.container.textContent!, /Accounts\/Clients/);
  assert.match(mounted!.container.textContent!, /Project/);
  assert.doesNotMatch(mounted!.container.textContent!, /Archived Client/);
  const projectNode = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.visual-node-select'),
  ).find(node => node.querySelector('strong')?.textContent === 'Example Project');
  assert.ok(projectNode);
  await act(async () => projectNode.click());
  const edit = document.querySelector<HTMLElement>('[aria-label="Edit Example Project"]');
  assert.ok(edit);
  await act(async () => edit.click());
  const fields = document.querySelectorAll<HTMLSelectElement>('#organization-editor select');
  assert.equal(fields[0].value, 'TEAM');
  assert.equal(fields[0].disabled, true);
  assert.deepEqual(
    Array.from(fields[0].options, option => [option.value, option.textContent]),
    [
      ['DELIVERY_UNIT', 'Delivery unit'],
      ['PORTFOLIO', 'Portfolio/Division'],
      ['DEPARTMENT', 'Accounts/Clients'],
      ['TEAM', 'Project'],
    ],
  );
  assert.equal(fields[1].value, client);
  assert.doesNotMatch(fields[1].textContent!, /Archived Client/);
  assert.equal(writes.length, 0);
});

for (const placement of [client, project, '']) {
  test(`assignment ${placement || 'unassigned'} retains original keys through preview and explicit confirmation`, async () => {
    await click('Reporting lines');
    await click('Assign person');
    const fields = document.querySelectorAll<HTMLSelectElement>('#reporting-editor select');
    await select(fields[0], employee);
    await select(fields[1], placement);
    await select(fields[2], manager);
    assert.doesNotMatch(fields[0].textContent!, /Inactive Person/);
    assert.equal(
      Array.from(fields[2].options).some(option => option.value === employee),
      false,
    );
    assert.match(
      document.querySelector('#reporting-editor')!.textContent!,
      /Accounts\/Clients or project/,
    );
    assert.match(
      document.querySelector('#reporting-editor')!.textContent!,
      /memberships are managed separately/,
    );
    assert.equal(
      Array.from(fields[1].options).some(option => option.value === 'archived'),
      false,
    );
    assert.equal(
      Array.from(fields[1].options).some(option => ['unit', 'portfolio'].includes(option.value)),
      false,
    );
    await act(async () =>
      document
        .querySelector('#reporting-editor')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await settle();
    const expected = {
      kind: 'assignment',
      personId: employee,
      departmentId: placement === client ? client : null,
      teamId: placement === project ? project : null,
      managerId: manager,
      revision: 7,
    };
    assert.deepEqual(writes, [{ path: '/api/access/organization/preview', body: expected }]);
    assert.match(document.body.textContent!, /Accounts\/Clients ID/);
    assert.match(document.body.textContent!, /Project ID/);
    assert.match(document.body.textContent!, /Placement does not automatically grant access/);
    assert.doesNotMatch(
      document.querySelector('pre:last-of-type')!.textContent!,
      /departmentId|teamId/,
    );
    await click('Confirm & save');
    await settle();
    assert.deepEqual(writes[1], {
      path: '/api/access/organization',
      body: { ...expected, previewReceipt: 'server-preview-receipt' },
    });
  });
}
