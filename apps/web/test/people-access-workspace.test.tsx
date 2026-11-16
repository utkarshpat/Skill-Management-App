import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
  change,
} from './support/interactions';
const cssHooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { PeopleAccessWorkspace } = component<typeof import('../src/PeopleAccessWorkspace')>(
  'PeopleAccessWorkspace.tsx',
);
const id = '20000000-0000-4000-8000-000000000001',
  other = '20000000-0000-4000-8000-000000000002',
  role = '20000000-0000-4000-8000-000000000003',
  oldRole = '20000000-0000-4000-8000-000000000004',
  manager = '20000000-0000-4000-8000-000000000005';
const catalogue = [
  { code: 'request.view', label: 'View own requests', implemented: true, scopes: ['OWN' as const] },
];
function initial() {
  return {
    revision: 7,
    person: {
      id,
      displayName: 'Aditi Menon',
      employeeCode: '710902',
      active: true,
      jobTitle: 'Delivery engineer',
      grade: 'G3',
      primaryCapabilityId: null,
      primaryCapabilityName: null,
      primaryCapabilityStatus: null,
      roleIds: [oldRole],
      overrides: [
        {
          permission: 'reports.view',
          scope: 'ORGANIZATION',
          effect: 'ALLOW',
          reason: 'Historical grant retained',
        },
      ],
    },
    roles: [
      {
        id: oldRole,
        name: 'Historical reporting',
        permissions: [{ permission: 'reports.view', scope: 'ORGANIZATION', effect: 'ALLOW' }],
      },
    ],
    organization: {
      nodes: [
        { id: 'du', kind: 'DELIVERY_UNIT', name: 'India Delivery', parentId: null, active: true },
        {
          id: 'portfolio',
          kind: 'PORTFOLIO',
          name: 'Financial Services',
          parentId: 'du',
          active: true,
        },
        {
          id: 'client',
          kind: 'DEPARTMENT',
          name: 'Northstar Bank',
          parentId: 'portfolio',
          active: true,
        },
        {
          id: 'project',
          kind: 'TEAM',
          name: 'Payments Modernisation',
          parentId: 'client',
          active: true,
        },
      ],
      assignments: [{ personId: id, departmentId: null, teamId: 'project', managerId: manager }],
      people: [{ id: manager, displayName: 'Neha Rao', employeeCode: '710901', active: true }],
    },
  };
}
let current = initial(),
  requests: string[] = [],
  previews: { path: string; body: any }[] = [],
  writes: any[] = [],
  changed = 0,
  denied = false,
  lookupFailure = false,
  writeFailure = false;
