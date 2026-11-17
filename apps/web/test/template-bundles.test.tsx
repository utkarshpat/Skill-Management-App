import test from 'node:test';
import assert from 'node:assert/strict';
import { availableBundles, bundleSelected, toggleBundle, type TemplatePermission } from '../src/template-permission-bundles';

test('bundle selection retains blocks, expiry, historical grants and unknown permissions', () => {
  const defaults: TemplatePermission[] = [
    { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
  ];
  const existing: TemplatePermission[] = [
    { permission: 'profile.view', scope: 'OWN', effect: 'DENY' },
    { permission: 'future.view', scope: 'OWN', effect: 'ALLOW' },
  ];
  const added = toggleBundle(existing, defaults, true);
  assert.equal(added[0].effect, 'DENY');
  assert.equal(added.length, 3);
  assert.equal(bundleSelected(added, defaults), false);
  assert.deepEqual(toggleBundle(added, defaults, false), existing);
  assert.equal(bundleSelected(defaults, defaults), true);
  assert.deepEqual(availableBundles([{ code: 'profile.view', label: 'Profile', implemented: true, scopes: ['OWN'] }]), []);
});
