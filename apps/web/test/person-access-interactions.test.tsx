import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import {
  refreshDevelopmentLogin,
  component,
  click,
  fill,
  change,
  debounce,
} from './support/interactions';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const { PersonAccessDialog } =
  component<typeof import('../src/PersonAccessDialog')>('PersonAccessDialog.tsx');
type Props = Parameters<typeof PersonAccessDialog>[0];
const person: Props['person'] = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Aditi Menon',
  employeeCode: 'EMP-1042',
  jobTitle: 'Delivery Analyst',
  grade: 'B2',
  active: true,
  roleIds: ['support'],
  overrides: [
    {
      permission: 'reports.view',
      scope: 'ORGANIZATION',
      effect: 'ALLOW',
      reason: 'Historical unsupported grant retained for review',
    },
  ],
};
const manager = {
  ...person,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  displayName: 'Rohan Mehta',
  employeeCode: 'EMP-1007',
  roleIds: [],
  overrides: [],
};
const catalogue: Props['catalogue'] = [
  { code: 'skill.view', label: 'View skills', implemented: true, scopes: ['OWN', 'ORGANIZATION'] },
  { code: 'users.manage', label: 'Manage people', implemented: true, scopes: ['ORGANIZATION'] },
  { code: 'request.view', label: 'View requests', implemented: true, scopes: ['OWN'] },
  { code: 'reports.view', label: 'Planned report scope', implemented: false, scopes: [] },
];
const roles: Props['roles'] = [
  {
    id: 'support',
    name: 'Delivery Support',
    permissions: [{ permission: 'request.view', scope: 'OWN', effect: 'ALLOW' }],
  },
  {
    id: 'people',
    name: 'People administration',
    permissions: [{ permission: 'users.manage', scope: 'ORGANIZATION', effect: 'ALLOW' }],
  },
  {
    id: 'planned',
    name: 'Planned capability lead',
    permissions: [{ permission: 'reports.view', scope: 'ORGANIZATION', effect: 'ALLOW' }],
  },
];
let mounted: Awaited<ReturnType<typeof render>> | undefined,
  previews: Props['person'][] = [],
  previewError = false,
  accessMismatch = false,
  edited = 0,
  managed = 0,
  reloaded = 0,
  apply: (p: Props['person']) => Promise<void>;
