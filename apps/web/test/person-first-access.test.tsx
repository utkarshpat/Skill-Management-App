import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, type ComponentProps } from 'react';
import { registerHooks } from 'node:module';
import { closeBrowser, render, settle } from './support/browser';
import { initializeAuth } from '../src/auth';
import type { OrganizationSummary } from '../src/organization-summary';

const cssHooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { PersonAccessDialog } = await import('../src/PersonAccessDialog');
const { OrganizationSetup } = await import('../src/OrganizationSetup');
Object.assign(globalThis, {
  HTMLFormElement: window.HTMLFormElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
after(async () => {
  cssHooks.deregister();
  await closeBrowser();
});
type Person = ComponentProps<typeof PersonAccessDialog>['person'];
const person: Person = {
  id: 'person',
  displayName: 'Example Employee',
  employeeCode: 'TEST-1',
  active: true,
  roleIds: [],
  overrides: [],
};
const manager = { ...person, id: 'manager', displayName: 'Example Manager' };
const organization: OrganizationSummary = {
  nodes: [
    { id: 'du', kind: 'DELIVERY_UNIT', name: 'Example DU', parentId: null, active: true },
    { id: 'portfolio', kind: 'PORTFOLIO', name: 'Example Portfolio', parentId: 'du', active: true },
    {
      id: 'client',
      kind: 'DEPARTMENT',
      name: 'Example Client',
      parentId: 'portfolio',
      active: true,
    },
    { id: 'project', kind: 'TEAM', name: 'Example Project', parentId: 'client', active: true },
  ],
  assignments: [
    { personId: person.id, departmentId: null, teamId: 'project', managerId: manager.id },
  ],
};

test('person overview exposes reporting and access; advanced assignments remain preview-only', async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const path = String(input);
    requests.push(path);
    if (path.includes('/dev-login'))
      return Response.json({ mode: 'local-demo', signedIn: true, people: [] });
    return Response.json({
      actorId: person.id,
      revision: 1,
      decisions: [],
      unsupportedAssignments: [],
    });
  };
  await initializeAuth();
  let organizationEdits = 0;
  const previews: Person[] = [];
  const props = {
    person,
    people: [person, manager],
    roles: [{ id: 'template', name: 'Example template', permissions: [] }],
    catalogue: [],
    organization,
    canManageUsers: true,
    canViewAudit: false,
    endpoint: '/api/dev-access',
    revision: 1,
    onClose: () => {},
    onFullEdit: () => {},
    onManageOrganization: () => {
      organizationEdits++;
    },
    onApplyChange: async (updated: Person) => {
      previews.push(updated);
    },
    businessAdministrationNode: <p>Person-bound scoped access editor</p>,
  };
  const view = await render(<PersonAccessDialog {...props} />);
  await settle();
  const dialog = () => document.querySelector('dialog')!;
  const click = async (label: string) => {
    const button = [...dialog().querySelectorAll('button')].find(
      b => b.textContent?.trim() === label,
    );
    assert.ok(button, label);
    await act(async () => button.click());
  };
  assert.match(
    dialog().textContent ?? '',
    /Example DU → Example Portfolio → Example Client → Example Project/,
  );
  assert.match(dialog().textContent ?? '', /Example Manager/);
  assert.ok(dialog().querySelector('details.access-advanced-tools:not([open])'));
  assert.equal(previews.length, 0);
  assert.ok(requests.some(path => path.includes('/effective/person')));
  await click('Edit organization & reporting');
  assert.equal(organizationEdits, 1);
  await click('Access');
  assert.match(dialog().textContent ?? '', /Person-bound scoped access editor/);
  const advanced = dialog().querySelector<HTMLDetailsElement>('.access-advanced-tools')!;
  await act(async () => {
    advanced.open = true;
    advanced.dispatchEvent(new Event('toggle'));
  });
  await click('Additional templates (0)');
  const select = dialog().querySelector<HTMLSelectElement>('select.access-select')!;
  await act(async () => {
    select.value = 'template';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Review assignment');
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].roleIds, ['template']);
  assert.deepEqual(person.roleIds, []);
  await view.update(
    <PersonAccessDialog
      {...props}
      onApplyChange={async () => {
        throw new Error('Preview unavailable; no changes saved.');
      }}
    />,
  );
  await click('Review assignment');
  assert.match(dialog().textContent ?? '', /Preview unavailable; no changes saved/);
  assert.equal(
    dialog().querySelector<HTMLSelectElement>('select.access-select')!.value,
    'template',
  );
  await act(async () => {
    advanced.open = false;
    advanced.dispatchEvent(new Event('toggle'));
  });
  const overview = [...dialog().querySelectorAll('button')].find(
    b => b.textContent?.trim() === 'Overview',
  )!;
  assert.equal(overview.getAttribute('aria-pressed'), 'true');
  assert.ok(
    ![...dialog().querySelectorAll('button')].some(b => b.textContent?.trim() === 'Audit History'),
  );
  await view.unmount();
});

