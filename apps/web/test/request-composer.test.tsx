import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { act } from 'react';
import { render, closeBrowser } from './support/browser';
import { initializeAuth } from '../src/auth';
import type { RequestOptions } from '../src/request-model';

const cssHooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { RequestComposer } = await import('../src/RequestComposer');
after(async () => {
  cssHooks.deregister();
  await closeBrowser();
});
const manager = {
  id: 'manager',
  name: 'Example Manager',
  kind: 'REQUEST' as const,
  reportingManager: true,
  reportingLine: true,
};
const teammate = {
  id: 'team',
  name: 'Example Teammate',
  kind: 'REQUEST' as const,
  reportingManager: false,
  sameTeam: true,
};
const other = {
  id: 'other',
  name: 'Example Other Person',
  kind: 'REQUEST' as const,
  reportingManager: false,
};
const admin = {
  id: 'admin',
  name: 'Example Administrator',
  kind: 'REQUEST' as const,
  reportingManager: false,
  systemAdmin: true,
};
const options: RequestOptions = {
  canRequest: true,
  canIncident: false,
  categories: [
    { code: 'SKILL', kind: 'REQUEST' },
    { code: 'PLATFORM', kind: 'REQUEST' },
  ],
  recipients: [manager, teammate],
};
const waitSearch = async () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
  });
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(
    b => b.textContent?.trim() === label,
  );
  assert.ok(button, label);
  await act(async () => button.click());
}
async function choose(value: string) {
  const radio = document.querySelector<HTMLInputElement>(
    `dialog input[type="radio"][value="${value}"]`,
  );
  assert.ok(radio, value);
  await act(async () => radio.click());
}
async function search(query: string) {
  const input = document.querySelector<HTMLInputElement>('dialog input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitSearch();
}

test('employee topics fail closed; team/reporting defaults change to other people only on search', async () => {
  const reads: URL[] = [];
  let fail = false;
  globalThis.fetch = async input => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/dev-login')
      return Response.json({ mode: 'local-demo', signedIn: true, people: [] });
    assert.equal(url.pathname, '/api/workflows/options');
    reads.push(url);
    if (fail)
      return Response.json(
        { error: { message: 'Directory temporarily unavailable.' } },
        { status: 503 },
      );
    return Response.json({
      ...options,
      recipients: url.searchParams.get('q') ? [other] : [manager, teammate],
    });
  };
  await initializeAuth();
  const view = await render(
    <RequestComposer
      options={options}
      onClose={() => {}}
      onSaved={() => {}}
      draft={{ kind: 'REQUEST', title: 'Skill help', description: 'Please help with my skills.' }}
    />,
  );
  assert.equal(document.querySelector('input[value="ASSESSMENT"]'), null);
  assert.equal(document.querySelector('input[value="PROJECT"]'), null);
  await choose('SKILL');
  await click('Next');
  await click('Next');
  await waitSearch();
  const people = () => document.querySelector('.request-people-grid')!.textContent ?? '';
  assert.match(people(), /Example Manager.*Your reporting manager/);
  assert.match(people(), /Example Teammate.*Your team/);
  assert.doesNotMatch(people(), /Other Person/);
  assert.equal(reads[0].searchParams.get('category'), 'SKILL');
  assert.equal(reads[0].searchParams.get('q'), '');
  await choose('manager');
  await search('Other');
  assert.match(people(), /Example Other Person/);
  assert.doesNotMatch(people(), /Example Teammate/);
  assert.match(
    document.querySelector('.request-recipient-confirmation')!.textContent ?? '',
    /Example Manager/,
  );
  await search('');
  assert.match(people(), /Example Teammate/);
  fail = true;
  await search('fail');
  assert.match(
    document.querySelector('[role="alert"]')!.textContent ?? '',
    /Directory temporarily unavailable/,
  );
  assert.equal(document.querySelector('.request-people-grid'), null);
  await view.unmount();
});

test('platform defaults show admin names without auto-selecting or silently sending; topic changes reset recipient', async () => {
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/dev-login')
      return Response.json({ mode: 'local-demo', signedIn: true, people: [] });
    assert.notEqual(init?.method, 'POST');
    if (init?.method === 'POST') writes++;
    return Response.json({
      ...options,
      recipients: url.searchParams.get('category') === 'PLATFORM' ? [admin] : [manager],
    });
  };
  await initializeAuth();
  const view = await render(
    <RequestComposer
      options={options}
      onClose={() => {}}
      onSaved={() => {}}
      draft={{ kind: 'REQUEST', title: 'Platform bug', description: 'The page is not working.' }}
    />,
  );
  await choose('PLATFORM');
  await click('Next');
  await click('Next');
  await waitSearch();
  assert.match(
    document.querySelector('.request-people-grid')!.textContent ?? '',
    /Example Administrator.*Platform administrator/,
  );
  assert.equal(document.querySelector('.request-recipient-confirmation'), null);
  await click('Next');
  assert.match(document.querySelector('[role="alert"]')!.textContent ?? '', /Choose who/);
  await choose('admin');
  await click('Next');
  assert.match(
    document.querySelector('.request-review')!.textContent ?? '',
    /Example Administrator/,
  );
  await click('Edit topic');
  await choose('SKILL');
  await click('Next');
  await click('Next');
  await waitSearch();
  assert.equal(document.querySelector('.request-recipient-confirmation'), null);
  assert.match(
    document.querySelector('.request-people-grid')!.textContent ?? '',
    /Example Manager/,
  );
  assert.equal(writes, 0);
  await view.unmount();
});
