import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, closeBrowser, deferred, settle } from './support/browser';
import { component, refreshDevelopmentLogin, click, fill } from './support/interactions';

const { DevelopmentLogin } =
  component<typeof import('../src/DevelopmentLogin')>('DevelopmentLogin.tsx');
const people = [
  { id: 'neha', displayName: 'Neha Rao', employeeCode: '710901', roles: ['Employee'] },
  { id: 'aditi', displayName: 'Aditi Menon', employeeCode: '710902', roles: [] },
];
const roster = (options = {}) =>
  Response.json({ mode: 'local-demo', signedIn: false, people, ...options });
let view: Awaited<ReturnType<typeof render>> | undefined;
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('hosted demo stays locked through an unlock timeout, then verifies the selected session after retry', async () => {
  const firstUnlock = deferred<Response>();
  let unlocks = 0;
  let signedIn = false;
  let ready = 0;
  const signIns: unknown[] = [];
  mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    if (input === '/api/dev-login/people') {
      assert.deepEqual(JSON.parse(String(init?.body)), { accessCode: 'fixture-code' });
      return ++unlocks === 1 ? firstUnlock.promise : roster({ requiresAccessCode: true });
    }
    assert.equal(input, '/api/dev-login');
    if (init?.method === 'POST') {
      signIns.push(JSON.parse(String(init.body)));
      signedIn = signIns.length === 2;
      return Response.json({ ok: true });
    }
    return roster({ requiresAccessCode: true, people: [], signedIn });
  });
  await refreshDevelopmentLogin();
  view = await render(<DevelopmentLogin onSessionReady={() => ready++} />);
  assert.equal(view.container.querySelector('select'), null);
  assert.equal(view.container.querySelector('button')?.disabled, true);
  await fill('Demo access code', 'fixture-code');
  await click('Show test people');
  assert.match(view.container.textContent!, /Checking access/);
  firstUnlock.reject(new DOMException('Timed out', 'TimeoutError'));
  await settle();
  assert.match(view.container.textContent!, /database is taking longer/);
  await click('Show test people');
  await fill('Test person', 'aditi');
  await click('Open demo workspace');
  assert.equal(ready, 0);
  assert.match(view.container.textContent!, /Direct login could not finish/);
  await click('Open demo workspace');
  assert.equal(ready, 1);
  assert.deepEqual(signIns, Array(2).fill({ personId: 'aditi', accessCode: 'fixture-code' }));
});

test('refreshing an empty local roster restores an already verified session', async () => {
  let verified = false;
  let ready = 0;
  mock.method(globalThis, 'fetch', async (input: string) => {
    assert.equal(input, '/api/dev-login');
    return roster({ people: [], signedIn: verified });
  });
  await refreshDevelopmentLogin();
  view = await render(<DevelopmentLogin onSessionReady={() => ready++} />);
  assert.match(view.container.textContent!, /No active development-login people/);
  verified = true;
  await click('Refresh available people');
  assert.equal(ready, 1);
});