let mounted: Awaited<ReturnType<typeof render>> | undefined;
let lookup: ((url: URL) => Promise<Response> | undefined) | undefined;
let detailRead: ((url: URL, options?: RequestInit) => Response | undefined) | undefined;
beforeEach(async () => {
  current = initial();
  requests = [];
  previews = [];
  writes = [];
  changed = 0;
  denied = false;
  lookupFailure = false;
  writeFailure = false;
  lookup = undefined;
  detailRead = undefined;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const path = String(input);
    requests.push(path);
    if (path === '/api/dev-login') return demoResponse();
    const url = new URL(path, 'http://localhost');
    const customResponse = detailRead?.(url, options);
    if (customResponse) return customResponse;
    if (url.pathname.endsWith('/directory')) {
      const custom = lookup?.(url);
      if (custom) return custom;
      if (lookupFailure)
        return Response.json({ error: { message: 'Search unavailable' } }, { status: 503 });
      const kind = url.searchParams.get('kind');
      const items =
        kind === 'templates'
          ? [
              {
                id: role,
                name: 'Delivery Support',
                permissions: [{ permission: 'request.view', scope: 'OWN', effect: 'ALLOW' }],
              },
            ]
          : kind === 'nodes'
            ? []
            : url.searchParams.get('search') === 'Rohan'
              ? [{ id: other, name: 'Rohan Mehta', employeeCode: '710903', active: true }]
              : [{ id, name: 'Aditi Menon', employeeCode: '710902', active: true }];
      return Response.json({ revision: 7, items, total: items.length, page: 1, pageSize: 10 });
    }
    if (url.pathname.endsWith('/people/' + id))
      return denied
        ? Response.json({ error: { message: 'Access no longer assigned' } }, { status: 403 })
        : Response.json(current);
    if (url.pathname.endsWith('/people/' + other))
      return Response.json({
        ...current,
        person: {
          ...current.person,
          id: other,
          displayName: 'Rohan Mehta',
          employeeCode: '710903',
        },
      });
    if (url.pathname.endsWith('/primary-capabilities'))
      return Response.json({ items: [], total: 0, page: 1, pageSize: 20 });
    if (url.pathname.endsWith('/preview')) {
      const body = JSON.parse(String(options?.body));
      previews.push({ path, body });
      return Response.json({
        receipt: 'reviewed-person',
        before: current.person,
        after: { ...current.person, ...body },
        impacts: [],
        warnings: [],
      });
    }
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      if (writeFailure)
        return Response.json(
          { error: { message: 'Access changed; reload before saving' } },
          { status: 409 },
        );
      if (path === '/api/dev-access') {
        current = {
          ...current,
          revision: 8,
          person: { ...current.person, ...writes.at(-1) },
          roles: [
            ...current.roles,
            {
              id: role,
              name: 'Delivery Support',
              permissions: [{ permission: 'request.view', scope: 'OWN', effect: 'ALLOW' }],
            },
          ],
        };
      }
      return Response.json({ saved: true });
    }
    throw Error('Unexpected access request ' + path);
  });
  await refreshDevelopmentLogin();
  requests = [];
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(async () => {
  cssHooks.deregister();
  await closeBrowser();
});
async function waitSearch() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 340));
  });
  await settle();
  await settle();
}
async function mount(options: { canManageScoped?: boolean; canViewAudit?: boolean } = {}) {
  mounted = await render(
    <MemoryRouter>
      <PeopleAccessWorkspace
        endpoint="/api/dev-access"
        catalogue={catalogue}
        {...options}
        onChanged={() => changed++}
      />
    </MemoryRouter>,
  );
  await settle();
}
async function open() {
  await fill('Find person', 'Aditi');
  await waitSearch();
  await click('Aditi Menon');
  await settle();
}
test('blank and one-character searches load no directory; selecting a match reads only that person', async () => {
  await mount();
  assert.equal(requests.length, 0);
  await fill('Find person', 'A');
  await waitSearch();
  assert.equal(requests.length, 0);
  await open();
  assert.ok(requests.some(p => p.includes('/directory?') && p.includes('search=Aditi')));
  assert.ok(requests.some(p => p.endsWith('/people/' + id)));
  assert.ok(
    !requests.some(
      p =>
        p === '/api/dev-access' ||
        p === '/api/access/organization' ||
        p === '/api/business/administration',
    ),
  );
  assert.match(document.body.textContent ?? '', /Aditi Menon/);
  assert.equal(writes.length, 0);
});
test('the selected-person header flags ambiguous placement and manager records', async () => {
  current.organization.assignments.push({ ...current.organization.assignments[0] });
  await mount();
  await open();
  const context = document.querySelector('.people-person-context');
  assert.deepEqual(
    [...(context?.querySelectorAll('strong') ?? [])].map(label => label.textContent),
    ['Needs administrator attention', 'Needs administrator attention'],
  );
});

