import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rolePresets } from '../src/modules/access/role-presets.js';
import { permissionCatalogue } from '../src/modules/access/access-catalogue.js';
import {
  LocalAccessStore,
  can,
  canReviewAssigned,
} from '../src/modules/access/local-access-store.js';

test('four access profiles keep scoped responsibilities out of permission templates', async () => {
  const store = await LocalAccessStore.open();
  const owner = store.snapshot().people[0].id;
  assert.deepEqual(
    rolePresets.map(preset => preset.name),
    ['Employee', 'Manager', 'Business Analytics', 'Admin'],
  );
  for (const preset of rolePresets) {
    if (preset.assignmentMode === 'RESPONSIBILITY') {
      assert.deepEqual(
        preset.permissions,
        [],
        'Scoped authority must use a responsibility assignment, never a role-name grant.',
      );
      assert.deepEqual(preset.pending, []);
      continue;
    }
    for (const item of [...preset.permissions, ...preset.pending])
      assert.ok(permissionCatalogue.some(([code]) => code === item.permission));
    assert.ok(
      !preset.permissions.some(item =>
        ['permissions.manage', 'users.manage', 'audit.view'].includes(item.permission),
      ),
    );
    assert.ok(
      preset.pending.every(
        item =>
          !preset.permissions.some(
            grant => grant.permission === item.permission && grant.scope === 'ORGANIZATION',
          ),
      ),
    );
    const before = store.snapshot();
    const created = await store.save(owner, {
      kind: 'role',
      revision: before.revision,
      name: preset.name,
      permissions: preset.permissions,
    });
    assert.deepEqual(created.people, before.people, 'Preset creation must never assign users.');
    const role = created.roles.find(role => role.name === preset.name)!;
    const person = {
      hasDirectReports: preset.key === 'manager',
      id: 'employee',
      displayName: 'Test',
      employeeCode: 'T',
      active: true,
      roleIds: [role.id],
      overrides: [],
    };
    assert.equal(can(created, person, 'profile.view', true), true);
    assert.equal(can(created, person, 'profile.view'), false);
    assert.equal(can(created, person, 'permissions.manage'), false);
    assert.equal(canReviewAssigned(created, person), preset.key === 'manager');
    assert.equal(
      can(created, person, 'skill.verify'),
      false,
      'No claim can be approved without assignment.',
    );
  }
});
