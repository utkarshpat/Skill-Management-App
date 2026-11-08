import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act, useState } from 'react';
import { render, closeBrowser, settle } from './support/browser';
import { component, click, change, fill } from './support/interactions';

const { PermissionEditor } =
  component<typeof import('../src/PermissionEditor')>('PermissionEditor.tsx');
const { RoleAssignments } =
  component<typeof import('../src/RoleAssignments')>('RoleAssignments.tsx');
const { AccessDirectory } =
  component<typeof import('../src/AccessDirectory')>('AccessDirectory.tsx');
let view: Awaited<ReturnType<typeof render>> | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
});
after(closeBrowser);
const names = [
  'Priya Nair',
  'Rohan Mehta',
  'Aditi Menon',
  'Kabir Sinha',
  'Meera Joshi',
  'Neha Rao',
  'Vivek Kumar',
  'Sahil Singh',
  'Gunjan Joshi',
  'Jyoti Kumari',
  'Khushi Agrawal',
  'Utkarsh Patel',
];
const people = names.map((displayName, i) => ({
  id: 'person-' + i,
  displayName,
  employeeCode: String(710300 + i),
  active: i !== 4,
  roleIds: i === 0 ? ['role-0'] : [],
}));
const roles = [
  'Delivery Support',
  'Catalogue Administration',
  'People Administration',
  'Learning Coordination',
].map((name, i) => ({ id: 'role-' + i, name, permissions: [] }));

test('permission editor distinguishes supported and historical grants, scopes, expiry and removal', async () => {
  const edits: any[] = [];
  function Editor() {
    const [value, setValue] = useState<any[]>([
      { permission: 'reports.old', scope: 'ORGANIZATION', effect: 'ALLOW' },
    ]);
    return (
      <PermissionEditor
        label="Individual exceptions"
        individual
        value={value}
        onChange={next => {
          edits.push(next);
          setValue(next);
        }}
        catalogue={[
          { code: 'profile.view', label: 'View own profile', implemented: true, scopes: ['OWN'] },
          {
            code: 'skill.verify',
            label: 'Review skills',
            implemented: true,
            scopes: ['ORGANIZATION'],
          },
          { code: 'reports.old', label: 'Historical reporting', implemented: false, scopes: [] },
          ...Array.from({ length: 7 }, (_, i) => ({
            code: 'request.action' + i,
            label: 'Request action ' + i,
            implemented: true,
            scopes: ['OWN' as const],
          })),
          { code: 'custom.view', label: 'Custom view', implemented: true, scopes: ['OWN'] },
        ]}
      />
    );
  }
  view = await render(<Editor />);
  const checkbox = (label: string) =>
    document.querySelector<HTMLInputElement>('input[aria-label="' + label + '"]')!;
  assert.equal(checkbox('Review skills · Own records').disabled, true);
  await act(async () => checkbox('View own profile · Own records').click());
  await settle();
  await fill('Effect', 'DENY');
  await fill('Reason', 'Temporary account reconciliation');
  await fill('Expires', '2027-03-01T09:00');
  assert.equal(edits.at(-1).find((g: any) => g.permission === 'profile.view').effect, 'DENY');
  await click('Back to permissions');
  await fill('Scope', 'ORGANIZATION');
  assert.equal(checkbox('Historical reporting · Entire workspace').disabled, false);
  await click('Configure Historical reporting · Entire workspace');
  await click('Remove assignment');
  assert.ok(!edits.at(-1).some((g: any) => g.permission === 'reports.old'));
  await fill('Scope', 'OWN');
  await click('Next permissions');
  await click('Previous permissions');
  await fill('Category', 'other');
  assert.equal(checkbox('Custom view · Own records').disabled, false);
  await fill('Search', 'unmatched');
  assert.match(document.body.textContent ?? '', /No matching permissions/);
});

test('bulk assignment drafts preserve existing templates and revert exact toggles across pages', async () => {
  let draft: Record<string, string[]> = {},
    saves = 0;
  const actions = document.createElement('div');
  document.body.append(actions);
  function Matrix() {
    const [values, setValues] = useState<Record<string, string[]>>({});
    const [department, setDepartment] = useState('');
    draft = values;
    return (
      <RoleAssignments
        people={people}
        roles={roles}
        departments={[{ id: 'client', name: 'NHS SBS IT' }]}
        membership={Object.fromEntries(people.slice(0, 4).map(p => [p.id, 'client']))}
        department={department}
        onDepartmentChange={setDepartment}
        draft={values}
        setDraft={setValues}
        busy={false}
        canManage
        actionsContainer={actions}
        onSave={() => saves++}
      />
    );
  }
  try {
    view = await render(<Matrix />);
    await click('Edit assignments');
    const toggle = () =>
      document.querySelector<HTMLInputElement>(
        'input[aria-label="Assign Delivery Support to Priya Nair"]',
      )!;
    await act(async () => toggle().click());
    await settle();
    assert.deepEqual(draft['person-0'], []);
    await act(async () => toggle().click());
    await settle();
    assert.deepEqual(draft, {});
    await click('Next roles');
    await click('Previous roles');
    await click('Next people');
    await click('Previous people');
    await fill('Accounts/Clients', 'client', document.querySelector('dialog')!);
    const field = document.querySelector<HTMLInputElement>(
      'dialog input[aria-label="Assign Catalogue Administration to Priya Nair"]',
    )!;
    await act(async () => field.click());
    await settle();
    assert.deepEqual(draft['person-0'], ['role-0', 'role-1']);
    await click('Save assignments');
    assert.equal(saves, 1);
    await click('Close');
    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search role assignments"]',
    )!;
    await change(search, 'Nobody matches');
    assert.match(document.body.textContent ?? '', /No matching people/);
  } finally {
    actions.remove();
  }
});

test('directory search, active filtering and independent template editing operate on exact records', async () => {
  const selected: string[] = [];
  view = await render(
    <AccessDirectory
      kind="people"
      people={people}
      roles={roles}
      busy={false}
      onPerson={id => selected.push(id)}
      onRole={() => assert.fail('Unexpected template edit')}
    />,
  );
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search people"]')!;
  await change(search, '710300');
  await click('Manage person Priya Nair');
  assert.deepEqual(selected, ['person-0']);
  await change(search, 'no match');
  assert.match(document.body.textContent ?? '', /No matching/);
  await change(search, '');
  const filter = document.querySelector<HTMLSelectElement>('select')!;
  await change(filter, 'suspended');
  assert.match(document.body.textContent ?? '', /Meera Joshi/);
  assert.doesNotMatch(document.body.textContent ?? '', /Priya Nair/);
  await view.unmount();
  view = undefined;
  view = await render(
    <AccessDirectory
      kind="roles"
      people={people}
      roles={roles}
      busy={false}
      onPerson={() => assert.fail('Unexpected person edit')}
      onRole={id => selected.push(id)}
    />,
  );
  await click('Edit Delivery Support');
  assert.equal(selected.at(-1), 'role-0');
});
