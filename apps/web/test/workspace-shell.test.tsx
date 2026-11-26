import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  personalNavigationItems,
  administrationShellFor,
  catalogueNavigationVisible,
  catalogueRouteAllowed,
  isSupportedWorkspacePath,
  personalPageTitle,
} from '../src/WorkspaceNavigation';

test('personal and AI link destinations retain the admin shell only with administration capability', () => {
  for (const pathname of ['/my-skills', '/skills', '/profile', '/workspace']) {
    assert.equal(administrationShellFor(pathname, true), true);
    assert.equal(administrationShellFor(pathname, false), false);
    assert.ok(personalPageTitle(pathname));
  }
  assert.equal(administrationShellFor('/access', false), true);
  assert.equal(personalPageTitle('/access'), undefined);
});
test('catalogue navigation visibility retains the intended manager/reviewer restriction', () => {
  assert.equal(catalogueRouteAllowed({ catalogue: true }), true);
  assert.equal(catalogueRouteAllowed({ catalogue: false }), false);
  assert.equal(catalogueRouteAllowed(undefined), false);
  assert.equal(catalogueNavigationVisible({ catalogue: true }), false);
  assert.equal(catalogueNavigationVisible({ catalogue: true, manageCatalogue: true }), true);
  assert.equal(catalogueNavigationVisible({ catalogue: true, reviewSkills: true }), true);
  assert.equal(catalogueNavigationVisible({ catalogue: true, amendments: true }), true);
  assert.equal(catalogueNavigationVisible({ catalogue: true, approveAmendments: true }), true);
  assert.equal(catalogueNavigationVisible({ catalogue: false, amendments: true }), false);
  assert.equal(catalogueNavigationVisible({ catalogue: false, manageCatalogue: true }), false);
});
test('supported deep links are explicit and unknown paths do not masquerade as the dashboard', () => {
  for (const path of [
    '/',
    '/access',
    '/workspace',
    '/profile',
    '/my-skills',
    '/certifications',
    '/skills',
    '/skill-reviews',
    '/learning',
    '/requests',
    '/preview',
    '/knowledgetransfer',
  ])
    assert.equal(isSupportedWorkspacePath(path), true, path);
  for (const path of ['/missing', '/skill-reviews/claim-1', '/requests/other'])
    assert.equal(isSupportedWorkspacePath(path), false, path);
});

test('personal navigation derives the active destination from own permissions', () => {
  const items = personalNavigationItems({ ownProfile: true, ownSkills: true }, '/my-skills');
  assert.ok(items.some(item => item.href === '/my-skills' && item.active));
  assert.ok(items.some(item => item.href === '/profile'));
  assert.deepEqual(
    personalNavigationItems({ ownProfile: false, ownSkills: false }, '/my-skills'),
    [],
  );
});