test('organization handoff selects only the requested person and retains invalid placement for repair', async () => {
  const requests: string[] = [];
  let assignments = organization.assignments.map(item => ({
    ...item,
    teamId: 'missing-project',
    managerId: manager.id,
  }));
  globalThis.fetch = async input => {
    const path = String(input);
    requests.push(path);
    if (path.includes('/dev-login'))
      return Response.json({ mode: 'local-demo', signedIn: true, people: [] });
    return Response.json({ ...organization, assignments, people: [manager, person], revision: 1 });
  };
  await initializeAuth();
  const props = {
    actionsContainer: null,
    onChanged: () => {},
    onEditPerson: () => {},
    onAssignDepartment: () => {},
    roleNames: {},
  };
  const view = await render(<OrganizationSetup {...props} initialPersonId={person.id} />);
  await settle();
  const form = document.querySelector<HTMLFormElement>('#reporting-editor')!;
  assert.ok(form);
  const selects = [...form.querySelectorAll('select')];
  assert.equal(selects[0].value, person.id);
  assert.equal(selects[1].value, 'missing-project');
  assert.equal(selects[2].value, manager.id);
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  assert.match(document.body.textContent ?? '', /Resolve the existing placement mapping/);
  assert.ok(!requests.some(path => path.endsWith('/preview')));
  await view.update(<OrganizationSetup key="missing" {...props} initialPersonId="unavailable" />);
  await settle();
  assert.match(document.body.textContent ?? '', /This person is unavailable/);
  assert.equal(document.querySelector('#reporting-editor'), null);
  assignments = [...assignments, ...assignments];
  await view.update(<OrganizationSetup key="duplicate" {...props} initialPersonId={person.id} />);
  await settle();
  assert.match(document.body.textContent ?? '', /conflicting organization assignments/);
  assert.equal(document.querySelector('#reporting-editor'), null);
  await view.update(<OrganizationSetup key="general" {...props} />);
  await settle();
  assert.equal(document.querySelector('#reporting-editor'), null);
  await view.unmount();
});

test('missing, inactive and duplicate organization data never look like valid assignments', async () => {
  const props = {
    person,
    people: [person, manager],
    roles: [],
    catalogue: [],
    canManageUsers: false,
    endpoint: '/api/dev-access',
    revision: 1,
    onClose: () => {},
    onFullEdit: () => {},
    onApplyChange: async () => {},
  };
  const view = await render(<PersonAccessDialog {...props} />);
  assert.match(
    document.querySelector('dialog')!.textContent ?? '',
    /Organization details unavailable/,
  );
  assert.ok(
    ![...document.querySelectorAll('button')].some(b =>
      b.textContent?.includes('Edit person details'),
    ),
  );
  await view.update(
    <PersonAccessDialog {...props} organization={{ nodes: organization.nodes, assignments: [] }} />,
  );
  assert.match(document.querySelector('dialog')!.textContent ?? '', /Not assigned/);
  await view.update(
    <PersonAccessDialog
      {...props}
      organization={{
        ...organization,
        nodes: organization.nodes.map(n => (n.id === 'portfolio' ? { ...n, active: false } : n)),
      }}
    />,
  );
  assert.match(
    document.querySelector('dialog')!.textContent ?? '',
    /Needs administrator attention/,
  );
  await view.update(
    <PersonAccessDialog
      {...props}
      organization={{
        ...organization,
        assignments: [...organization.assignments, ...organization.assignments],
      }}
    />,
  );
  assert.match(
    document.querySelector('dialog')!.textContent ?? '',
    /Needs administrator attention/,
  );
  assert.doesNotMatch(document.querySelector('dialog')!.textContent ?? '', /Example DU →/);
  await view.update(
    <PersonAccessDialog
      {...props}
      organization={{
        ...organization,
        assignments: organization.assignments.map(item => ({ ...item, managerId: person.id })),
      }}
    />,
  );
  assert.match(document.querySelector('dialog')!.textContent ?? '', /Reporting needs attention/);
  assert.doesNotMatch(
    document.querySelector('.access-banner-meta-row')!.textContent ?? '',
    /Manager: Example Employee/,
  );
  await view.update(
    <PersonAccessDialog
      {...props}
      organization={{
        ...organization,
        nodes: organization.nodes.map(node =>
          node.id === 'du' ? { ...node, parentId: 'project' } : node,
        ),
      }}
    />,
  );
  assert.match(
    document.querySelector('.access-banner-meta-row')!.textContent ?? '',
    /Placement needs attention/,
  );
  await view.unmount();
});
