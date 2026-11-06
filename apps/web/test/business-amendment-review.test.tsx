import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, demoResponse, render, settle } from './support/browser';
import {
  click,
  component,
  fill,
  MemoryRouter,
  refreshDevelopmentLogin,
} from './support/interactions';
import type { BusinessContext } from '../src/business/business-model';

const { BusinessWorkflows } = component<typeof import('../src/business/BusinessWorkflows')>(
  'business/BusinessWorkflows.tsx',
);
const root = '/api/business/workflow';
const context: BusinessContext = {
  actorId: '88888888-8888-4888-8888-000000000003',
  revision: 9,
  asOf: '2026-11-06T08:00:00Z',
  canView: false,
  canExport: false,
  canManage: false,
  canApprove: true,
  canAmend: true,
  personalBaseline: true,
  scopes: [],
};
const amendment = {
  id: '88888888-8888-4888-8888-000000000004',
  type: 'PROVIDER',
  employee: 'Meera Joshi',
  definition: { name: 'Cloud Skills Institute', type: 'PROVIDER', active: true },
  currentDefinition: { name: 'Cloud Skills Academy', type: 'PROVIDER', active: true },
  reason: 'Correct issuer name on the catalogue.',
  status: 'SUBMITTED',
  revision: 6,
  decisionNote: null,
};
const note = 'The issuer name must match the updated source record.';
const dialog = () => document.querySelector('.form-dialog')!;
async function previewDecision() {
  await fill('Decision note', note, dialog());
  await click('Preview decision');
}

after(closeBrowser);
for (const targetChanged of [false, true]) {
  test(`catalogue decisions use a reviewed receipt and enforce target drift (changed=${targetChanged})`, async t => {
    const previews: { operation: string; payload: object }[] = [];
    const saves: object[] = [];
    let listReads = 0;
    let rejected = false;
    t.mock.method(
      globalThis,
      'fetch',
      async (input: string | URL | Request, options?: RequestInit) => {
        const path = String(input);
        if (path === '/api/dev-login') return demoResponse();
        if (path.startsWith(root + '/masters?'))
          return Response.json({
            revision: 9,
            providers: [],
            skills: [],
            certifications: [],
            page: 1,
            pageSize: 25,
            providerTotal: 0,
            skillTotal: 0,
            certificationTotal: 0,
          });
        if (path.startsWith(root + '/amendments?')) {
          listReads++;
          return Response.json({
            revision: 9,
            page: 1,
            pageSize: 25,
            total: 1,
            canApprove: true,
            rows: [{ ...amendment, status: rejected ? 'REJECTED' : 'SUBMITTED' }],
          });
        }
        if (path === root + '/amendment?id=' + amendment.id)
          return Response.json({ ...amendment, targetChanged });
        if (path === root + '/preview') {
          const command = JSON.parse(String(options?.body));
          previews.push(command);
          return Response.json({
            revision: 9,
            command,
            receipt: 'reviewed-decision',
            details: amendment,
          });
        }
        if (path === root && options?.method === 'POST') {
          saves.push(JSON.parse(String(options.body)));
          if (!targetChanged)
            return Response.json(
              { error: { message: 'Catalogue changed after preview.' } },
              { status: 409 },
            );
          rejected = true;
          return Response.json({ id: amendment.id });
        }
        throw Error('Unexpected workflow request ' + path);
      },
    );
    await refreshDevelopmentLogin();
    const mounted = await render(
      <MemoryRouter>
        <BusinessWorkflows context={context} view="amendments" />
      </MemoryRouter>,
    );
    try {
      await settle();
      await click('Review & approve');
      await settle();
      const previewButton = [...dialog().querySelectorAll('button')].find(b =>
        b.textContent?.includes('Preview decision'),
      );
      assert.equal(previewButton?.disabled, targetChanged);
      if (targetChanged) {
        assert.equal(previews.length, 0);
        await click('Close Review master decision');
        await click('Reject');
      }
      await previewDecision();
      const operation = targetChanged ? 'REJECT_AMENDMENT' : 'APPROVE_AMENDMENT';
      assert.deepEqual(previews, [{ operation, payload: { id: amendment.id, revision: 6, note } }]);
      assert.equal(saves.length, 0);
      await click(targetChanged ? 'Reject amendment' : 'Approve amendment');
      assert.deepEqual(saves, [{ ...previews[0], previewReceipt: 'reviewed-decision' }]);
      if (targetChanged) {
        assert.match(document.body.textContent ?? '', /Not approved/);
        assert.equal(document.querySelector('.form-dialog'), null);
      } else {
        assert.match(dialog().textContent ?? '', /Catalogue changed after preview/);
        assert.match(document.body.textContent ?? '', /Awaiting admin review/);
        await click('Refresh records', document);
        assert.equal(saves.length, 1);
        assert.equal(document.querySelector('.form-dialog'), null);
      }
      assert.ok(listReads >= 2);
    } finally {
      await mounted.unmount();
    }
  });
}

