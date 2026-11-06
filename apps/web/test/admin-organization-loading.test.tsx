import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { act } from 'react';
import { registerHooks } from 'node:module';
import { MemoryRouter, useLocation } from 'react-router';
import { closeBrowser, render, settle } from './support/browser';
import { initializeAuth } from '../src/auth';

const cssHooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { AccessAdmin } = await import('../src/AccessAdmin');
after(async () => {
  cssHooks.deregister();
  await closeBrowser();
});
test('personal and people-search routes skip organization reads; other admin views discard aborted replies', async () => {
  const source = await readFile(new URL('../src/AccessAdmin.tsx', import.meta.url), 'utf8');
  const start = source.indexOf(
    '  useEffect(() => {',
    source.indexOf('const [department, setDepartment]'),
  );
  const effect = source.slice(start, source.indexOf('  const [bulkReview', start));
  let cleanup: (() => void) | undefined;
  const requests: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  const display = { organization: undefined as unknown, error: '', loading: false };
  function mount(
    personalTitle: string | undefined,
    canManageUsers = true,
    demo = false,
    compactPeople = false,
  ) {
    cleanup?.();
    cleanup = undefined;
    vm.runInNewContext(effect, {
      useEffect: (callback: () => (() => void) | undefined) => {
        cleanup = callback();
      },
      personalTitle,
      compactPeople,
      state: { canManageUsers, revision: 1 },
      organizationAttempt: 0,
      isDemoSession: () => demo,
      AbortController,
      setOrganization: (value: unknown) => {
        display.organization = value;
      },
      setOrganizationError: (value: string) => {
        display.error = value;
      },
      setOrganizationLoading: (value: boolean) => {
        display.loading = value;
      },
      authenticatedFetch: (_: string, { signal }: { signal: AbortSignal }) =>
        new Promise(resolve => requests.push({ signal, resolve })),
      readOrganizationSummary: (value: unknown) => value,
    });
  }
  mount('My workspace');
  mount(undefined, true, false, true);
  assert.equal(requests.length, 0);
  mount(undefined);
  assert.equal(requests.length, 1);
  assert.equal(display.loading, true);
  requests[0].resolve({ nodes: [{ id: 'department' }] });
  await settle();
  assert.deepEqual(display.organization, { nodes: [{ id: 'department' }] });
  mount('My profile');
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(display.organization, undefined);
  assert.equal(display.loading, false);
  mount(undefined);
  assert.equal(requests.length, 2, 'returning to administration must fetch a fresh projection');
  mount('Skills');
  requests[1].resolve({ nodes: [{ id: 'late' }] });
  await settle();
  assert.equal(display.organization, undefined, 'late replies cannot repopulate a personal route');
  mount(undefined, false);
  mount(undefined, true, true);
  assert.equal(requests.length, 2, 'revoked administration and demo sessions do not fetch');
  cleanup?.();
});

test('personal pages skip /api/access snapshot and full admin tabs wait for non-summary state', async () => {
  const source = await readFile(new URL('../src/AccessAdmin.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  useEffect(() => {\n    if (personalTitle) return;');
  assert.notEqual(start, -1, 'Expected /api/access effect to guard personalTitle');
  assert.match(
    source,
    /const readyState = !personalTitle && state && \(compactPeople \|\| !summaryState\) \? state : undefined;/,
  );
});

test('fresh personal route preserves Organization, Activity log and People & Access sidebar navigation without fetching /api/access', async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const path = String(input);
    requests.push(path);
    if (path.includes('/dev-login'))
      return Response.json({ mode: 'local-demo', signedIn: true, people: [] });
    if (path === '/api/dev-access?summary=1')
      return Response.json({
        revision: 3,
        currentPerson: {
          id: '00000000-0000-4000-8000-000000000001',
          displayName: 'Admin Person',
          employeeCode: 'ADM-1',
          active: true,
          roleIds: [],
          overrides: [],
        },
        canManageUsers: true,
        canViewAudit: true,
        people: [],
        roles: [],
        audit: [],
        catalogue: [],
      });
    return Response.json({ items: [], total: 0, page: 1, pageSize: 10 });
  };
  await initializeAuth();
  requests.length = 0;

  let currentPath = '';
  function Probe() {
    const location = useLocation();
    currentPath = location.pathname + location.search;
    const onPersonal = location.pathname === '/profile';
    const capabilities = {
      ownProfile: true,
      ownSkills: true,
      claimSkills: true,
      catalogue: true,
      administration: true,
      manageUsers: true,
      viewAudit: true,
      manageCatalogue: true,
      learning: true,
      requests: true,
    };
    return (
      <AccessAdmin
        personalPath={onPersonal ? '/profile' : undefined}
        personalCapabilities={capabilities}
        workspaceContext={{
          person: {
            id: '00000000-0000-4000-8000-000000000001',
            displayName: 'Admin Person',
            employeeCode: 'ADM-1',
            roles: ['System Administrator'],
          },
          authentication: 'local-demo',
          capabilities,
          upcoming: [],
        }}
      />
    );
  }

  const view = await render(
    <MemoryRouter initialEntries={['/profile']}>
      <Probe />
    </MemoryRouter>,
  );
  await settle();

  assert.equal(currentPath, '/profile');
  assert.deepEqual(
    requests.filter(path => path.startsWith('/api/dev-access')),
    [],
    'Fresh personal route must not fetch /api/dev-access snapshot',
  );

  const navButtons = () =>
    [...view.container.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button')].map(
      button => button.textContent?.trim(),
    );
  assert.ok(navButtons().includes('Organization'), 'Organization should remain visible in sidebar');
  assert.ok(navButtons().includes('Activity log'), 'Activity log should remain visible in sidebar');
  assert.ok(
    navButtons().includes('People & Access'),
    'People & Access should not fall back to Access management',
  );

  const peopleButton = [
    ...view.container.querySelectorAll<HTMLButtonElement>('.admin-sidebar nav button'),
  ].find(button => button.textContent?.trim() === 'People & Access');
  assert.ok(peopleButton);
  await act(async () => {
    peopleButton.click();
  });
  await settle();

  assert.equal(currentPath, '/access?view=people');
  assert.ok(
    requests.includes('/api/dev-access?summary=1'),
    'Navigating to People & Access should request summary=1 rather than landing on Roles',
  );
  await view.unmount();
});

