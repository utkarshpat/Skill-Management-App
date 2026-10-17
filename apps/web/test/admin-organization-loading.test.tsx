import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const settle = () => new Promise(resolve => setImmediate(resolve));
test('personal admin-shell routes skip organization reads; admin views fetch and discard aborted replies', async () => {
  const source = await readFile(new URL('../src/AccessAdmin.tsx', import.meta.url), 'utf8');
  const start = source.indexOf(
    '  useEffect(() => {',
    source.indexOf('const [department, setDepartment]'),
  );
  const effect = source.slice(start, source.indexOf('  const [bulkReview', start));
  let cleanup: (() => void) | undefined;
  const requests: { signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  const display = { organization: undefined as unknown, error: '', loading: false };
  function mount(personalTitle: string | undefined, canManageUsers = true, demo = false) {
    cleanup?.();
    cleanup = undefined;
    vm.runInNewContext(effect, {
      useEffect: (callback: () => (() => void) | undefined) => {
        cleanup = callback();
      },
      personalTitle,
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
