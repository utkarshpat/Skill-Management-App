import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
} from './support/interactions';
import type { RequestRecord } from '../src/request-model';

const { Requests } = component<typeof import('../src/Requests')>('Requests.tsx');
const record: RequestRecord = {
  id: 'reporting',
  reference: 'REQ-1042',
  category: 'PROJECT',
  kind: 'REQUEST',
  title: 'Confirm reporting assignment',
  description: 'Confirm delivery ownership for the reporting project.',
  priority: 'NORMAL',
  status: 'SUBMITTED',
  revision: 3,
  requesterName: 'Aditi Menon',
  recipientName: 'Rohan Mehta',
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-08T10:00:00Z',
  canComment: true,
  canCancel: false,
};
let current: RequestRecord, view: Awaited<ReturnType<typeof render>> | undefined;
let detailReads: number,
  listReads: number,
  detailFailure: number,
  writeFailure: number,
  canCreate: boolean;
let writes: Record<string, unknown>[];
beforeEach(async () => {
  current = { ...record };
  detailReads = listReads = detailFailure = writeFailure = 0;
  canCreate = true;
  writes = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url.startsWith('/api/workflows/options'))
      return Response.json({
        canRequest: canCreate,
        canIncident: false,
        categories: [{ code: 'PROJECT', kind: 'REQUEST' }],
        recipients: [],
      });
    if (url === '/api/workflows' && init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)));
      return writeFailure
        ? Response.json({ error: { message: 'Record changed' } }, { status: writeFailure })
        : Response.json({ ok: true });
    }
    if (url.startsWith('/api/workflows?')) {
      listReads++;
      return Response.json({
        items: [current],
        page: 1,
        pageSize: 25,
        total: 1,
        summary: {
          total: 1,
          submitted: 1,
          inProgress: 0,
          resolved: 0,
          myTotal: 1,
          assignedTotal: 0,
        },
      });
    }
    if (url.endsWith('/recipients?q=')) return Response.json({ recipients: [] });
    if (url === '/api/workflows/reporting') {
      detailReads++;
      return detailFailure
        ? Response.json(
            { error: { message: 'Current request access denied' } },
            { status: detailFailure },
          )
        : Response.json({
            record: current,
            events: Array.from({ length: 6 }, (_, i) => ({
              id: 'event-' + i,
              action: i ? 'COMMENT' : 'CREATE',
              body: 'Timeline entry ' + (i + 1),
              actorName: 'Rohan Mehta',
              at: record.updatedAt,
              revision: i + 1,
            })),
          });
    }
    throw Error('Unexpected request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

async function mount(url = '/requests?record=reporting') {
  view = await render(
    <MemoryRouter initialEntries={[url]}>
      <Requests />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
const detail = () => document.querySelector('.request-detail-grid')!;
const dialog = () => document.querySelector('.form-dialog')!;
async function notify(name: string) {
  await act(async () => window.dispatchEvent(new Event(name)));
  await settle();
}

test('request detail keeps timeline position until an explicit remote refresh and resets to the newest entries', async () => {
  await mount('/requests');
  const previousList = listReads;
  await notify('notifications-remote-updated');
  assert.ok(listReads > previousList);
  await click('Open REQ-1042');
  assert.match(detail().textContent!, /Timeline entry 6/);
  await click('Older', detail());
  assert.match(detail().textContent!, /Timeline entry 1/);
  await click('Newer', detail());
  await click('Older', detail());
  const previousDetail = detailReads;
  await notify('notifications-remote-updated');
  assert.equal(detailReads, previousDetail);
  assert.match(detail().textContent!, /Timeline entry 1/);
  await click('Refresh updates');
  assert.ok(detailReads > previousDetail);
  assert.match(detail().textContent!, /Timeline entry 6/);
  await click('Back to requests');
  assert.equal(detail(), null);
  assert.ok(document.querySelector('[aria-label="Open REQ-1042"]'));
});

test('request action conflict reloads the record and successful comment refreshes the detail', async () => {
  await mount();
  await click('Add comment', detail());
  await fill('Your comment', 'Delivery ownership was confirmed.');
  writeFailure = 409;
  await click('Post comment');
  assert.equal(writes[0].revision, 3);
  assert.match(dialog().textContent!, /Record changed/);
  current.revision = 4;
  await click('Reload record');
  assert.equal(dialog(), null);
  writeFailure = 0;
  await click('Add comment', detail());
  await fill('Your comment', 'Confirmed after refreshing the latest request.');
  const previous = detailReads;
  await click('Post comment');
  assert.equal(writes[1].revision, 4);
  assert.equal(dialog(), null);
  assert.ok(detailReads > previous);
});

test('request actions follow current server flags and dismiss without saving', async () => {
  current.canStart = true;
  current.canReassign = true;
  current.canCancel = true;
  await mount();
  for (const label of ['Start work', 'Reassign', 'Cancel request']) {
    await click(label, detail());
    const close = dialog().querySelector<HTMLButtonElement>('.form-dialog-header button')!;
    await act(async () => close.click());
    assert.equal(dialog(), null);
  }
  assert.equal(detail().querySelector('.request-actions')!.textContent!.includes('Resolve'), false);
  current = { ...current, status: 'IN_PROGRESS', canStart: false, canResolve: true };
  await notify('requests-updated');
  await click('Resolve', detail());
  const close = dialog().querySelector<HTMLButtonElement>('.form-dialog-header button')!;
  await act(async () => close.click());
  assert.equal(writes.length, 0);
});

test('request deep link recovers after denied detail and composer closes without creating a record', async () => {
  detailFailure = 403;
  await mount();
  assert.match(document.body.textContent!, /Current request access denied/);
  assert.equal(detail(), null);
  detailFailure = 0;
  await click('Retry');
  assert.match(detail().textContent!, /Confirm reporting assignment/);
  await click('New request');
  assert.ok(dialog());
  await click('Cancel', dialog());
  assert.equal(dialog(), null);
  assert.equal(writes.length, 0);
});
