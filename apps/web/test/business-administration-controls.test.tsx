import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
} from './support/interactions';
const { BusinessAdministration } = component<
  typeof import('../src/business/BusinessAdministration')
>('business/BusinessAdministration.tsx');
const original = {
  revision: 18,
  personalBaseline: true,
  baselineAffectedPeople: 20,
  projects: [
    {
      id: 'reporting-project',
      name: 'NHS reporting delivery',
      departmentId: 'client',
      active: true,
    },
  ],
  memberships: [],
  responsibilities: [],
  people: [
    {
      id: 'aditi',
      name: 'Aditi Menon',
      employeeCode: '710902',
      active: true,
      employeeAccess: true,
      hasDirectReports: false,
    },
  ],
  nodes: [
    {
      id: 'du',
      name: 'DU UK',
      kind: 'DELIVERY_UNIT',
      parentId: null,
      active: true,
      scopeValid: true,
    },
    {
      id: 'portfolio',
      name: 'Healthcare Delivery',
      kind: 'PORTFOLIO',
      parentId: 'du',
      active: true,
      scopeValid: true,
    },
    {
      id: 'client',
      name: 'NHS SBS IT',
      kind: 'DEPARTMENT',
      parentId: 'portfolio',
      active: true,
      scopeValid: true,
    },
  ],
  historicalGrantsForReview: [],
};
let view: Awaited<ReturnType<typeof render>> | undefined,
  state: any,
  writeFailure = 0;
let previews: any[] = [],
  saves: any[] = [],
  contexts: any[] = [];