test('templates are first-class actions, preserve historical grants and save only the reviewed assignment', async () => {
  await mount();
  await open();
  await click('Templates');
  await waitSearch();
  assert.match(document.body.textContent ?? '', /Historical reporting/);
  await fill('Template to assign', role);
  await click('Review template assignment');
  assert.equal(writes.length, 0);
  assert.deepEqual(previews[0].body.roleIds, [oldRole, role]);
  assert.deepEqual(previews[0].body.overrides, initial().person.overrides);
  assert.equal(previews[0].body.id, id);
  await click('Confirm & save');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].previewReceipt, 'reviewed-person');
  assert.equal(changed, 1);
  assert.match(document.body.textContent ?? '', /Saved and audited/);
});
test('empty template directories and empty searches explain why there is nothing to select', async () => {
  lookup = url =>
    url.searchParams.get('kind') === 'templates'
      ? Promise.resolve(Response.json({ revision: 7, items: [], total: 0, page: 1, pageSize: 10 }))
      : undefined;
  await mount();
  await open();
  await click('Templates');
  await waitSearch();
  assert.match(document.body.textContent ?? '', /No additional templates are defined/);
  assert.equal(
    document.querySelector('a[href="/access?view=roles"]')?.textContent,
    'Manage template definitions',
  );
  assert.equal(document.querySelector('select'), null);
  await fill('Find template', 'Delivery Support');
  await waitSearch();
  assert.match(document.body.textContent ?? '', /No templates match your search/);
  assert.equal(document.querySelector('select'), null);
  assert.equal(previews.length, 0);
});
test('removing one template preserves other assignments and cancellation makes no write', async () => {
  await mount();
  await open();
  await click('Templates');
  await waitSearch();
  await click('Remove template Historical reporting');
  assert.deepEqual(previews[0].body.roleIds, []);
  assert.deepEqual(previews[0].body.overrides, initial().person.overrides);
  await click('Back to edit');
  assert.equal(writes.length, 0);
  assert.match(document.body.textContent ?? '', /Historical reporting/);
});
test('organization and manager removal are explicit, person-bound and receipt checked', async () => {
  await mount();
  await open();
  await click('Organization & manager');
  await waitSearch();
  await click('Review organization changes');
  assert.equal(previews.length, 0);
  assert.match(
    document.body.textContent ?? '',
    /Change the organization placement or reporting manager before previewing/,
  );
  await click('Clear organization assignment');
  await click('Remove manager');
  await click('Review organization changes');
  const command = previews[0];
  assert.equal(command.path, '/api/dev-access/organization/preview');
  assert.deepEqual(command.body, {
    kind: 'assignment',
    revision: 7,
    personId: id,
    teamId: null,
    departmentId: null,
    managerId: null,
  });
  assert.match(
    document.querySelector('.form-dialog')?.textContent ?? '',
    /No organization assignment.*No manager/,
  );
  assert.equal(writes.length, 0);
  await click('Confirm & save');
  assert.equal(writes[0].previewReceipt, 'reviewed-person');
});
test('assigning a new placement uses the selected parent at every level and keeps the choice across searches', async () => {
  current.organization = { nodes: [], assignments: [], people: [] };
  const nodes = {
    DELIVERY_UNIT: { id: 'new-du', name: 'Cloud Delivery', parent: null },
    PORTFOLIO: { id: 'new-portfolio', name: 'Banking', parent: 'new-du' },
    DEPARTMENT: { id: 'new-client', name: 'Oakfield Bank', parent: 'new-portfolio' },
    TEAM: { id: 'new-team', name: 'Payments Platform', parent: 'new-client' },
  };
  lookup = url => {
    if (url.searchParams.get('kind') !== 'nodes') return undefined;
    const node = nodes[url.searchParams.get('nodeKind') as keyof typeof nodes];
    assert.equal(url.searchParams.get('parentId'), node.parent);
    const items = url.searchParams.get('search') ? [] : [node];
    return Promise.resolve(
      Response.json({ revision: 7, items, total: items.length, page: 1, pageSize: 10 }),
    );
  };
  await mount();
  await open();
  await click('Organization & manager');
  await waitSearch();
  await fill('Delivery Unit', 'new-du');
  await click('Review organization changes');
  assert.equal(previews.length, 0);
  await waitSearch();
  await fill('Portfolio/Division', 'new-portfolio');
  await waitSearch();
  await fill('Accounts/Clients', 'new-client');
  await waitSearch();
  await fill('Project', 'new-team');
  await fill('Find project', 'other');
  await waitSearch();
  assert.equal(
    [...document.querySelectorAll('select')].find(s => s.value === 'new-team')?.selectedOptions[0]
      .textContent,
    'Payments Platform',
  );
  await click('Review organization changes');
  assert.deepEqual(previews[0].body, {
    kind: 'assignment',
    revision: 7,
    personId: id,
    teamId: 'new-team',
    departmentId: null,
    managerId: null,
  });
  assert.match(
    document.querySelector('.form-dialog')?.textContent ?? '',
    /Cloud Delivery.*Banking.*Oakfield Bank.*Payments Platform/,
  );
});
test('profile review shows work changes and conflicts do not report successful saving', async () => {
  await mount();
  await open();
  await fill('Grade', 'G4');
  await click('Review profile changes');
  assert.match(document.querySelector('.form-dialog')?.textContent ?? '', /G3.*G4/);
  writeFailure = true;
  await click('Confirm & save');
  assert.doesNotMatch(document.body.textContent ?? '', /Saved and audited/);
  assert.match(document.body.textContent ?? '', /Access changed/);
  assert.equal(changed, 0);
});
test('late searches cannot replace current results and lookup failure clears old choices', async () => {
  const late = deferred<Response>();
  lookup = url => (url.searchParams.get('search') === 'Aditi' ? late.promise : undefined);
  await mount();
  await fill('Find person', 'Aditi');
  await waitSearch();
  await fill('Find person', 'Rohan');
  await waitSearch();
  assert.match(document.body.textContent ?? '', /Rohan Mehta/);
  late.resolve(
    Response.json({ items: [{ id, name: 'Aditi Menon' }], total: 1, page: 1, pageSize: 10 }),
  );
  await settle();
  assert.ok(
    ![...document.querySelectorAll('button')].some(b => b.textContent?.startsWith('Aditi Menon')),
  );
  lookupFailure = true;
  await fill('Find person', 'Neha');
  await waitSearch();
  assert.match(document.body.textContent ?? '', /Search unavailable/);
  assert.ok(
    ![...document.querySelectorAll('button')].some(b => b.textContent?.startsWith('Rohan Mehta')),
  );
});
test('revoked person reads clear the editor instead of leaving cached sensitive data visible', async () => {
  await mount();
  await open();
  await fill('Grade', 'G4');
  await click('Review profile changes');
  writeFailure = true;
  await click('Confirm & save');
  denied = true;
  await click('Reload person');
  await settle();
  assert.match(document.body.textContent ?? '', /Access no longer assigned/);
  assert.equal(document.querySelector('input[value="G4"]'), null);
  assert.equal(document.querySelector('.people-person-form'), null);
});

