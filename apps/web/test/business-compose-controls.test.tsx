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
  change,
} from './support/interactions';
import type { BusinessContext } from '../src/business/business-model';
const { BusinessWorkflows } = component<typeof import('../src/business/BusinessWorkflows')>(
  'business/BusinessWorkflows.tsx',
);
const root = '/api/business/workflow';
const context: BusinessContext = {
  actorId: 'aditi',
  revision: 12,
  asOf: '2026-11-08T10:00:00Z',
  canView: true,
  canExport: true,
  canManage: true,
  canAmend: true,
  canApprove: true,
  canDemandView: true,
  canDemandCreate: true,
  personalBaseline: true,
  scopes: [
    {
      id: 'portfolio-analytics',
      kind: 'PORTFOLIO',
      scopeId: 'healthcare',
      label: 'Healthcare delivery',
      effect: 'ALLOW',
      bundle: 'BUSINESS_ANALYTICS',
    },
    {
      id: 'blocked-client',
      kind: 'DEPARTMENT',
      scopeId: 'blocked',
      label: 'Restricted client',
      effect: 'DENY',
      bundle: 'BUSINESS_ANALYTICS',
    },
  ],
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let previewFailure = 0,
  writeFailure = 0,
  hideSkills = false,
  archivedMapping = false;
let masterReads: URLSearchParams[] = [];
let cataloguePages = false;
let masterFailure = 0;
let previews: any[] = [],
  saves: any[] = [];
beforeEach(async () => {
  previewFailure = 0;
  writeFailure = 0;
  hideSkills = false;
  archivedMapping = false;
  masterReads = [];
  cataloguePages = false;
  masterFailure = 0;
  previews = [];
  saves = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url.startsWith(root + '/masters?')) {
      const query = new URL(url, 'http://localhost').searchParams;
      masterReads.push(query);
      if (masterFailure)
        return Response.json(
          { error: { message: 'Catalogue access unavailable' } },
          { status: masterFailure },
        );
      const page = Number(query.get('page'));
      return Response.json({
        revision: 12,
        providers: [{ id: 'microsoft', name: 'Microsoft', active: true }],
        skills: hideSkills
          ? []
          : [
              { id: 'sql', name: 'SQL reporting', category: 'Data', active: true },
              { id: 'retired', name: 'Legacy reporting', category: 'Data', active: false },
            ],
        certifications:
          cataloguePages && query.get('search') === 'no match'
            ? []
            : [
                {
                  id: page === 2 ? 'azure-admin' : 'azure',
                  name: page === 2 ? 'Azure Administrator' : 'Azure Fundamentals',
                  provider: 'Microsoft',
                  providerId: 'microsoft',
                  category: 'Cloud',
                  active: true,
                  relatedSkillIds: archivedMapping ? ['retired'] : [],
                },
              ],
        page,
        pageSize: cataloguePages ? 1 : 25,
        skillTotal: 2,
        providerTotal: 1,
        certificationTotal: cataloguePages ? (query.get('search') === 'no match' ? 0 : 2) : 1,
      });
    }
    if (url.startsWith(root + '/demands?') || url.startsWith(root + '/amendments?'))
      return Response.json({
        revision: 12,
        rows: [],
        total: 0,
        page: 1,
        pageSize: 25,
        canApprove: true,
      });
    if (url === root + '/preview') {
      const command = JSON.parse(String(init?.body));
      previews.push(command);
      return previewFailure
        ? Response.json(
            { error: { message: 'Your current scope changed' } },
            { status: previewFailure },
          )
        : Response.json({
            receipt: 'reviewed-business-binding',
            command,
            details: command.payload,
          });
    }
    if (url === root && init?.method === 'POST') {
      saves.push(JSON.parse(String(init.body)));
      return writeFailure
        ? Response.json(
            { error: { message: 'Business record changed after preview' } },
            { status: writeFailure },
          )
        : Response.json({ id: 'saved-business-record' });
    }
    throw Error('Unexpected workflow request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
const dialog = () => document.querySelector('.form-dialog')!;
async function mount(
  viewName: 'demand' | 'amendments',
  extra: Partial<BusinessContext> = {},
  catalogueMode = false,
) {
  view = await render(
    <MemoryRouter>
      <BusinessWorkflows
        context={{ ...context, ...extra }}
        view={viewName}
        catalogueMode={catalogueMode}
      />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
async function checkLabel(text: string) {
  const element = [...dialog().querySelectorAll('label')]
    .find(l => l.textContent?.trim().startsWith(text))!
    .querySelector<HTMLInputElement>('input')!;
  await act(async () => element.click());
  await settle();
}

test('demand scope and requirement changes are previewed before an exact receipt-bound create', async () => {
  await mount('demand');
  await click('New demand');
  await fill('Name', 'Customer reporting release');
  await fill('Description', 'Support grouped reporting and cloud operations.');
  await fill('Demand scope', 'portfolio-analytics');
  const scopes = [...dialog().querySelectorAll('select')].find(s =>
    [...s.options].some(o => o.value === 'portfolio-analytics'),
  )!;
  assert.ok(![...scopes.options].some(o => o.value === 'blocked-client'));
  await checkLabel('SQL reporting');
  await change(dialog().querySelector('[aria-label="Minimum level for SQL reporting"]')!, '3');
  await checkLabel('Azure Fundamentals');
  await click('Review proposal');
  assert.equal(saves.length, 0);
  assert.equal(previews[0].operation, 'SAVE_DEMAND');
  assert.equal(previews[0].payload.scopeId, 'portfolio-analytics');
  assert.deepEqual(previews[0].payload.requirements, {
    skills: [{ id: 'sql', minRank: 3 }],
    certifications: ['azure'],
  });
  await click('Back');
  assert.equal(saves.length, 0);
  await click('Review proposal');
  await click('Create demand');
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0], { ...previews[1], previewReceipt: 'reviewed-business-binding' });
});

test('failed demand preview preserves the draft and a failed save refresh discards the old receipt', async () => {
  await mount('demand');
  await click('New demand');
  await fill('Name', 'Client reporting support');
  await fill('Demand scope', 'portfolio-analytics');
  await checkLabel('SQL reporting');
  previewFailure = 403;
  await click('Review proposal');
  assert.match(dialog().textContent!, /current scope changed/);
  assert.equal(saves.length, 0);
  previewFailure = 0;
  await click('Review proposal');
  writeFailure = 409;
  await click('Create demand');
  assert.match(dialog().textContent!, /record changed after preview/);
  assert.equal(saves.length, 1);
  await click('Refresh records', document);
  assert.equal(document.querySelector('[aria-label="Review & confirm"]'), null);
  assert.equal(saves.length, 1);
  assert.equal(
    (dialog().querySelector('input[required]') as HTMLInputElement).value,
    'Client reporting support',
  );
});

test('catalogue certification creates a new issuer only after explicit review and caches selected skill names', async () => {
  await mount('amendments');
  await click('New catalogue request');
  await click('Next: entry details');
  await fill('Name', 'Cloud delivery fundamentals');
  await fill('Category', 'Cloud');
  await fill('Provider', '__new__');
  await fill('New issuer name', 'Cloud Skills Institute');
  await fill('Description', 'Foundation credential for cloud delivery');
  await fill('Change note', 'Reviewed issuer details');
  await checkLabel('Suggest related skills');
  await checkLabel('SQL reporting');
  assert.match(dialog().textContent!, /Remove SQL reporting/);
  hideSkills = true;
  await fill('Find approved providers or related skills', 'different search');
  await click('Search');
  assert.match(dialog().textContent!, /Remove SQL reporting/);
  await click('Review changes');
  assert.equal(saves.length, 0);
  assert.equal(previews[0].operation, 'SAVE_MASTER');
  assert.equal(previews[0].payload.providerName, 'Cloud Skills Institute');
  assert.equal(previews[0].payload.providerId, undefined);
  assert.deepEqual(previews[0].payload.relatedSkillIds, ['sql']);
  await click('Save catalogue entry');
  assert.deepEqual(saves[0], { ...previews[0], previewReceipt: 'reviewed-business-binding' });
});

test('archived skill mappings block preview until explicitly removed', async () => {
  archivedMapping = true;
  await mount('amendments');
  await click('New catalogue request');
  await click('Update an existing entry');
  await fill('Existing certification', 'azure');
  await click('Next: entry details');
  await fill('Name', 'Reporting credential');
  await fill('Category', 'Data');
  await fill('Provider', 'microsoft');
  await click('Review changes');
  assert.equal(previews.length, 0);
  assert.match(dialog().textContent!, /Remove archived skill.*Legacy reporting/);
  await click('Remove Legacy reporting');
  await click('Review changes');
  assert.equal(previews.length, 1);
  assert.deepEqual(previews[0].payload.relatedSkillIds, []);
});

test('non-approver catalogue proposals retain a reason and never become direct catalogue saves', async () => {
  await mount('amendments', { canApprove: false });
  await click('New catalogue request');
  await click('Provider');
  await click('Next: entry details');
  await fill('Name', 'Cloud Skills Institute');
  await fill('Why is this change needed?', 'Issuer missing for our new delivery certification.');
  await click('Preview request');
  assert.equal(previews[0].operation, 'PROPOSE');
  assert.equal(previews[0].payload.type, 'PROVIDER');
  assert.equal(saves.length, 0);
  await click('Back');
  await click('Cancel');
  assert.equal(saves.length, 0);
});

test('certification catalogue paging and explicit search preserve the current query and clear failed reads', async () => {
  cataloguePages = true;
  await mount('amendments', {}, true);
  await click('Next', document.querySelector('.bo-pagination')!);
  assert.equal(masterReads.at(-1)!.get('page'), '2');
  assert.match(document.querySelector('tbody')!.textContent!, /Azure Administrator/);
  await click('Previous', document.querySelector('.bo-pagination')!);
  const search = document.querySelector<HTMLInputElement>(
    '[aria-label="Search catalogue certifications"]',
  )!;
  await change(search, 'no match');
  await act(async () =>
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  );
  await settle();
  assert.equal(masterReads.at(-1)!.get('search'), 'no match');
  assert.match(document.body.textContent!, /No matching certifications/);
  masterFailure = 403;
  await change(search, 'Azure');
  await click('Search', document.querySelector('.bo-record-filters')!);
  assert.match(document.body.textContent!, /Catalogue access unavailable/);
  assert.equal(document.querySelector('tbody'), null);
  masterFailure = 0;
  await click('Refresh records');
  assert.equal(masterReads.at(-1)!.get('search'), 'Azure');
  assert.match(document.querySelector('tbody')!.textContent!, /Azure Fundamentals/);
  assert.equal(saves.length, 0);
});

test('catalogue retirement reviews the selected entry and clears suggested skills only when explicitly disabled', async () => {
  archivedMapping = true;
  await mount('amendments', {}, true);
  await click('Edit certification');
  await checkLabel('No default skill suggestions');
  await checkLabel('Keep this entry available');
  await click('Review changes');
  assert.equal(previews.length, 1);
  assert.equal(previews[0].operation, 'SAVE_MASTER');
  assert.equal(previews[0].payload.targetId, 'azure');
  assert.equal(previews[0].payload.active, false);
  assert.deepEqual(previews[0].payload.relatedSkillIds, []);
  assert.equal(saves.length, 0);
  await click('Back');
  await click('Cancel');
  assert.equal(saves.length, 0);
});

test('demand definition search retains a selected skill across pages and can clear the search independently', async () => {
  cataloguePages = true;
  await mount('demand');
  await click('New demand');
  await checkLabel('SQL reporting');
  await click('Next results');
  assert.equal(masterReads.at(-1)!.get('page'), '2');
  await click('Previous results');
  const search = document.querySelector<HTMLInputElement>('#bo-definition-search')!;
  await change(search, 'SQL');
  await act(async () =>
    search.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    ),
  );
  await settle();
  assert.equal(masterReads.at(-1)!.get('search'), 'SQL');
  assert.match(dialog().textContent!, /1 skills and 0 credentials selected/);
  await click('Clear search');
  assert.equal(masterReads.at(-1)!.get('search'), '');
  assert.match(dialog().textContent!, /1 skills and 0 credentials selected/);
  await click('Cancel');
  assert.equal(previews.length, 0);
});
