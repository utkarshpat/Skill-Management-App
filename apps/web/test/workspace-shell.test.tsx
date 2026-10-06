import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
  PersonalCapabilityNavigation,
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
test('personal navigation highlights the selected skill link and requires independent own permissions', () => {
  const render = (ownProfile: boolean, ownSkills: boolean) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <PersonalCapabilityNavigation
          capabilities={{ ownProfile, ownSkills }}
          pathname="/my-skills"
          onNavigate={() => {}}
        />
      </MemoryRouter>,
    );
  const granted = render(true, true);
  assert.match(granted, /aria-current="page"[^>]*href="\/my-skills"/);
  assert.match(granted, /href="\/profile"/);
  const denied = render(true, false);
  assert.doesNotMatch(denied, /href="\/my-skills"|aria-current="page"/);
  assert.equal(render(false, false), '');
});
test('catalogue navigation visibility retains the intended manager/reviewer restriction', () => {
  assert.equal(catalogueRouteAllowed({ catalogue: true }), true);
  assert.equal(catalogueRouteAllowed({ catalogue: false }), false);
  assert.equal(catalogueRouteAllowed(undefined), false);
  assert.equal(catalogueNavigationVisible({ catalogue: true }), false);
  assert.equal(catalogueNavigationVisible({ catalogue: true, manageCatalogue: true }), true);
  assert.equal(catalogueNavigationVisible({ catalogue: true, reviewSkills: true }), true);
  assert.equal(catalogueNavigationVisible({ catalogue: false, manageCatalogue: true }), false);
});
test('supported deep links are explicit and unknown paths do not masquerade as the dashboard', () => {
  for (const path of [
    '/',
    '/access',
    '/workspace',
    '/profile',
    '/my-skills',
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