test('manager search excludes the employee and inactive matches while preserving their placement', async () => {
  lookup = url => {
    if (url.searchParams.get('search') !== '7109') return undefined;
    return Promise.resolve(
      Response.json({
        revision: 7,
        page: 1,
        pageSize: 10,
        total: 3,
        items: [
          { id, name: 'Aditi Menon', employeeCode: '710902', active: true },
          { id: manager, name: 'Neha Rao', employeeCode: '710901', active: false },
          { id: other, name: 'Rohan Mehta', employeeCode: '710903', active: true },
        ],
      }),
    );
  };
  await mount();
  await open();
  await click('Organization & manager');
  await fill('Find manager', '7109');
  await waitSearch();
  const matches = document.querySelector('.people-manager-results')!;
  assert.doesNotMatch(matches.textContent ?? '', /Aditi Menon|Neha Rao/);
  await click('Rohan Mehta', matches);
  await click('Review organization changes');
  assert.deepEqual(previews[0].body, {
    kind: 'assignment',
    revision: 7,
    personId: id,
    teamId: 'project',
    departmentId: null,
    managerId: other,
  });
  assert.match(
    document.querySelector('.form-dialog')?.textContent ?? '',
    /Payments Modernisation.*Rohan Mehta/,
  );
  assert.equal(writes.length, 0);
});

