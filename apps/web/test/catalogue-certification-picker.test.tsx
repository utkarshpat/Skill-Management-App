import test, { after, afterEach, beforeEach, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { act } from 'react';
import { closeBrowser, deferred, demoResponse, render, settle } from './support/browser';
import type { CatalogueCertification } from '../src/CatalogueCertificationPicker';

const require = createRequire(import.meta.url);
const { refreshDevelopmentLogin } = require('../src/auth.ts') as typeof import('../src/auth');
const { CatalogueCertificationPicker } =
  require('../src/CatalogueCertificationPicker.tsx') as typeof import('../src/CatalogueCertificationPicker');

const cert = (id: string, active = true): CatalogueCertification => ({
  id,
  active,
  name: `Certification ${id}`,
  provider: 'Test issuer',
});
let value: CatalogueCertification[];
let changed: CatalogueCertification[] | undefined;
const lastChange = () => changed;
let mounted: Awaited<ReturnType<typeof render>> | undefined;
let transport: typeof fetch;
const requests: { path: string; signal?: AbortSignal | null }[] = [];
function view(disabled = false) {
  return (
    <CatalogueCertificationPicker
      value={value}
      onChange={next => {
        changed = next;
      }}
      disabled={disabled}
    />
  );
}
async function tick(t: TestContext, ms = 0) {
  await act(async () => t.mock.timers.tick(ms));
  await settle();
}
async function click(element: Element | null) {
  assert.ok(element instanceof HTMLElement);
  await act(async () => element.click());
}
function button(name: string) {
  return (
    [...mounted!.container.querySelectorAll('button')].find(b => b.textContent === name) ?? null
  );
}
beforeEach(async () => {
  value = [];
  changed = undefined;
  requests.length = 0;
  transport = async () => Response.json({ total: 0, pageSize: 10, certifications: [] });
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === '/api/dev-login') return demoResponse();
    requests.push({ path: String(input), signal: init?.signal });
    return transport(input, init);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('optional association starts disabled, enabling loads choices and clearing removes all selections', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mounted = await render(view());
  await tick(t);
  assert.equal(requests.length, 0);
  await click(mounted.container.querySelectorAll('input[type=radio]')[1]);
  assert.match(mounted.container.textContent!, /Loading certifications/);
  await tick(t);
  assert.equal(requests.length, 1);
  assert.match(mounted.container.textContent!, /No matching certifications/);
  assert.equal((button('Previous') as HTMLButtonElement).disabled, true);
  assert.equal((button('Next') as HTMLButtonElement).disabled, true);
  await click(mounted.container.querySelectorAll('input[type=radio]')[0]);
  assert.deepEqual(changed, []);
  assert.equal(mounted.container.querySelector('input[type=search]'), null);
});

test('edit values arriving after mount enable the picker and retired selections remain removable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mounted = await render(view());
  value = [cert('retired', false)];
  await mounted.update(view());
  await tick(t);
  assert.match(mounted.container.textContent!, /Certification retired \(retired\)/);
  await click(mounted.container.querySelector('[aria-label="Remove Certification retired"]'));
  assert.deepEqual(changed, []);
});

test('selecting and deselecting preserves the parent value without losing other selected pages', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('elsewhere')];
  transport = async () => Response.json({ total: 1, pageSize: 10, certifications: [cert('a')] });
  mounted = await render(view());
  await tick(t);
  await click(mounted.container.querySelector('input[type=checkbox]'));
  assert.deepEqual(
    changed?.map(c => c.id),
    ['elsewhere', 'a'],
  );
  value = changed!;
  await mounted.update(view());
  await click(mounted.container.querySelector('input[type=checkbox]'));
  assert.deepEqual(
    changed?.map(c => c.id),
    ['elsewhere'],
  );
});

test('20-selection limit blocks additions while selected options can still be removed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = Array.from({ length: 20 }, (_, i) => cert(String(i)));
  transport = async () =>
    Response.json({ total: 2, pageSize: 10, certifications: [cert('0'), cert('new')] });
  mounted = await render(view());
  await tick(t);
  const [selected, extra] =
    mounted.container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
  assert.equal(selected.disabled, false);
  assert.equal(extra.disabled, true);
  await click(extra);
  assert.equal(changed, undefined);
  await click(selected);
  assert.equal(lastChange()?.length, 19);
  value = lastChange()!;
  await mounted.update(view());
  const available = mounted.container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1];
  assert.equal(available.disabled, false);
  await click(available);
  assert.equal(lastChange()?.length, 20);
});

test('pagination, debounced search and page reset send the exact requested filters', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('existing')];
  transport = async () => Response.json({ total: 11, pageSize: 10, certifications: [cert('a')] });
  mounted = await render(view());
  await tick(t);
  await click(button('Next'));
  await tick(t);
  assert.equal(new URL(requests.at(-1)!.path, 'http://localhost').searchParams.get('page'), '2');
  assert.equal((button('Next') as HTMLButtonElement).disabled, true);
  await click(button('Previous'));
  await tick(t);
  await click(button('Next'));
  await tick(t);
  const input = mounted.container.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Cloud & AI',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const before = requests.length;
  await tick(t, 199);
  assert.equal(requests.length, before);
  await tick(t, 1);
  const query = new URL(requests.at(-1)!.path, 'http://localhost').searchParams;
  assert.equal(query.get('search'), 'Cloud & AI');
  assert.equal(query.get('page'), '1');
});