test('demand matching keeps ineligible candidates out and shortlists a paged candidate with the reviewed revision', async t => {
  const demandId = '88888888-8888-4888-8888-000000000010';
  const eligibleId = '88888888-8888-4888-8888-000000000011';
  const ineligibleId = '88888888-8888-4888-8888-000000000012';
  const matchReads: number[] = [];
  const previews: object[] = [];
  const saves: object[] = [];
  let shortlisted = false;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, options?: RequestInit) => {
      const path = String(input);
      if (path === '/api/dev-login') return demoResponse();
      if (path.startsWith(root + '/masters?'))
        return Response.json({
          revision: 9,
          providers: [],
          skills: [],
          certifications: [],
          page: 1,
          pageSize: 25,
          providerTotal: 0,
          skillTotal: 0,
          certificationTotal: 0,
        });
      if (path.startsWith(root + '/demands?'))
        return Response.json({
          revision: 9,
          page: 1,
          pageSize: 25,
          total: 1,
          rows: [
            {
              id: demandId,
              title: 'Customer reporting release',
              description: 'SQL support for monthly reporting',
              revision: 4,
              scopeKind: 'PROJECT',
              requirements: { skills: [{ id: 'sql', minRank: 3 }], certifications: [] },
            },
          ],
        });
      if (path.startsWith(root + '/matches?')) {
        const query = new URL(path, 'http://localhost').searchParams;
        assert.equal(query.get('id'), demandId);
        const page = Number(query.get('page'));
        matchReads.push(page);
        const eligible = page === 2;
        return Response.json({
          id: demandId,
          revision: shortlisted ? 5 : 4,
          asOf: context.asOf,
          page,
          pageSize: 1,
          total: 2,
          required: 1,
          rows: [
            {
              id: eligible ? eligibleId : ineligibleId,
              employee: eligible ? 'Rohan Mehta' : 'Neha Rao',
              employeeCode: eligible ? '710903' : '710901',
              eligible,
              matched: eligible ? 1 : 0,
              shortlisted: eligible && shortlisted,
              criteria: [
                { type: 'SKILL', name: 'SQL', matched: eligible, criterion: 'Level 3 or above' },
              ],
            },
          ],
        });
      }
      if (path === root + '/preview') {
        const command = JSON.parse(String(options?.body));
        previews.push(command);
        return Response.json({
          revision: 9,
          command,
          receipt: 'reviewed-shortlist',
          details: { name: 'Rohan Mehta', note },
        });
      }
      if (path === root && options?.method === 'POST') {
        saves.push(JSON.parse(String(options.body)));
        shortlisted = true;
        return Response.json({ id: demandId });
      }
      throw Error('Unexpected workflow request ' + path);
    },
  );
  await refreshDevelopmentLogin();
  const mounted = await render(
    <MemoryRouter>
      <BusinessWorkflows
        context={{ ...context, canMatch: true, canShortlist: true }}
        view="demand"
      />
    </MemoryRouter>,
  );
  try {
    await settle();
    await click('Find matches');
    const panel = [...document.querySelectorAll('section')].find(
      s => s.querySelector('h2')?.textContent === 'Candidate matches',
    )!;
    const shortlistButton = () =>
      [...panel.querySelectorAll('button')].find(b =>
        /^(Review shortlist|Shortlisted)$/.test(b.textContent?.trim() ?? ''),
      );
    assert.equal(shortlistButton()?.disabled, true);
    assert.match(panel.textContent ?? '', /Some requirements not established/);
    await click('Next', panel);
    assert.deepEqual(matchReads, [1, 2]);
    assert.equal(shortlistButton()?.disabled, false);
    await click('Review shortlist', panel);
    await previewDecision();
    assert.deepEqual(previews, [
      {
        operation: 'SHORTLIST',
        payload: { id: demandId, revision: 4, personId: eligibleId, note },
      },
    ]);
    assert.equal(saves.length, 0);
    await click('Add to shortlist');
    assert.deepEqual(saves, [{ ...previews[0], previewReceipt: 'reviewed-shortlist' }]);
    assert.equal(shortlistButton()?.textContent?.trim(), 'Shortlisted');
    assert.equal(shortlistButton()?.disabled, true);
  } finally {
    await mounted.unmount();
  }
});