test('template paging keeps unsupported grants unassignable and never reuses the previous page selection', async () => {
  const unsupported = '20000000-0000-4000-8000-000000000006';
  lookup = url => {
    if (url.searchParams.get('kind') !== 'templates') return undefined;
    const page = Number(url.searchParams.get('page'));
    return Promise.resolve(
      Response.json({
        revision: 7,
        page,
        pageSize: 10,
        total: 11,
        items:
          page === 1
            ? [
                {
                  id: role,
                  name: 'Delivery Support',
                  permissions: [{ permission: 'request.view', scope: 'OWN', effect: 'ALLOW' }],
                },
              ]
            : [
                {
                  id: unsupported,
                  name: 'Historical finance reports',
                  permissions: [
                    { permission: 'reports.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
                  ],
                },
              ],
      }),
    );
  };
  await mount();
  await open();
  await click('Templates');
  await waitSearch();
  await fill('Template to assign', role);
  await click('Next results');
  await waitSearch();
  const option = document.querySelector<HTMLOptionElement>(`option[value="${unsupported}"]`);
  assert.equal(option?.disabled, true);
  assert.match(option?.textContent ?? '', /Unavailable for assignment/);
  const reviewButton = [...document.querySelectorAll('button')].find(
    b => b.textContent?.trim() === 'Review template assignment',
  );
  assert.equal(reviewButton?.disabled, true);
  assert.equal(previews.length, 0);
  assert.equal(writes.length, 0);
});

test('permission exceptions preview shows one modal at a time and preserves draft on Back to edit', async () => {
  await mount();
  await open();
  await click('Permission exceptions');
  await settle();
  await settle();
  assert.equal(document.querySelectorAll('dialog').length, 1);
  await fill('Business reason (Mandatory for audit compliance)', 'Temporary audit verification');
  await fill('Expiry date (your local time)', '2099-12-31');
  await click('Review exception');
  await settle();
  assert.equal(document.querySelectorAll('dialog').length, 1);
  assert.match(document.querySelector('dialog')?.textContent ?? '', /Review person change/);
  await click('Back to edit');
  await settle();
  assert.equal(document.querySelectorAll('dialog').length, 1);
  assert.equal(
    document.querySelector<HTMLInputElement>('input[placeholder*="Special audit requirement"]')
      ?.value,
    'Temporary audit verification',
  );
  assert.equal(document.querySelector<HTMLInputElement>('input[type="date"]')?.value, '2099-12-31');
});

test('employee ID corrections and deactivation are shown in preview and cancel without saving', async () => {
  await mount();
  await open();
  await fill('Employee ID', '710992');
  await act(async () =>
    document.querySelector<HTMLInputElement>('.people-checkbox input')!.click(),
  );
  await click('Review profile changes');
  assert.equal(previews[0].body.employeeCode, '710992');
  assert.equal(previews[0].body.active, false);
  assert.deepEqual(previews[0].body.roleIds, [oldRole]);
  assert.deepEqual(previews[0].body.overrides, current.person.overrides);
  assert.match(document.querySelector('.form-dialog')!.textContent!, /710902.*710992/);
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Status.*Active.*Inactive/);
  await click('Back to edit');
  assert.equal(writes.length, 0);
  assert.equal(changed, 0);
});

test('inactive employees cannot receive built-in templates through the People & Access shortcuts', async () => {
  current.person.active = false;
  await mount({ canManageScoped: true });
  await open();
  await click('Templates');
  for (const label of ['Assign Business Analytics', 'Assign Admin']) {
    const button = [...document.querySelectorAll('button')].find(
      b => b.textContent?.trim() === label,
    );
    assert.equal(button?.disabled, true);
  }
  assert.equal(previews.length, 0);
  assert.equal(writes.length, 0);
});

test('effective access rejects another person’s response and retries the selected identity', async () => {
  let calls = 0;
  detailRead = url => {
    if (!url.pathname.endsWith('/effective/' + id)) return;
    calls++;
    return calls === 1
      ? Response.json({ actorId: other })
      : Response.json(
          { error: { message: 'Access explanations temporarily unavailable' } },
          { status: 503 },
        );
  };
  await mount();
  await open();
  assert.equal(calls, 0);
  await click('Effective access');
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Access identity mismatch/);
  await click('Retry', document.querySelector('[role="alert"]')!);
  assert.equal(calls, 2);
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /temporarily unavailable/);
  assert.equal(writes.length, 0);
});

