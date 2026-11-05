import test from 'node:test';
import assert from 'node:assert/strict';
import {
  organizationKindLabel,
  organizationPreviewText,
  organizationScopeLabel,
  organizationParentKind,
  organizationChildKind,
  organizationPathValid,
  type OrganizationKind,
} from '../src/organization-labels';

test('organization labels cover legacy kinds without inventing scope support or renaming other scopes', () => {
  assert.equal(organizationKindLabel('DEPARTMENT'), 'Accounts/Clients');
  assert.equal(organizationKindLabel('PORTFOLIO'), 'Portfolio/Division');
  assert.equal(organizationKindLabel('TEAM'), 'Project');
  assert.equal(organizationKindLabel('PROJECT'), 'Project');
  assert.equal(organizationKindLabel('DELIVERY_UNIT'), 'DELIVERY UNIT');
  assert.equal(organizationKindLabel('ORGANIZATION'), 'ORGANIZATION');
  assert.equal(organizationKindLabel('DIRECT_REPORTS'), 'DIRECT REPORTS');
  assert.equal(organizationKindLabel('SELF'), 'SELF');
  assert.equal(organizationKindLabel('FUTURE_SCOPE'), 'FUTURE SCOPE');
});

test('four organizational levels have exact parent/child topology without Business PROJECT', () => {
  const kinds: OrganizationKind[] = ['DELIVERY_UNIT', 'PORTFOLIO', 'DEPARTMENT', 'TEAM'];
  for (const [index, kind] of kinds.entries()) {
    assert.equal(organizationParentKind[kind], kinds[index - 1] ?? null);
    assert.equal(organizationChildKind[kind], kinds[index + 1] ?? null);
  }
  assert.equal(Object.hasOwn(organizationParentKind, 'PROJECT'), false);
  const nodes = kinds.map((kind, i) => ({
    id: kind,
    kind,
    parentId: kinds[i - 1] ?? null,
    active: true,
  }));
  for (const kind of kinds) assert.equal(organizationPathValid(nodes, kind), true);
  assert.equal(organizationPathValid(nodes, 'foreign'), false);
  for (const index of [0, 1, 2, 3]) {
    const inactive = structuredClone(nodes);
    inactive[index].active = false;
    assert.equal(organizationPathValid(inactive, 'TEAM'), false);
  }
  const broken = [
    nodes.filter(n => n.kind !== 'PORTFOLIO'),
    [...nodes, { ...nodes[1] }],
    nodes.map(n => (n.kind === 'DEPARTMENT' ? { ...n, parentId: 'DELIVERY_UNIT' } : n)),
    nodes.map(n => (n.kind === 'DELIVERY_UNIT' ? { ...n, parentId: 'TEAM' } : n)),
  ];
  for (const value of broken) assert.equal(organizationPathValid(value, 'TEAM'), false);
});

test('effective scope captions translate only the kind and preserve the exact binding suffix', () => {
  assert.equal(organizationScopeLabel('DEPARTMENT:Client_ID'), 'Accounts/Clients:Client_ID');
  assert.equal(organizationScopeLabel('TEAM:Project_ID'), 'Project:Project_ID');
  assert.equal(organizationScopeLabel('PROJECT:Project_ID'), 'Project:Project_ID');
  assert.equal(organizationScopeLabel('DIRECT_REPORTS'), 'DIRECT REPORTS');
  assert.equal(organizationScopeLabel('SELF'), 'SELF');
});

test('organization previews translate field captions and kind values, not saved IDs or supplied names', () => {
  const record = {
    type: 'DEPARTMENT',
    name: 'TEAM',
    parentId: 'unit',
    departmentId: 'client',
    teamId: null,
    managerId: 'manager',
    active: true,
  };
  const before = structuredClone(record);
  assert.deepEqual(JSON.parse(organizationPreviewText(record)!), {
    Level: 'Accounts/Clients',
    Name: 'TEAM',
    'Parent ID': 'unit',
    'Accounts/Clients ID': 'client',
    'Project ID': null,
    'Reporting manager ID': 'manager',
    Active: true,
  });
  assert.deepEqual(record, before);
  assert.equal(organizationPreviewText(null), 'null');
  assert.equal(
    JSON.parse(organizationPreviewText({ kind: 'TEAM', name: 'DEPARTMENT' })!).Level,
    'Project',
  );
  assert.equal(
    JSON.parse(organizationPreviewText({ kind: 'TEAM', name: 'DEPARTMENT' })!).Name,
    'DEPARTMENT',
  );
});
