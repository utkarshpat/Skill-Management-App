import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationDestination } from '../src/notification-model';
import { isSupportedWorkspacePath } from '../src/WorkspaceNavigation';

test('the current release hides Phase 2 routes and notification actions', () => {
  for (const path of ['/learning', '/requests']) {
    assert.equal(isSupportedWorkspacePath(path), false);
    assert.equal(notificationDestination(path + '?record=example'), undefined);
  }
  assert.equal(isSupportedWorkspacePath('/skill-reviews'), true);
});
