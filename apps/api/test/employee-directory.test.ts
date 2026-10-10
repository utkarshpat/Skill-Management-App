import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmployeeProfileReader } from '../src/modules/identity/employee-profile.js';
import {
  StoredEmployeeDirectoryProvider,
  validateEmployeeDirectoryRecord,
  type EmployeeDirectoryProvider,
} from '../src/modules/identity/employee-directory.js';
import type { AccessStore, LocalAccessState } from '../src/modules/access/index.js';

const identity = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  objectId: 'c41e8f22-5401-49b0-9dc1-3c0b4352a101',
};
const personId = '00000000-0000-4000-8000-000000000002';
const organization = {
  workspace: 'Company',
  placementStatus: 'ASSIGNED' as const,
  deliveryUnit: 'UK',
  department: 'NHS',
  team: 'Digital',
  managerStatus: 'ASSIGNED' as const,
  managerName: 'Manager',
};
function fixture(directory: EmployeeDirectoryProvider = new StoredEmployeeDirectoryProvider()) {
  const state: LocalAccessState = {
    revision: 1,
    roles: [
      {
        id: 'employee',
        name: 'Employee',
        permissions: [
          { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
          { permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' },
        ],
      },
    ],
    people: [
      {
        id: personId,
        displayName: 'Utkarsh Patel',
        employeeCode: 'EMP102',
        active: true,
        entraObjectId: identity.objectId,
        roleIds: ['employee'],
        overrides: [],
      },
    ],
    reporting: [{ personId, managerId: null }],
    audit: [],
  };
  let reads = 0;
  const access: AccessStore = {
    snapshot: async () => {
      reads++;
      return state;
    },
    person: async id => state.people.find(p => p.id === id),
    save: async () => {
      throw new Error('No writes in directory reads.');
    },
  };
  const dependencies = {
    access,
    directory,
    resolveIdentity: async () => personId,
    ownOrganization: async () => organization,
    legacyProfile: async () => {
      throw new Error('Unexpected fallback.');
    },
  };
  return {
    state,
    dependencies,
    profile: createEmployeeProfileReader(dependencies),
    reads: () => reads,
  };
}

test('stored directory preserves profile, ownership, roles and organisation without additional access reads', async () => {
  const f = fixture();
  const profile = await f.profile(identity);
  assert.equal(profile?.id, personId);
  assert.equal(profile?.employeeCode, 'EMP102');
  assert.equal(profile?.displayName, 'Utkarsh Patel');
  assert.deepEqual(profile?.roles, ['Employee']);
  assert.equal(profile?.canManageAccess, false);
  assert.deepEqual(profile?.organizationDetails, organization);
  assert.equal(profile?.firstName, null);
  assert.equal(profile?.email, null);
  assert.equal(f.reads(), 1);
});

test('denied/inactive employees cannot invoke a directory provider', async () => {
  const f = fixture({
    source: 'external',
    readEmployee: async () => {
      throw new Error('Must not call.');
    },
  });
  f.state.people[0].overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
  assert.equal(await f.profile(identity), undefined);
  f.state.people[0].overrides = [];
  f.state.people[0].active = false;
  assert.equal(await f.profile(identity), undefined);
});

test('source replacement changes descriptive facts while external roles cannot grant access', async () => {
  const f = fixture({
    source: 'external',
    readEmployee: async ({ stored }) => ({
      ...stored,
      displayName: 'Utkarsh Kumar Patel',
      firstName: 'Utkarsh',
      lastName: 'Patel',
      email: 'utkarsh.patel2@soprasteria.com',
      roles: ['Admin'],
      canManageAccess: true,
    }),
  });
  const profile = await f.profile(identity);
  assert.equal(profile?.email, 'utkarsh.patel2@soprasteria.com');
  assert.equal(profile?.displayName, 'Utkarsh Kumar Patel');
  assert.deepEqual(profile?.roles, ['Employee']);
  assert.equal(profile?.canManageAccess, false);
  assert.equal(profile?.id, personId);
  assert.equal(f.reads(), 2);
});

test('identity/relationship conflicts fail instead of silently changing ownership or review routing', async () => {
  for (const change of [
    { employeeCode: 'EMP999' },
    { entraObjectId: '00000000-0000-4000-8000-000000000099' },
    { department: 'Different account' },
    { managerEmployeeCode: 'EMP101' },
  ]) {
    const f = fixture({
      source: 'external',
      readEmployee: async ({ stored }) => ({ ...stored, ...change }),
    });
    await assert.rejects(
      f.profile(identity),
      (error: unknown) =>
        error instanceof Error && /reconciliation|synchronization/.test(error.message),
    );
  }
});

test('revocation and identity reassignment during an external request suppress the profile', async () => {
  let revoke = () => {};
  const f = fixture({
    source: 'external',
    readEmployee: async ({ stored }) => {
      revoke();
      return { ...stored };
    },
  });
  revoke = () => {
    f.state.people[0].active = false;
  };
  assert.equal(await f.profile(identity), undefined);
  f.state.people[0].active = true;
  revoke = () => {
    f.dependencies.resolveIdentity = async () => 'different-person';
  };
  assert.equal(await f.profile(identity), undefined);
});

test('provider failures and missing employees never silently fall back to old DB facts', async () => {
  const failed = fixture({
    source: 'external',
    readEmployee: async () => {
      throw new Error('Source unavailable.');
    },
  });
  await assert.rejects(failed.profile(identity), /Source unavailable/);
  const missing = fixture({ source: 'external', readEmployee: async () => undefined });
  assert.equal(await missing.profile(identity), undefined);
});

test('normalizer rejects invalid payloads and strips fields outside the employee contract', () => {
  const record = {
    employeeCode: 'EMP102',
    displayName: 'Utkarsh Patel',
    firstName: null,
    lastName: null,
    email: null,
    entraObjectId: identity.objectId,
    active: true,
    managerEmployeeCode: null,
    deliveryUnit: 'UK',
    department: 'NHS',
    team: null,
  };
  assert.equal('roles' in validateEmployeeDirectoryRecord({ ...record, roles: ['Admin'] }), false);
  for (const change of [
    { active: 'true' },
    { email: 'invalid' },
    { employeeCode: '' },
    { managerEmployeeCode: 'EMP102' },
    { entraObjectId: 'invalid' },
    { team: 'x'.repeat(101) },
  ])
    assert.throws(() => validateEmployeeDirectoryRecord({ ...record, ...change }));
});

test('external directory resolves a persisted manager beyond the SQL actor projection', async () => {
  const f = fixture({
    source: 'external',
    readEmployee: async ({ stored }) => {
      assert.equal(stored.managerEmployeeCode, 'EMP101');
      return { ...stored, managerEmployeeCode: 'EMP101' };
    },
  });
  const manager = {
    ...f.state.people[0],
    id: 'manager',
    employeeCode: 'EMP101',
    entraObjectId: undefined,
  };
  f.state.people.push(manager);
  f.state.reporting = [
    { personId, managerId: manager.id },
    { personId: manager.id, managerId: null },
  ];
  f.dependencies.access.actorSnapshot = async () => ({
    ...structuredClone(f.state),
    people: [structuredClone(f.state.people[0])],
    reporting: undefined,
  });
  const profile = await f.profile(identity);
  assert.equal(profile?.employeeCode, 'EMP102');
  assert.equal(f.reads(), 2); // Full canonical bindings before and after provider I/O.
});

test('external manager reassignment during directory I/O remains a reconciliation conflict', async () => {
  const f = fixture({
    source: 'external',
    readEmployee: async ({ stored }) => {
      f.state.reporting![0].managerId = 'replacement';
      return { ...stored };
    },
  });
  f.state.people.push(
    { ...f.state.people[0], id: 'manager', employeeCode: 'EMP101', entraObjectId: undefined },
    { ...f.state.people[0], id: 'replacement', employeeCode: 'EMP100', entraObjectId: undefined },
  );
  f.state.reporting = [
    { personId, managerId: 'manager' },
    { personId: 'manager', managerId: null },
    { personId: 'replacement', managerId: null },
  ];
  f.dependencies.access.actorSnapshot = async () => ({
    ...structuredClone(f.state),
    people: [structuredClone(f.state.people[0])],
    reporting: undefined,
  });
  await assert.rejects(f.profile(identity), /synchronization/);
});

test('external directory fails closed when canonical reporting is unavailable or ambiguous', async () => {
  let calls = 0;
  const f = fixture({
    source: 'external',
    readEmployee: async ({ stored }) => {
      calls++;
      return stored;
    },
  });
  f.state.reporting = undefined;
  await assert.rejects(f.profile(identity), /Canonical reporting information/);
  assert.equal(calls, 0);
  f.state.reporting = [
    { personId, managerId: null },
    { personId, managerId: null },
  ];
  await assert.rejects(f.profile(identity), /synchronization/);
  assert.equal(calls, 0);
});