test('failed choices show an error and retry replaces it with usable options', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('existing')];
  transport = async () =>
    Response.json({ error: { message: 'Catalogue unavailable' } }, { status: 503 });
  mounted = await render(view());
  await tick(t);
  assert.match(
    mounted.container.querySelector('[role=alert]')!.textContent!,
    /Catalogue unavailable/,
  );
  transport = async () =>
    Response.json({ total: 1, pageSize: 10, certifications: [cert('recovered')] });
  await click(button('Retry'));
  await tick(t);
  assert.equal(mounted.container.querySelector('[role=alert]'), null);
  assert.match(mounted.container.textContent!, /Certification recovered/);
});

test('disabled forms expose the native disabled fieldset contract', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('existing')];
  mounted = await render(view(true));
  await tick(t);
  assert.equal(mounted.container.querySelector('fieldset')!.disabled, true);
  assert.ok(
    mounted.container
      .querySelector('[aria-label="Remove Certification existing"]')
      ?.closest('fieldset[disabled]'),
  );
  assert.equal(changed, undefined);
});

test('switching off aborts pending requests and late choices cannot reopen the picker', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred<Response>();
  value = [cert('existing')];
  transport = () => pending.promise;
  mounted = await render(view());
  await tick(t);
  await click(mounted.container.querySelectorAll('input[type=radio]')[0]);
  await act(async () =>
    pending.resolve(Response.json({ total: 1, pageSize: 10, certifications: [cert('late')] })),
  );
  await settle();
  assert.equal(requests[0].signal?.aborted, true);
  assert.equal(mounted.container.querySelector('input[type=checkbox]'), null);
  assert.deepEqual(changed, []);
});

test('unmount cancels the debounce before any request is sent', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('existing')];
  mounted = await render(view());
  await mounted.unmount();
  mounted = undefined;
  await tick(t, 200);
  assert.equal(requests.length, 0);
});

for (const status of [401, 403, 404, 429, 500]) {
  test(`HTTP ${status} is an explicit picker error, not an empty catalogue`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    value = [cert('existing')];
    transport = async () =>
      Response.json({ error: { message: `Unavailable ${status}` } }, { status });
    mounted = await render(view());
    await tick(t);
    assert.match(
      mounted.container.querySelector('[role=alert]')!.textContent!,
      new RegExp(`Unavailable ${status}`),
    );
    assert.doesNotMatch(mounted.container.textContent!, /No matching certifications/);
    assert.ok(button('Retry'));
    assert.match(mounted.container.textContent!, /Certification existing/);
  });
}

for (const payload of [
  null,
  {},
  { certifications: [] },
  { total: -1, pageSize: 10, certifications: [] },
  { total: 0, pageSize: 0, certifications: [] },
  { total: 1, pageSize: 10, certifications: [null] },
  { total: 1, pageSize: 10, certifications: [{ id: 'a' }] },
]) {
  test(`malformed successful catalogue payload stays recoverable: ${JSON.stringify(payload)}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    value = [cert('existing')];
    transport = async () => Response.json(payload);
    mounted = await render(view());
    await tick(t);
    assert.match(
      mounted.container.querySelector('[role=alert]')!.textContent!,
      /Certification choices could not be loaded/,
    );
    assert.ok(button('Retry'));
    assert.equal(mounted.container.querySelector('input[type=checkbox]'), null);
  });
}

test('rapid searches cancel their debounce, ignore stale responses and preserve selected chips', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('existing')];
  const pending = deferred<Response>();
  transport = () => pending.promise;
  mounted = await render(view());
  await tick(t);
  const input = mounted.container.querySelector<HTMLInputElement>('input[type=search]')!;
  async function search(text: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await search('old');
  await tick(t, 100);
  await search('latest & final');
  await tick(t, 199);
  assert.equal(requests.length, 1);
  transport = async () =>
    Response.json({ total: 1, pageSize: 10, certifications: [cert('fresh')] });
  await tick(t, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal?.aborted, true);
  await act(async () =>
    pending.resolve(Response.json({ total: 1, pageSize: 10, certifications: [cert('stale')] })),
  );
  await settle();
  assert.match(mounted.container.textContent!, /Certification fresh/);
  assert.doesNotMatch(mounted.container.textContent!, /Certification stale/);
  assert.match(mounted.container.textContent!, /Certification existing/);
  await search('');
  await tick(t);
  assert.equal(new URL(requests.at(-1)!.path, 'http://localhost').searchParams.get('search'), '');
});

test('unmount aborts an in-flight lookup and a late failure does not update the component', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('existing')];
  const pending = deferred<Response>();
  transport = () => pending.promise;
  mounted = await render(view());
  await tick(t);
  await mounted.unmount();
  mounted = undefined;
  pending.reject(Error('Late failure'));
  await settle();
  assert.equal(requests[0].signal?.aborted, true);
});

test('a non-Error network failure still gives the user a retryable message', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  value = [cert('existing')];
  transport = async () => {
    throw 'offline';
  };
  mounted = await render(view());
  await tick(t);
  assert.match(
    mounted.container.querySelector('[role=alert]')!.textContent!,
    /Certification choices could not be loaded/,
  );
});
