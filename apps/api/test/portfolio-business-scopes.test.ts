import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessChange,
  businessQuery,
  previewBusiness,
} from '../src/modules/business/business.js';
import { peopleSearchQuery } from '../src/modules/business/people-search.js';
import { reportCells } from '../src/modules/business/export.js';
import type { BusinessDashboard } from '../src/modules/business/business.js';
import { actionRegistry, effectiveAccess } from '../src/modules/access/effective-access.js';
import type { LocalAccessState } from '../src/modules/access/local-access-store.js';

const actor = '10000000-0000-4000-8000-000000000001';
const employee = '10000000-0000-4000-8000-000000000002';
const portfolio = '10000000-0000-4000-8000-000000000003';
const id = '10000000-0000-4000-8000-000000000004';
const request = {
  revision: 4,
  kind: 'RESPONSIBILITY',
  id,
  payload: {
    personId: employee,
    bundle: 'BUSINESS_OPERATIONS',
    kind: 'PORTFOLIO',
    scopeId: portfolio,
    effect: 'ALLOW',
    active: true,
    reason: 'Financial Services analytics responsibility',
  },
};
const state = {
  revision: 4,
  people: [{ id: employee, name: 'Rohan Mehta', active: true }],
  nodes: [
    {
      id: portfolio,
      name: 'Financial Services',
      kind: 'PORTFOLIO',
      active: true,
      scopeValid: true,
    },
  ],
};
test('effective-access discovery explains explicit Portfolio Business scope without advertising generic role or review scope', () => {
  for (const code of ['reports.view', 'reports.export', 'demand.view', 'matching.run']) {
    const action = actionRegistry.find(a => a.code === code)!;
    assert.ok(action.bindingScopes.includes('PORTFOLIO'));
    assert.ok(!action.scopes.includes('PORTFOLIO' as never));
  }
  assert.deepEqual(actionRegistry.find(a => a.code === 'request.approve')?.bindingScopes, [
    'ORGANIZATION',
  ]);
  assert.ok(
    !actionRegistry.find(a => a.code === 'skill.verify')?.bindingScopes.includes('PORTFOLIO'),
  );
  const person = {
    id: employee,
    displayName: 'Rohan Mehta',
    employeeCode: '710902',
    active: true,
    hasDirectReports: false,
    roleIds: [],
    overrides: [],
    business: {
      personalBaseline: true,
      systemAdmin: false,
      view: true,
      export: true,
      manage: false,
      amend: false,
      scopes: [
        {
          id,
          bundle: 'BUSINESS_OPERATIONS' as const,
          kind: 'PORTFOLIO' as const,
          scopeId: portfolio,
          label: 'Financial Services',
          effect: 'ALLOW' as const,
          validUntil: null,
          reason: 'Reviewed portfolio analytics',
        },
      ],
    },
  };
  const local: LocalAccessState = { revision: 4, roles: [], people: [person], audit: [] };
  const decision = effectiveAccess(local, person, 'reports.view', 'WORKSPACE');
  assert.equal(decision.allowed, true);
  assert.ok(decision.sources.some(s => s.scope === 'PORTFOLIO:' + portfolio));
  assert.equal(effectiveAccess(local, person, 'skill.verify', 'WORKSPACE').allowed, false);
});
test('Portfolio responsibility preview binds the exact active server scope without granting manager reviews', () => {
  const command = businessChange(request);
  const preview = previewBusiness(actor, state, command);
  assert.ok(preview.receipt);
  assert.equal(preview.impact.binding, 'Financial Services');
  assert.doesNotMatch(JSON.stringify(preview.impact), /skill review|direct report/i);
  for (const nodes of [
    [],
    [{ ...state.nodes[0], active: false }],
    [{ ...state.nodes[0], scopeValid: false }],
    [{ ...state.nodes[0], kind: 'DEPARTMENT' }],
  ]) {
    assert.throws(() => previewBusiness(actor, { ...state, nodes }, command), /scope binding/);
  }
  assert.throws(() => previewBusiness(actor, { ...state, revision: 5 }, command), /Access changed/);
  assert.throws(
    () => businessChange({ ...request, payload: { ...request.payload, bundle: 'SYSTEM_ADMIN' } }),
    /organization scope/,
  );
  assert.throws(
    () => businessChange({ ...request, payload: { ...request.payload, effect: 'DENY' } }),
    /expiry/,
  );
  const deny = businessChange({
    ...request,
    payload: { ...request.payload, effect: 'DENY', validUntil: '2099-01-01T00:00:00Z' },
  });
  assert.ok(previewBusiness(actor, state, deny).receipt);
  assert.ok(
    previewBusiness(
      actor,
      { ...state, nodes: [{ ...state.nodes[0], active: false, scopeValid: false }] },
      businessChange({ ...request, payload: { ...request.payload, active: false } }),
    ).receipt,
  );
});
test('analytics and matching preserve distinct responsibility and hierarchy identifiers and reject malformed IDs', () => {
  const matching = {
    skills: [{ id, minRank: 2 }],
    certifications: [],
    hierarchyId: portfolio,
    scopeId: id,
  };
  assert.equal(businessQuery({ hierarchyId: portfolio, scopeId: id }).hierarchyId, portfolio);
  assert.equal(peopleSearchQuery(matching).hierarchyId, portfolio);
  for (const hierarchyId of ['', null, [], {}, 3, 'Financial Services', portfolio + 'x']) {
    assert.throws(() => businessQuery({ hierarchyId }));
    assert.throws(() => peopleSearchQuery({ ...matching, hierarchyId }));
  }
  assert.equal(businessQuery({}).hierarchyId, undefined);
  assert.equal(peopleSearchQuery({ ...matching, hierarchyId: undefined }).hierarchyId, undefined);
});

test('CSV and workbook metadata identify the server-resolved narrowed portfolio without treating it as a grant', () => {
  const data = {
    context: {
      scopes: [],
      hierarchy: [{ id: portfolio, name: 'Financial Services', kind: 'PORTFOLIO', parentId: null }],
      asOf: '2026-11-05T10:00:00Z',
    },
    rows: [{ employee: 'Aditi Menon' }],
    total: 1,
  } as unknown as BusinessDashboard;
  const report = reportCells(data, businessQuery({ hierarchyId: portfolio }));
  assert.deepEqual(
    report.metadata.find(row => row[0] === 'Organization hierarchy'),
    ['Organization hierarchy', 'Financial Services'],
  );
  assert.deepEqual(
    report.metadata.find(row => row[0] === 'Scope'),
    ['Scope', 'All authorized scopes'],
  );
  const unavailable = reportCells(
    { ...data, context: { ...data.context, hierarchy: [] } },
    businessQuery({ hierarchyId: portfolio }),
  );
  assert.equal(
    unavailable.metadata.find(row => row[0] === 'Organization hierarchy')?.[1],
    'Selected authorized placement',
  );
});