test('selecting the same person after a denied detail read retries without showing stale access', async () => {
  denied = true;
  await mount();
  await open();
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Access no longer assigned/);
  const path = '/api/dev-access/people/' + id;
  assert.equal(requests.filter(request => request === path).length, 1);
  assert.equal(document.querySelector('.people-person-form'), null);
  denied = false;
  await click('Aditi Menon');
  assert.equal(requests.filter(request => request === path).length, 2);
  assert.ok(document.querySelector('.people-person-form'));
});

test('a profile preview without a receipt cannot enable saving or discard the draft', async () => {
  detailRead = url =>
    url.pathname.endsWith('/preview')
      ? Response.json({ receipt: '', warnings: ['Incomplete preview'] })
      : undefined;
  await mount();
  await open();
  await fill('Full name', 'Aditi R. Menon');
  await click('Review profile changes');
  assert.match(
    document.querySelector('[role="alert"]')!.textContent!,
    /preview could not be confirmed/,
  );
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(
    document.querySelector<HTMLInputElement>('.people-person-form input')!.value,
    'Aditi R. Menon',
  );
  assert.equal(writes.length, 0);
});

test('an unconfirmed write invalidates its receipt and reloads the selected person without resending', async () => {
  const submitted: unknown[] = [];
  detailRead = (url, options) => {
    if (url.pathname !== '/api/dev-access' || options?.method !== 'POST') return;
    submitted.push(JSON.parse(String(options.body)));
    return Response.json({ saved: false });
  };
  await mount();
  await open();
  await fill('Full name', 'Aditi R. Menon');
  await click('Review profile changes');
  await click('Confirm & save');
  assert.deepEqual(submitted, [{ ...previews[0].body, previewReceipt: 'reviewed-person' }]);
  assert.equal(changed, 0);
  assert.equal(document.querySelector('dialog'), null);
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Save was not confirmed/);
  await click('Reload person');
  assert.equal(
    document.querySelector<HTMLInputElement>('.people-person-form input')!.value,
    'Aditi Menon',
  );
  assert.equal(submitted.length, 1);
});

test('person history stays scoped to the selected identity and can recover from revocation', async () => {
  let revoked = true;
  let audits = 0;
  detailRead = url => {
    if (!url.pathname.endsWith('/audit')) return;
    audits++;
    assert.equal(url.searchParams.get('personId'), id);
    assert.equal(url.searchParams.get('details'), 'true');
    return revoked
      ? Response.json({}, { status: 403 })
      : Response.json({
          items: [
            {
              revision: 7,
              action: 'person.updated',
              at: '2026-11-08T09:00:00Z',
              actorId: manager,
              actorName: 'Neha Rao',
              targetId: id,
              targetName: 'Aditi Menon',
              before: { grade: 'G2' },
              after: { grade: 'G3' },
            },
          ],
          nextCursor: null,
          hasMore: false,
        });
  };
  const waitForAudit = async () => {
    await act(async () => new Promise(resolve => setTimeout(resolve, 15)));
    await settle();
  };
  await mount({ canViewAudit: true });
  await open();
  assert.equal(audits, 0);
  await click('History');
  await waitForAudit();
  assert.match(
    document.querySelector('[role="alert"]')!.textContent!,
    /Activity access is unavailable/,
  );
  assert.equal(document.querySelector('.audit-scroll'), null);
  revoked = false;
  await click('Retry activity');
  await waitForAudit();
  const history = document.querySelector('.audit-scroll')!;
  assert.match(history.textContent!, /Neha Rao.*Aditi Menon/s);
  assert.match(history.querySelector('pre')!.textContent!, /"before".*G2.*"after".*G3/s);
  assert.equal(audits, 2);
  assert.equal(writes.length, 0);
});