beforeEach(async () => {
  state = structuredClone(original);
  writeFailure = 0;
  previews = [];
  saves = [];
  contexts = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url === '/api/business/administration/preview') {
      const change = JSON.parse(String(init?.body));
      previews.push(change);
      return Response.json({
        receipt: 'current-business-receipt',
        change,
        before: { active: false },
        after: change.payload,
        impact: { affectedPeople: 1 },
        warnings: ['Existing matching denies still apply.'],
      });
    }
    if (url === '/api/business/administration' && init?.method === 'POST') {
      saves.push(JSON.parse(String(init.body)));
      return writeFailure
        ? Response.json(
            { error: { message: 'Business assignment save unconfirmed' } },
            { status: writeFailure },
          )
        : Response.json({ ok: true });
    }
    if (url.startsWith('/api/business/administration')) return Response.json(state);
    if (url === '/api/business/context')
      return Response.json({
        revision: 19,
        asOf: '2026-11-08T10:00:00Z',
        canManage: true,
        canView: true,
        canExport: true,
        canAmend: false,
        personalBaseline: true,
        scopes: [],
      });
    throw Error('Unexpected business administration request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount() {
  view = await render(
    <MemoryRouter>
      <BusinessAdministration onSaved={value => contexts.push(value)} />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
async function toggleLabel(text: string) {
  const control = [...document.querySelectorAll('label')]
    .find(l => l.textContent?.trim().startsWith(text))!
    .querySelector<HTMLInputElement>('input')!;
  await act(async () => control.click());
  await settle();
}
const review = () => document.querySelector('[aria-label="Review configuration change"]')!;

test('portfolio analytics DENY previews its exact binding and expiry before receipt confirmation', async () => {
  await mount();
  await fill('Person', 'aditi');
  await fill('Responsibility', 'BUSINESS_OPERATIONS');
  await fill('Scope', 'PORTFOLIO');
  await fill('Scope binding', 'portfolio');
  await fill('Effect', 'DENY');
  await fill('Expires', '2026-12-01T09:00');
  await fill('Reason', 'Limit analytics during client access reconciliation.');
  await click('Preview change');
  assert.equal(saves.length, 0);
  assert.equal(previews[0].kind, 'RESPONSIBILITY');
  assert.equal(previews[0].payload.bundle, 'BUSINESS_OPERATIONS');
  assert.equal(previews[0].payload.kind, 'PORTFOLIO');
  assert.equal(previews[0].payload.scopeId, 'portfolio');
  assert.equal(previews[0].payload.effect, 'DENY');
  assert.ok(previews[0].payload.validUntil.endsWith('Z'));
  await click('Back', review());
  assert.equal(saves.length, 0);
  await click('Preview change');
  await click('Confirm & save', review());
  assert.deepEqual(saves[0], { ...previews[1], previewReceipt: 'current-business-receipt' });
  assert.equal(contexts.length, 1);
});

test('switching to Admin makes the scope organization-bound instead of retaining a portfolio', async () => {
  await mount();
  await fill('Person', 'aditi');
  await fill('Scope', 'PORTFOLIO');
  await fill('Scope binding', 'portfolio');
  await fill('Responsibility', 'SYSTEM_ADMIN');
  const scope = [...document.querySelectorAll('label')]
    .find(l => l.textContent?.trim().startsWith('Scope'))!
    .querySelector('select')!;
  assert.equal(scope.disabled, true);
  assert.equal(scope.value, 'ORGANIZATION');
  await fill('Reason', 'Approved administration responsibility.');
  await click('Preview change');
  assert.equal(previews[0].payload.scopeId, null);
  assert.equal(previews[0].payload.kind, 'ORGANIZATION');
  assert.equal(previews[0].payload.bundle, 'SYSTEM_ADMIN');
  await click('Back', review());
  assert.equal(saves.length, 0);
});

test('business project and membership changes stay independent from responsibilities', async () => {
  await mount();
  await click('Projects');
  await fill('Name', 'NHS reporting release');
  await fill('Project account/client', 'client');
  await fill('Reason', 'Track reporting release staffing independently.');
  await click('Preview change');
  assert.equal(previews[0].kind, 'PROJECT');
  assert.equal(previews[0].payload.departmentId, 'client');
  assert.equal(previews[0].payload.bundle, undefined);
  await click('Back', review());
  await click('Memberships');
  await fill('Person', 'aditi');
  await fill('Project', 'reporting-project');
  await fill('Reason', 'Assign to the reporting delivery project.');
  await click('Preview change');
  assert.deepEqual(previews[1].payload, {
    personId: 'aditi',
    projectId: 'reporting-project',
    active: true,
    reason: 'Assign to the reporting delivery project.',
  });
  assert.equal(previews[1].kind, 'MEMBERSHIP');
  assert.equal(saves.length, 0);
});

test('unconfirmed responsibility saves retain the same assignment ID for explicit re-preview', async () => {
  await mount();
  await fill('Person', 'aditi');
  await fill('Scope', 'PORTFOLIO');
  await fill('Scope binding', 'portfolio');
  await fill('Reason', 'Approved healthcare delivery analytics.');
  await click('Preview change');
  writeFailure = 503;
  await click('Confirm & save', review());
  assert.match(document.body.textContent!, /Business assignment save unconfirmed/);
  assert.equal(document.querySelector('.form-dialog'), null);
  assert.equal(contexts.length, 0);
  writeFailure = 0;
  await click('Preview change');
  assert.equal(previews[0].id, previews[1].id);
  assert.deepEqual(previews[0].payload, previews[1].payload);
  await click('Confirm & save', review());
  assert.equal(contexts.length, 1);
});

test('employee baseline change is explicit and does not remove stored historical grants', async () => {
  state.historicalGrantsForReview = [{ id: 'historic-grant', personId: 'aditi' }];
  await mount();
  await click('Employee baseline');
  await toggleLabel('Employee baseline');
  await fill('Reason', 'Review employee baseline activation.');
  await click('Preview change');
  assert.equal(previews[0].kind, 'PERSONAL_BASELINE');
  assert.deepEqual(previews[0].payload, {
    enabled: false,
    reason: 'Review employee baseline activation.',
  });
  assert.equal(saves.length, 0);
  assert.equal(state.historicalGrantsForReview.length, 1);
});

test('existing project deactivation previews its stable identity and leaves membership untouched on close', async () => {
  await mount();
  await click('Projects');
  await fill('Project', 'reporting-project');
  await toggleLabel('Active');
  await fill('Reason', 'Reporting delivery completed.');
  await click('Preview change');
  assert.equal(previews[0].id, 'reporting-project');
  assert.deepEqual(previews[0].payload, {
    name: 'NHS reporting delivery',
    departmentId: 'client',
    active: false,
    reason: 'Reporting delivery completed.',
  });
  await click('Close Review configuration change', review());
  assert.equal(document.querySelector('.form-dialog'), null);
  assert.equal(saves.length, 0);
  assert.equal(state.projects[0].active, true);
});
