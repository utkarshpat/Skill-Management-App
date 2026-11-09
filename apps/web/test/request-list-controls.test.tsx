import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
} from './support/interactions';
import type { RequestRecord } from '../src/request-model';
const { RequestList } = component<typeof import('../src/RequestList')>('RequestList.tsx');
const request: RequestRecord = {
  id: 'reporting',
  reference: 'REQ-1042',
  category: 'PROJECT',
  kind: 'REQUEST',
  title: 'Confirm reporting assignment',
  description: 'Confirm the reporting assignment for the current project.',
  priority: 'NORMAL',
  status: 'SUBMITTED',
  revision: 3,
  requesterName: 'Aditi Menon',
  recipientName: 'Rohan Mehta',
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-08T10:00:00Z',
  canComment: true,
  canCancel: true,
};
const incident: RequestRecord = {
  ...request,
  id: 'access',
  reference: 'INC-1043',
  category: 'PLATFORM',
  kind: 'INCIDENT',
  title: 'Dashboard access interrupted',
  requesterName: 'Meera Joshi',
  recipientName: 'Aditi Menon',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let reads: { params: URLSearchParams; signal?: AbortSignal | null }[],
  opened: string[],
  failure: number;
let held: ReturnType<typeof deferred<Response>> | undefined;
function listing(params: URLSearchParams, source?: RequestRecord[]) {
  const inbox = params.get('inbox') === 'true',
    page = Number(params.get('page'));
  const rows =
    source ??
    (inbox
      ? [incident]
      : [
          request,
          { ...request, id: 'followup', reference: 'REQ-1044', title: 'Review follow-up' },
        ]);
  const items = rows.filter(
    row =>
      (!params.get('q') || row.title.toLowerCase().includes(params.get('q')!.toLowerCase())) &&
      ['kind', 'status', 'priority', 'category'].every(
        key => !params.get(key) || row[key as keyof RequestRecord] === params.get(key),
      ),
  );
  return Response.json({
    items: items.slice(page - 1, page),
    total: items.length,
    page,
    pageSize: 1,
    summary: {
      total: rows.length,
      submitted: inbox ? 0 : 2,
      inProgress: inbox ? 1 : 0,
      resolved: 0,
      myTotal: 2,
      assignedTotal: 1,
    },
  });
}
beforeEach(async () => {
  reads = [];
  opened = [];
  failure = 0;
  held = undefined;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    assert.match(url, /^\/api\/workflows\?/);
    assert.equal(init?.method ?? 'GET', 'GET');
    const params = new URL(url, 'http://localhost').searchParams;
    reads.push({ params, signal: init?.signal });
    if (held) {
      const pending = held;
      held = undefined;
      return pending.promise;
    }
    return failure
      ? Response.json({ error: { message: 'Request list unavailable' } }, { status: failure })
      : listing(params);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
const list = (refresh = 0, active = true, url = '/requests') => (
  <MemoryRouter initialEntries={[url]}>
    <RequestList active={active} refresh={refresh} onOpen={id => opened.push(id)} />
  </MemoryRouter>
);
async function mount(url?: string, active = true) {
  view = await render(list(0, active, url));
  await settle();
  await settle();
}
const current = () => reads.at(-1)!.params;
const rows = () => document.querySelector('.request-table-wrap')?.textContent ?? '';
const tabs = () => document.querySelector('.request-tabs')!;

test('clicking the active request tab retains loaded rows and switching inbox shows the correct participant', async () => {
  await mount();
  assert.match(rows(), /Confirm reporting assignment.*Rohan Mehta/);
  await click('My requests', tabs());
  assert.match(rows(), /Confirm reporting assignment/);
  await click('Assigned to me', tabs());
  assert.equal(current().get('inbox'), 'true');
  assert.match(rows(), /Dashboard access interrupted.*Meera Joshi/);
  await click('Assigned to me', tabs());
  assert.match(rows(), /Dashboard access interrupted/);
  await click('My requests', tabs());
  assert.equal(current().get('inbox'), 'false');
  assert.match(rows(), /Confirm reporting assignment/);
});

test('request list debounces search, narrows by all filters and resets pagination on clear', async () => {
  await mount();
  await click('Next request page');
  assert.equal(current().get('page'), '2');
  assert.match(rows(), /Review follow-up/);
  await click('Previous request page');
  assert.equal(current().get('page'), '1');
  await fill('Search requests', '  reporting  ');
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 340));
  });
  await settle();
  assert.equal(current().get('q'), 'reporting');
  await fill('Type filter', 'REQUEST');
  await fill('Category filter', 'PROJECT');
  await fill('Status filter', 'SUBMITTED');
  await fill('Priority filter', 'HIGH');
  assert.deepEqual(Object.fromEntries(current()), {
    page: '1',
    inbox: 'false',
    q: 'reporting',
    kind: 'REQUEST',
    status: 'SUBMITTED',
    priority: 'HIGH',
    category: 'PROJECT',
  });
  assert.match(document.body.textContent!, /No matching records/);
  await click('Clear filters', document.querySelector('.request-empty')!);
  assert.match(rows(), /Confirm reporting assignment/);
  for (const key of ['q', 'kind', 'status', 'priority', 'category'])
    assert.equal(current().get(key), '');
});

test('request summary filters reset search and open actions pass the exact record ID', async () => {
  await mount('/requests?kind=INCIDENT&status=RESOLVED&inbox=true');
  assert.equal(current().get('status'), 'RESOLVED');
  assert.equal(current().get('kind'), 'INCIDENT');
  const summary = document.querySelector('.request-summary')!;
  await click('In progress, 1', summary);
  assert.equal(current().get('kind'), '');
  assert.equal(current().get('status'), 'IN_PROGRESS');
  await click('Open INC-1043');
  await click('View Dashboard access interrupted');
  assert.deepEqual(opened, ['access', 'access']);
  await click('Assigned to me, 1', summary);
  assert.equal(current().get('status'), '');
});

test('request denial clears stale rows and retries only the current view', async () => {
  await mount();
  failure = 403;
  await view!.update(list(1));
  await settle();
  assert.equal(rows(), '');
  assert.match(document.body.textContent!, /Request list unavailable/);
  failure = 0;
  await click('Retry');
  assert.equal(current().get('inbox'), 'false');
  assert.match(rows(), /Confirm reporting assignment/);
});

test('hidden request list defers reads and an aborted outbox response cannot replace inbox rows', async () => {
  await mount(undefined, false);
  assert.equal(reads.length, 0);
  const pending = deferred<Response>();
  held = pending;
  await view!.update(list(0, true));
  await settle();
  const previous = reads.at(-1)!;
  await click('Assigned to me', tabs());
  assert.equal(previous.signal?.aborted, true);
  await act(async () => pending.resolve(listing(previous.params)));
  await settle();
  assert.match(rows(), /Dashboard access interrupted/);
  assert.doesNotMatch(rows(), /Confirm reporting assignment/);
});
