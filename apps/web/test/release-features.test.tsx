import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationDestination } from '../src/notification-model';
import { isSupportedWorkspacePath, personalNavigationItems } from '../src/WorkspaceNavigation';

test('module links follow runtime capabilities and authorized notification destinations', () => {
  for (const path of ['/learning', '/requests']) {
    assert.equal(isSupportedWorkspacePath(path), true);
    assert.ok(notificationDestination(path));
  }
  const initial = { ownProfile: true, ownSkills: true };
  const pages = (capabilities: typeof initial & { learning?: boolean; requests?: boolean }) =>
    personalNavigationItems(capabilities).map(item => item.href);
  assert.ok(!pages(initial).includes('/learning'));
  assert.ok(!pages(initial).includes('/requests'));
  assert.ok(pages({ ...initial, learning: true }).includes('/learning'));
  assert.ok(!pages({ ...initial, learning: true }).includes('/requests'));
  assert.equal(isSupportedWorkspacePath('/skill-reviews'), true);
});