beforeEach(async () => {
  previews = [];
  previewError = false;
  accessMismatch = false;
  edited = 0;
  managed = 0;
  reloaded = 0;
  apply = async p => {
    previews.push(structuredClone(p));
    if (previewError) throw Error('Configuration changed. Reload before previewing.');
  };
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    if (path.includes('/effective/'))
      return Response.json({
        actorId: accessMismatch ? manager.id : person.id,
        revision: 7,
        summaryOnly: true,
        decisions: [
          {
            action: 'skill.view',
            implemented: true,
            allowed: false,
            reasonCode: 'EXPLICIT_DENY',
            resolvedScope: { kind: 'OWN' },
            constraints: ['Current access required'],
            sources: [
              { kind: 'override', label: 'Temporary protection', effect: 'DENY', scope: 'OWN' },
            ],
          },
        ],
        unsupportedAssignments: [],
      });
    if (path.startsWith('/api/access/audit?'))
      return Response.json({
        items: [
          {
            revision: 7,
            action: 'access.person.updated',
            at: '2026-11-05T05:00:00Z',
            actorId: manager.id,
            targetId: person.id,
            actorName: manager.displayName,
            targetName: person.displayName,
            before: { active: false },
            after: { active: true },
          },
        ],
        nextCursor: null,
      });
    throw Error('Unexpected person access request ' + path);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(options: Partial<Props> = {}) {
  mounted = await render(
    <PersonAccessDialog
      person={person}
      roles={roles}
      catalogue={catalogue}
      people={[person, manager]}
      organization={{
        nodes: [
          {
            id: 'client',
            kind: 'DEPARTMENT',
            name: 'Northstar Bank',
            parentId: 'portfolio',
            active: true,
          },
        ],
        assignments: [
          { personId: person.id, departmentId: 'client', teamId: null, managerId: manager.id },
        ],
      }}
      canManageUsers
      canViewAudit
      endpoint="/api/access"
      revision={7}
      onClose={() => {}}
      onApplyChange={p => apply(p)}
      onFullEdit={() => edited++}
      onManageOrganization={() => managed++}
      onReload={async () => {
        reloaded++;
      }}
      {...options}
    />,
  );
  await settle();
  await settle();
}
async function advanced() {
  const detail = document.querySelector<HTMLDetailsElement>('.access-advanced-tools')!;
  await act(async () => {
    detail.open = true;
    detail.dispatchEvent(new Event('toggle'));
  });
  await settle();
}
async function submitException() {
  const form = document.querySelector('.access-override-form');
  assert.ok(form);
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

test('access profile renders server denials, organization context and audit without deriving authority from title or manager links', async () => {
  await mount();
  await fill('Show', 'denied');
  assert.match(document.body.textContent!, /Temporary protection/);
  assert.match(document.body.textContent!, /Block overrides Allow/);
  await click('Organization');
  assert.match(document.body.textContent!, /Rohan Mehta/);
  assert.match(document.body.textContent!, /Needs administrator attention/);
  await click('Edit organization & reporting');
  assert.equal(managed, 1);
  await click('Edit person details');
  assert.equal(edited, 1);
  await click('Audit History');
  await debounce();
  assert.match(document.body.textContent!, /Rohan Mehta/);
  assert.match(document.body.textContent!, /Aditi Menon/);
  assert.equal(previews.length, 0);
});
test('additional templates are explicitly previewed; unsupported historical assignments remain untouched', async () => {
  await mount();
  await advanced();
  await click('Additional templates');
  const select = document.querySelector<HTMLSelectElement>(
    '[aria-label="Additional access template"]',
  );
  assert.ok(select);
  assert.equal(
    Array.from(select.options).some(o => o.value === 'planned'),
    false,
  );
  await change(select, 'people');
  await click('Review assignment');
  assert.deepEqual(previews[0].roleIds, ['support', 'people']);
  assert.deepEqual(previews[0].overrides, person.overrides);
  assert.deepEqual(person.roleIds, ['support']);
  await click('Review removal');
  assert.deepEqual(previews[1].roleIds, []);
  assert.deepEqual(previews[1].overrides, person.overrides);
});
test('permission exceptions require current supported scope, reason and future expiry before preview', async () => {
  await mount();
  await advanced();
  await click('Permission exceptions');
  await submitException();
  assert.equal(
    document.querySelector<HTMLInputElement>('.access-override-form input[maxlength="200"]')!
      .validity.valueMissing,
    true,
  );
  assert.equal(previews.length, 0);
  await fill('Business reason', 'Temporary customer delivery access review');
  await fill('Expiry date', '2020-01-01');
  await submitException();
  assert.match(document.body.textContent!, /future/i);
  assert.equal(previews.length, 0);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 10);
  const local = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, '0')}-${String(expiry.getDate()).padStart(2, '0')}`;
  await fill('Expiry date', local);
  await fill('Permission effect', 'DENY');
  await submitException();
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].overrides[0], person.overrides[0]);
  assert.deepEqual(previews[0].overrides[1], {
    permission: 'skill.view',
    scope: 'OWN',
    effect: 'DENY',
    validUntil: previews[0].overrides[1].validUntil,
    reason: 'Temporary customer delivery access review',
  });
  assert.ok(Date.parse(previews[0].overrides[1].validUntil!) > Date.now());
  await fill('Permission', 'users.manage');
  const scopes = document.querySelector<HTMLSelectElement>(
    '.access-override-form label:nth-child(3) select',
  );
  assert.ok(scopes);
  assert.deepEqual(
    Array.from(scopes.options, o => o.value),
    ['ORGANIZATION'],
  );
  assert.deepEqual(person.overrides, [
    {
      permission: 'reports.view',
      scope: 'ORGANIZATION',
      effect: 'ALLOW',
      reason: 'Historical unsupported grant retained for review',
    },
  ]);
});
test('preview failures and repeated clicks cannot silently save or duplicate a pending access change', async () => {
  await mount();
  await advanced();
  await click('Additional templates');
  await change(
    document.querySelector<HTMLSelectElement>('[aria-label="Additional access template"]')!,
    'people',
  );
  previewError = true;
  await click('Review assignment');
  assert.match(document.body.textContent!, /Configuration changed/);
  await click('Reload current configuration');
  assert.equal(reloaded, 1);
  previewError = false;
  const wait = deferred<void>();
  apply = async p => {
    previews.push(structuredClone(p));
    await wait.promise;
  };
  await change(
    document.querySelector<HTMLSelectElement>('[aria-label="Additional access template"]')!,
    'people',
  );
  await click('Review assignment');
  await click('Review assignment');
  assert.equal(previews.length, 2);
  wait.resolve();
  await settle();
  assert.deepEqual(person.roleIds, ['support']);
});
test('read-only and identity-mismatched access profiles never expose person edit controls', async () => {
  accessMismatch = true;
  await mount({ canManageUsers: false, canViewAudit: false });
  assert.match(document.body.textContent!, /Access identity mismatch/);
  assert.doesNotMatch(
    document.querySelector('.form-dialog')!.textContent!,
    /Edit person details|Audit History/,
  );
  await advanced();
  await click('Additional templates');
  assert.doesNotMatch(
    document.querySelector('.form-dialog')!.textContent!,
    /Review assignment|Review removal/,
  );
  await advanced();
  await click('Permission exceptions');
  assert.equal(document.querySelector('.access-override-form'), null);
  assert.equal(previews.length, 0);
});
