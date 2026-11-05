import test from 'node:test';
import assert from 'node:assert/strict';
import { organizationValidationMessage } from '../src/shared/organization-terminology.js';
import { organizationChange } from '../src/modules/organization/organization.js';
import { previewOrganization } from '../src/modules/organization/preview.js';

const person = '10000000-0000-4000-8000-000000000001';
const client = '10000000-0000-4000-8000-000000000002';
const project = '10000000-0000-4000-8000-000000000003';

test('legacy SQL validation is translated without changing unrelated access or workflow instructions', () => {
  assert.equal(
    organizationValidationMessage('Choose either a department or a team.'),
    'Choose either an account/client or an organizational project.',
  );
  assert.equal(
    organizationValidationMessage('Move teams and departments first.'),
    'Move organizational projects and accounts/clients first.',
  );
  assert.equal(
    organizationValidationMessage('Choose an active team in this workspace.'),
    'Choose an active organizational project in this workspace.',
  );
  const policy = 'Reporting line would contain a cycle. Workspace access denied.';
  assert.equal(organizationValidationMessage(policy), policy);
});

test('renamed organization levels retain DEPARTMENT/TEAM node types and exact assignment keys', () => {
  for (const type of ['DEPARTMENT', 'TEAM']) {
    const change = organizationChange({
      revision: 1,
      kind: 'node',
      type,
      name: type === 'DEPARTMENT' ? 'Example Client' : 'Example Project',
      parentId: client,
      active: true,
    });
    assert.equal(change.kind, 'node');
    assert.equal('type' in change.payload && change.payload.type, type);
  }
  const direct = organizationChange({
    revision: 1,
    kind: 'assignment',
    personId: person,
    departmentId: client,
  });
  assert.deepEqual(direct.payload, { departmentId: client, teamId: null, managerId: null });
  const placed = organizationChange({
    revision: 1,
    kind: 'assignment',
    personId: person,
    teamId: project,
  });
  assert.deepEqual(placed.payload, { departmentId: null, teamId: project, managerId: null });
  assert.throws(
    () =>
      organizationChange({
        revision: 1,
        kind: 'assignment',
        personId: person,
        departmentId: client,
        teamId: project,
      }),
    /Choose either an account\/client or an organizational project/,
  );
  assert.throws(
    () =>
      organizationChange({
        revision: 1,
        kind: 'node',
        type: 'PROJECT',
        name: 'Not an org kind',
        parentId: client,
        active: true,
      }),
    /name, type and status/,
  );
});

test('preview retains original data and warning constraints while using current placement naming', () => {
  const source = {
    revision: 1,
    nodes: [
      {
        id: client,
        kind: 'DEPARTMENT' as const,
        name: 'Example Client',
        parentId: null,
        active: true,
      },
    ],
    people: [{ id: person, displayName: 'Test Employee', employeeCode: 'TEST', active: true }],
    assignments: [],
  };
  const before = structuredClone(source);
  const result = previewOrganization(source, person, {
    revision: 1,
    kind: 'assignment',
    personId: person,
    departmentId: client,
  });
  assert.deepEqual(result.after, {
    personId: person,
    departmentId: client,
    teamId: null,
    managerId: null,
  });
  assert.match(result.warnings.join(' '), /account\/client or organization access/);
  assert.match(result.warnings.join(' '), /not silently rerouted/);
  assert.deepEqual(source, before);
});
