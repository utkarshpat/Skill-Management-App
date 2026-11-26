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
    if (url === '/api/capability-leads/preview') {
      const change = JSON.parse(String(init?.body));
      previews.push(change);
      return Response.json({
        receipt: 'lead-receipt',
        change,
        before: null,
        after: change,
        impact: { actions: ['Review scoped submissions'] },
        warnings: [],
      });
    }
    if (url === '/api/capability-leads/save') {
      saves.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }
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
async function mount(employeeTemplate = false) {
  view = await render(
    <MemoryRouter>
      <BusinessAdministration
        featureTemplate={employeeTemplate ? 'EMPLOYEE' : undefined}
        onSaved={value => contexts.push(value)}
      />
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
const review = () => document.querySelector('[aria-label="Preview configuration change"]')!;

test('Business Analytics uses the existing assignment flow with one receipt for selected issuers', async () => {
  state.capabilityLead = {
    revision: 18,
    issuers: [
      { id: 'oracle', name: 'Oracle' },
      { id: 'microsoft', name: 'Microsoft' },
    ],
    assignments: [],
  };
  await mount();
  await fill('Person', 'aditi');
  assert.doesNotMatch(document.body.textContent ?? '', /Capability Lead/);
  const coverage = document.querySelector<HTMLSelectElement>('fieldset.bo-full select')!;
  assert.equal(coverage.value, 'all');
  await fill('Issuer coverage', 'selected');
  await fill('Scope', 'DELIVERY_UNIT');
  await fill('Scope binding', 'du');
  await toggleLabel('Oracle');
  await toggleLabel('Microsoft');
  await fill('Reason', 'Approvals for the assigned credential issuers.');
  await click('Preview change');
  assert.equal(saves.length, 0);
  assert.equal(previews[0].scopeId, 'du');
  assert.equal(previews[0].allIssuers, false);
  assert.deepEqual(previews[0].issuerIds, ['oracle', 'microsoft']);
  assert.match(review().textContent ?? '', /Business Analytics.*DU UK.*Oracle, Microsoft/);
  await click('Confirm & save', review());
  assert.deepEqual(saves[0], { ...previews[0], receipt: 'lead-receipt' });
});

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

test('existing All issuers coverage can be edited on the same Business Analytics assignment', async () => {
  state.issuers = [{ id: 'oracle', name: 'Oracle' }];
  state.responsibilities = [
    {
      id: 'existing-grant',
      personId: 'aditi',
      bundle: 'BUSINESS_OPERATIONS',
      kind: 'DEPARTMENT',
      scopeId: 'client',
      effect: 'ALLOW',
      active: true,
      validUntil: null,
    },
  ];
  await mount();
  await click('Allowed');
  await fill('Issuer coverage', 'selected');
  await toggleLabel('Oracle');
  await fill('Expires', '2026-12-01T09:00');
  await fill('Expires', '');
  await fill('Reason', 'Limit this assignment to Oracle');
  await click('Preview change');
  assert.equal(previews[0].id, 'existing-grant');
  assert.equal(previews[0].payload.scopeId, 'client');
  assert.equal(previews[0].payload.validUntil, null);
  assert.deepEqual(previews[0].payload.issuerIds, ['oracle']);
  assert.equal(saves.length, 0);
  await click('Confirm & save', review());
  assert.equal(saves[0].id, 'existing-grant');
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
  await mount(true);
  await toggleLabel('Enable default employee access');
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

test('employee modules use separate switches and save only after an explicit preview', async () => {
  state.templateFeatures = [];
  await mount(true);
  await click('Modules');
  await toggleLabel('Learn & Grow');
  await fill('Reason', 'Enable personal learning for active employees.');
  await click('Preview change');
  assert.equal(previews[0].kind, 'TEMPLATE_FEATURES');
  assert.deepEqual(previews[0].payload, {
    template: 'EMPLOYEE',
    learning: true,
    requests: false,
    reason: 'Enable personal learning for active employees.',
  });
  assert.equal(saves.length, 0);
  await click('Confirm & save', review());
  assert.equal(saves[0].previewReceipt, 'current-business-receipt');
});

test('employee permissions support add and remove while keeping own profile required', async () => {
  state.employeePermissions = ['profile.view', 'skill.view'];
  state.employeePermissionOptions = [
    { code: 'profile.view', label: 'View own profile', required: true },
    { code: 'skill.view', label: 'View published skills', required: false },
    { code: 'request.create', label: 'Create requests', required: false },
  ];
  await mount(true);
  const required = [...document.querySelectorAll('button')].find(
    button => button.textContent === 'Required',
  );
  assert.equal(required?.disabled, true);
  await click('Remove View published skills');
  await click('Add Create requests');
  await fill('Reason', 'Update default employee grants.');
  await click('Preview change');
  assert.deepEqual(previews[0].payload.employeePermissions, ['profile.view', 'request.create']);
  assert.equal(saves.length, 0);
  await click('Confirm & save', review());
  assert.equal(saves[0].previewReceipt, 'current-business-receipt');
});

test('first Employee module save starts from the current workspace-wide defaults', async () => {
  state.templateFeatures = [];
  state.templateFeatureFallbackActive = true;
  await mount(true);
  await click('Modules');
  assert.match(document.body.textContent!, /first save switches to template settings/);
  await fill('Reason', 'Preserve current availability.');
  await click('Preview change');
  assert.equal(previews[0].payload.learning, true);
  assert.equal(previews[0].payload.requests, true);
});

test('retrying a module change keeps another administrator’s update to the other switch', async () => {
  state.templateFeatures = [];
  await mount(true);
  await click('Modules');
  await toggleLabel('Learn & Grow');
  await fill('Reason', 'Enable learning for active employees.');
  await click('Preview change');
  assert.equal(previews[0].payload.requests, false);

  state.revision++;
  state.templateFeatures = [{ template: 'EMPLOYEE', learning: false, requests: true }];
  writeFailure = 409;
  await click('Confirm & save', review());
  await click('Preview change');
  assert.equal(previews[1].revision, state.revision);
  assert.equal(previews[1].payload.learning, true);
  assert.equal(previews[1].payload.requests, true);
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
  await click('Close Preview configuration change', review());
  assert.equal(document.querySelector('.form-dialog'), null);
  assert.equal(saves.length, 0);
  assert.equal(state.projects[0].active, true);
});
