import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
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
const { BusinessOperations } = component<typeof import('../src/business/BusinessOperations')>(
  'business/BusinessOperations.tsx',
);
const skill = '11111111-1111-4111-8111-000000000001',
  scope = '99999999-9999-4999-8999-000000000001';
const context = {
  hierarchy: [
    {
      id: '90000000-0000-4000-8000-000000000001',
      kind: 'DELIVERY_UNIT',
      name: 'India Delivery',
      parentId: null,
    },
    {
      id: '90000000-0000-4000-8000-000000000002',
      kind: 'PORTFOLIO',
      name: 'Financial Services',
      parentId: '90000000-0000-4000-8000-000000000001',
    },
    {
      id: '90000000-0000-4000-8000-000000000003',
      kind: 'DEPARTMENT',
      name: 'Northstar Bank',
      parentId: '90000000-0000-4000-8000-000000000002',
    },
  ],
  actorId: 'aditi',
  revision: 4,
  asOf: '2026-11-05T03:30:00Z',
  canView: true,
  canExport: true,
  canManage: false,
  canAmend: false,
  canMatch: true,
  personalBaseline: true,
  scopes: [
    {
      id: scope,
      kind: 'PROJECT',
      scopeId: scope,
      label: 'Customer Insights Modernisation',
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
  ],
};
const data = {
  context,
  summary: { employees: 2, skilled: 2, certified: 1, pending: 1, expired: 1, expiring: 0 },
  coverage: [
    { id: skill, label: 'SQL', category: 'Databases', holders: 1, rank: 3 },
    { id: skill, label: 'SQL', category: 'Databases', holders: 1, rank: 2 },
  ],
  coverageComplete: true,
  credentialCoverage: [
    {
      id: skill,
      name: 'Oracle SQL',
      issuer: 'Oracle',
      category: 'Databases',
      reviewedHolders: 1,
      currentHolders: 1,
      expiredHolders: 0,
    },
  ],
  uncataloguedCredentials: [
    {
      name: 'Power BI',
      issuer: 'Microsoft',
      reviewedHolders: 1,
      currentHolders: 0,
      expiredHolders: 1,
    },
  ],
  categories: [{ label: 'Databases', value: 2 }],
  comparisons: [
    {
      id: scope,
      label: 'Customer Insights Modernisation',
      kind: 'PROJECT',
      employees: 2,
      skilled: 2,
      certified: 1,
    },
  ],
  distribution: [{ label: 'Oracle', value: 1 }],
  expiry: [{ label: 'Expired', value: 1 }],
  activity: [{ label: '2026-11', submissions: 2, decisions: 1 }],
  rows: [
    {
      id: 'aditi',
      employee: 'Aditi Menon',
      employeeCode: 'EMP-1042',
      project: 'Customer Insights Modernisation',
      reviewedSkills: 1,
      currentCertifications: 1,
      primaryCapability: 'SQL',
      department: 'Analytics',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
};

const nativeFormData = globalThis.FormData;
let view: Awaited<ReturnType<typeof render>> | undefined;
let queries: URLSearchParams[] = [],
  exports: URLSearchParams[] = [],
  downloads: string[] = [],
  blobs: Blob[] = [];
let dashboardFailure = 0,
  exportFailure = 0,
  denied = false,
  noExport = false,
  total = 1;
let pendingExport: ReturnType<typeof deferred<Response>> | undefined;
let exportSignal: AbortSignal | null | undefined;
beforeEach(async () => {
  globalThis.FormData = window.FormData as typeof FormData;
  queries = [];
  exports = [];
  downloads = [];
  blobs = [];
  dashboardFailure = exportFailure = 0;
  denied = noExport = false;
  total = 1;
  pendingExport = undefined;
  exportSignal = undefined;
  mock.method(URL, 'createObjectURL', (blob: Blob) => {
    blobs.push(blob);
    return 'blob:authorized-report';
  });
  mock.method(URL, 'revokeObjectURL', () => {});
  mock.method(window.HTMLAnchorElement.prototype, 'click', function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url === '/api/business/context')
      return Response.json({ ...context, canView: !denied, canExport: !noExport });
    const q = new URL(url, 'http://localhost').searchParams;
    if (url.startsWith('/api/business/export?') || url.startsWith('/api/business/report?')) {
      exports.push(q);
      exportSignal = init?.signal;
      if (pendingExport) return pendingExport.promise;
      if (exportFailure)
        return Response.json(
          { error: { message: 'Current export access denied' } },
          { status: exportFailure },
        );
      if (url.startsWith('/api/business/report?'))
        return Response.json({ ...data, context: { ...context, canExport: !noExport } });
      return new Response('Employee,Skill\nAditi Menon,SQL', {
        headers: { 'content-type': 'text/csv' },
      });
    }
    if (url.startsWith('/api/business/dashboard?')) {
      queries.push(q);
      if (dashboardFailure)
        return Response.json(
          { error: { message: 'Current analytics access denied' } },
          { status: dashboardFailure },
        );
      const people = q.get('dataset') === 'people';
      return Response.json({
        ...data,
        context: { ...context, canExport: !noExport },
        total,
        page: Number(q.get('page') ?? 1),
        rows: people
          ? data.rows
          : [
              {
                id: 'sql-record',
                name: 'SQL',
                employee: 'Aditi Menon',
                status: 'APPROVED',
                rank: 3,
                updatedAt: '2026-11-08T10:00:00Z',
                validity: 'CURRENT',
                canViewFiles: false,
              },
            ],
      });
    }
    throw Error('Unexpected analytics request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
  globalThis.FormData = nativeFormData;
});
after(closeBrowser);
async function mount(query = '') {
  view = await render(
    <MemoryRouter initialEntries={['/business' + query]}>
      <BusinessOperations />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
const current = () => queries.at(-1)!;
async function named(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${name}"]`,
  );
  assert.ok(field, name);
  await change(field, value);
  await settle();
}

test('analytics filters preserve explicit scope and hierarchy while resetting pages and datasets', async () => {
  await mount('?dataset=people&page=3');
  await named('Scope filter', scope);
  assert.equal(current().get('scopeId'), scope);
  assert.equal(current().has('page'), false);
  await named('Organization hierarchy filter', context.hierarchy[1].id);
  await fill('Associated skill', skill);
  assert.equal(current().get('skillId'), skill);
  assert.equal(current().get('hierarchyId'), context.hierarchy[1].id);
  await fill('Proficiency level', '3_3');
  assert.equal(current().get('minRank'), '3');
  assert.equal(current().get('maxRank'), '3');
  await fill('Proficiency level', '');
  assert.equal(current().has('minRank'), false);
  await fill('Credential category', 'Databases');
  await fill('Issuer / Provider', 'Oracle');
  await fill('Record review status', 'APPROVED');
  await fill('Validity window', 'CURRENT');
  assert.equal(current().get('category'), 'Databases');
  assert.equal(current().get('issuer'), 'Oracle');
  assert.equal(current().get('validity'), 'CURRENT');
  await fill('Dataset', 'certifications');
  assert.equal(current().get('dataset'), 'certifications');
  for (const k of ['category', 'issuer', 'skillId', 'minRank', 'status', 'validity'])
    assert.equal(current().has(k), false, k);
  await fill('Sort', 'expiry_asc');
  await fill('Review status', 'CHANGES_REQUESTED');
  await fill('Validity', 'NO_EXPIRY', document.querySelector('.bo-record-filters')!);
  assert.equal(current().get('sort'), 'expiry_asc');
  assert.equal(current().get('status'), 'CHANGES_REQUESTED');
  assert.equal(current().get('validity'), 'NO_EXPIRY');
  await click('Clear all');
  assert.equal(current().toString(), 'dataset=people');
});

test('analytics search submits explicitly, date presets narrow activity and chips clear exact filters', async () => {
  await mount();
  await change(
    document.querySelector<HTMLInputElement>('[placeholder="Search employee or code…"]')!,
    'Aditi',
  );
  assert.equal(current().has('search'), false);
  await act(async () =>
    document
      .querySelector('form.bo-toolbar-search-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  assert.equal(current().get('search'), 'Aditi');
  await click('Clear search');
  assert.equal(current().has('search'), false);
  for (const preset of ['Last 30d', 'Last 90d', 'YTD']) {
    await click(preset);
    assert.match(current().get('from')!, /^\d{4}-\d{2}-\d{2}$/);
  }
  await click('All time');
  assert.equal(current().has('from'), false);
  await named('Activity from date', '2026-10-01');
  await named('Activity to date', '2026-11-08');
  assert.equal(current().get('from'), '2026-10-01');
  assert.equal(current().get('to'), '2026-11-08');
  await click('Reset filters');
  assert.equal(current().has('from'), false);
  assert.equal(current().has('to'), false);
  const details = document.querySelector<HTMLDetailsElement>('.bo-toolbar-dropdown')!;
  details.open = true;
  await act(async () =>
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  assert.equal(details.open, false);
  details.open = true;
  await act(async () =>
    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })),
  );
  assert.equal(details.open, false);
});

test('analytics exports reread current authorized filters and denied export never downloads stale content', async () => {
  await mount(
    '?dataset=skills&scopeId=' +
      scope +
      '&hierarchyId=' +
      context.hierarchy[1].id +
      '&search=Aditi',
  );
  for (const label of ['CSV', 'Excel', 'Interactive HTML'])
    await click(label, document.querySelector('.bo-record-filters')!.parentElement!);
  assert.deepEqual(downloads, [
    'business-skills.csv',
    'business-skills.xlsx',
    'business-skills.html',
  ]);
  for (const q of exports) {
    assert.equal(q.get('scopeId'), scope);
    assert.equal(q.get('hierarchyId'), context.hierarchy[1].id);
    assert.equal(q.get('search'), 'Aditi');
  }
  assert.equal(blobs[2].type, 'text/html;charset=utf-8');
  assert.match(await blobs[2].text(), /SQL/);
  exportFailure = 403;
  await click('CSV', document.querySelector('.bo-record-filters')!.parentElement!);
  assert.equal(downloads.length, 3);
  assert.match(document.body.textContent!, /Current export access denied/);
});

test('analytics revocation clears rows, retry recovers, and denied discovery never requests a dashboard', async () => {
  await mount('?dataset=people');
  assert.match(
    document.querySelector('.bo-record-filters')!.parentElement!.textContent!,
    /Aditi Menon/,
  );
  dashboardFailure = 403;
  await named('Scope filter', scope);
  assert.match(document.body.textContent!, /Current analytics access denied/);
  assert.equal(document.querySelector('.bo-record-filters'), null);
  dashboardFailure = 0;
  await click('Retry query');
  assert.match(
    document.querySelector('.bo-record-filters')!.parentElement!.textContent!,
    /Aditi Menon/,
  );
  await view!.unmount();
  view = undefined;
  queries = [];
  denied = true;
  await mount();
  assert.match(document.body.textContent!, /access is not assigned/);
  assert.equal(queries.length, 0);
});

test('analytics drill-through, pagination and assistant handoff preserve narrowing context without writes', async () => {
  total = 26;
  await mount('?scopeId=' + scope + '&hierarchyId=' + context.hierarchy[1].id);
  const prompts: any[] = [];
  const listener = (event: Event) => prompts.push((event as CustomEvent).detail);
  window.addEventListener('assistant-context-request', listener);
  try {
    await click('Find people');
    await click('Ask AI about analytics');
    assert.equal(prompts[0].autoSend, true);
    assert.match(prompts[0].prompt, /Customer Insights Modernisation/);
    assert.match(prompts[0].prompt, /Financial Services/);
    assert.match(prompts[1].prompt, /authorized analytics/);
    await click('Skill coverage', document.querySelector('[aria-label="Analytics views"]')!);
    await click('SQL, level 3: 1 reviewed holders; drill-through level 3');
    assert.equal(current().get('dataset'), 'skills');
    assert.equal(current().get('minRank'), '3');
    assert.equal(current().get('maxRank'), '3');
    await click('Next');
    assert.equal(current().get('page'), '2');
    await click('Previous');
    assert.equal(current().get('page'), '1');
    await click(
      'Certificates & renewals',
      document.querySelector('[aria-label="Analytics views"]')!,
    );
    await click('CSV', document.querySelector('.bo-credential-headcount')!);
    assert.equal(exports.at(-1)!.get('reportKind'), 'credential-headcount');
  } finally {
    window.removeEventListener('assistant-context-request', listener);
  }
});

test('filter changes abort in-flight exports and cannot publish the previous authorization snapshot', async () => {
  await mount('?dataset=people');
  pendingExport = deferred<Response>();
  await click('CSV', document.querySelector('.bo-record-filters')!.parentElement!);
  assert.equal(exportSignal?.aborted, false);
  await named('Scope filter', scope);
  assert.equal(exportSignal?.aborted, true);
  await act(async () => pendingExport!.resolve(new Response('previous snapshot')));
  await settle();
  assert.equal(downloads.length, 0);
});

test('analytics chart filters and KPI shortcuts produce exact record queries without inheriting old rank filters', async () => {
  await mount('?view=certifications&scopeId=' + scope);
  await click('Oracle: 1, filter records');
  assert.equal(current().get('dataset'), 'certifications');
  assert.equal(current().get('issuer'), 'Oracle');
  assert.equal(current().get('status'), 'APPROVED');
  await click('Certificates & renewals', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Databases: 2, filter records');
  assert.equal(current().get('category'), 'Databases');
  assert.equal(current().has('minRank'), false);
  await click('Certificates & renewals', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Expired: 1, filter records');
  assert.equal(current().get('validity'), 'EXPIRED');
  assert.equal(current().has('status'), false);
  for (const [label, dataset, status] of [
    ['Authorized employees', 'people', null],
    ['Currently certified', 'certifications', 'APPROVED'],
    ['Reviewed skill holders', 'skills', 'APPROVED'],
    ['Pending records', 'submissions', 'SUBMITTED'],
  ] as const) {
    await click(label);
    assert.equal(current().get('dataset'), dataset);
    assert.equal(current().get('status'), status);
    assert.equal(current().has('category'), false);
    assert.equal(current().has('minRank'), false);
  }
  await click('Certificates & renewals', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Expiring in 30 days');
  assert.equal(current().get('validity'), '30');
  await click('Certificates & renewals', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Expired credentials');
  assert.equal(current().get('validity'), 'EXPIRED');
  await fill('Proficiency level', '2_2');
  const chip = document.querySelector<HTMLButtonElement>('[title="Remove maxRank filter"]')!;
  assert.ok(chip);
  await act(async () => chip.click());
  await settle();
  assert.equal(current().has('minRank'), false);
  assert.equal(current().has('maxRank'), false);
  await click('Skill coverage', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Excel', document.querySelector('.bo-heatmap')!.parentElement!);
  assert.equal(exports.at(-1)!.get('reportKind'), 'skill-coverage');
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[title="Reset all filters to default"]')!.click(),
  );
  await settle();
  assert.equal(current().toString(), 'dataset=people');
});

test('analytics exposes no export action beyond server capability even when an export URL is known', async () => {
  noExport = true;
  await mount('?dataset=people');
  assert.equal(
    [...document.querySelectorAll('button')].some(b => b.textContent?.includes('Executive Report')),
    false,
  );
  const button = [...document.querySelectorAll<HTMLButtonElement>('.bo-export button')].find(
    b => b.textContent?.trim() === 'CSV',
  )!;
  assert.equal(button.disabled, true);
  await act(async () => button.click());
  assert.equal(exports.length, 0);
  assert.equal(downloads.length, 0);
});

test('overview cards, issuer donut and renewal windows drill into matching records with prior filters cleared', async () => {
  await mount('?view=community&issuer=Oracle&category=Databases');
  await click('SQL', document.querySelector('.an-skill-bars')!);
  assert.equal(current().get('skillId'), skill);
  assert.equal(current().get('dataset'), 'skills');
  assert.equal(current().has('issuer'), false);
  assert.equal(current().has('category'), false);
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  await click('SQL, level 2: 1 reviewed holders');
  assert.equal(current().get('minRank'), '2');
  assert.equal(current().get('maxRank'), '2');
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Oracle: 1 records; view records');
  assert.equal(current().get('issuer'), 'Oracle');
  assert.equal(current().get('status'), 'APPROVED');
  assert.equal(current().has('minRank'), false);
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Expired', document.querySelector('.an-renewal-list')!);
  assert.equal(current().get('validity'), 'EXPIRED');
  assert.equal(current().has('issuer'), false);
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Expiring in 30 days', document.querySelector('.an-renewal-stats')!);
  assert.equal(current().get('validity'), '30');
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  await click('Expired credentials', document.querySelector('.an-renewal-stats')!);
  assert.equal(current().get('validity'), 'EXPIRED');
});

test('overview view-all controls and exports preserve the current dataset and export capability', async () => {
  await mount('?view=community');
  await click('View all', document.querySelector('.an-skill-panel')!);
  assert.ok(document.querySelector('.bo-heatmap'));
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  await click('View all', document.querySelector('.an-certificate-panel')!);
  assert.ok(document.querySelector('.bo-credential-headcount'));
  await click('Overview', document.querySelector('[aria-label="Analytics views"]')!);
  for (const label of ['Interactive HTML', 'CSV', 'Excel'])
    await click(label, document.querySelector('.an-record-toolbar')!);
  assert.deepEqual(downloads, [
    'business-people.html',
    'business-people.csv',
    'business-people.xlsx',
  ]);
  await click('View all', document.querySelector('.an-record-panel')!);
  assert.ok(document.querySelector('.bo-record-filters'));
});
