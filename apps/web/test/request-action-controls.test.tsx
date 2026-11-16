import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { component, refreshDevelopmentLogin, click, fill } from './support/interactions';
const { RequestActionDialog } =
  component<typeof import('../src/RequestActionDialog')>('RequestActionDialog.tsx');
const record: import('../src/request-model').RequestRecord = {
  id: 'request-aditi',
  reference: 'REQ-1042',
  category: 'PROFILE_ACCESS',
  kind: 'REQUEST',
  title: 'Correct reporting assignment',
  description: 'Please update the project assignment.',
  priority: 'NORMAL',
  status: 'SUBMITTED',
  revision: 7,
  requesterName: 'Aditi Menon',
  recipientName: 'Rohan Mehta',
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-08T10:00:00Z',
  canComment: true,
  canCancel: true,
  canStart: true,
  canResolve: true,
  canReassign: true,
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let writes: { url: string; body: any }[] = [];
let failure = 0;
beforeEach(async () => {
  writes = [];
  failure = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url.includes('/recipients?'))
      return Response.json({
        recipients: ['Priya Nair', 'Karan Shah', 'Neha Rao', 'Arjun Singh', 'Meera Joshi'].map(
          (name, i) => ({ id: 'person-' + i, name, kind: 'REQUEST', reportingManager: false }),
        ),
      });
    assert.ok(init?.method === 'POST');
    writes.push({ url, body: JSON.parse(String(init.body)) });
    if (failure)
      return Response.json(
        { error: { message: 'Record changed. Reload before retrying.' } },
        { status: failure },
      );
    return Response.json(
      url === '/api/assistant/workflow-draft'
        ? { body: 'The project mapping has been checked and corrected.' }
        : { ok: true },
    );
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
for (const [action, label, confirm] of [
  ['COMMENT', 'Your comment', 'Post comment'],
  ['START', 'Work plan', 'Confirm start'],
  ['RESOLVE', 'Resolution note', 'Confirm resolution'],
  ['CANCEL', 'Cancellation reason', 'Confirm cancellation'],
] as const) {
  test(`${action} requires an explicit note and saves the exact record revision`, async () => {
    let saved = 0;
    view = await render(
      <RequestActionDialog
        record={record}
        action={action}
        onClose={() => {}}
        onReload={() => {}}
        onSaved={() => saved++}
      />,
    );
    const button = [...document.querySelectorAll('button')].find(b =>
      b.textContent?.includes(confirm),
    )!;
    assert.equal(button.disabled, true);
    assert.equal(writes.length, 0);
    await fill(label, '  Assignment checked with the delivery team.  ');
    await click(confirm);
    assert.equal(saved, 1);
    assert.equal(writes[0].url, '/api/workflows');
    assert.equal(writes[0].body.action, action);
    assert.equal(writes[0].body.revision, 7);
    assert.equal(writes[0].body.id, record.id);
    assert.equal(writes[0].body.body, '  Assignment checked with the delivery team.  ');
    assert.match(writes[0].body.eventId, /^[0-9a-f-]{36}$/);
  });
}
test('AI draft requires explicit use and confirmation; retry preserves the event identity and note', async () => {
  let saved = 0,
    reloads = 0;
  view = await render(
    <RequestActionDialog
      record={record}
      action="RESOLVE"
      onClose={() => {}}
      onReload={() => reloads++}
      onSaved={() => saved++}
    />,
  );
  await fill('Resolution note', 'Checked the project mapping.');
  await click('Draft with AI');
  await click('Generate draft');
  assert.equal(writes[0].url, '/api/assistant/workflow-draft');
  assert.deepEqual(writes[0].body, {
    id: record.id,
    revision: 7,
    action: 'RESOLVE',
    notes: 'Checked the project mapping.',
  });
  assert.equal(saved, 0);
  await fill('Review AI draft', 'Project mapping corrected after delivery manager confirmation.');
  await click('Use draft');
  assert.equal(saved, 0);
  assert.equal(writes.length, 1);
  failure = 409;
  await click('Confirm resolution');
  assert.equal(saved, 0);
  assert.match(document.body.textContent!, /Record changed/);
  await click('Reload record');
  assert.equal(reloads, 1);
  assert.equal(
    document.querySelector('textarea')!.value,
    'Project mapping corrected after delivery manager confirmation.',
  );
  failure = 0;
  await click('Confirm resolution');
  assert.equal(saved, 1);
  assert.deepEqual(writes[1], writes[2]);
});

test('reassignment pages through recipients and preserves selected person when editing the handoff', async () => {
  let saved = 0;
  view = await render(
    <RequestActionDialog
      record={record}
      action="REASSIGN"
      onClose={() => {}}
      onReload={() => {}}
      onSaved={() => saved++}
    />,
  );
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 280));
  });
  await settle();
  await click('Next recipient results');
  assert.match(document.body.textContent!, /Meera Joshi/);
  await act(async () =>
    (document.querySelector('input[type="radio"]') as HTMLInputElement).click(),
  );
  await click('Next');
  await fill('Handoff note', 'Please confirm the reporting assignment for the delivery team.');
  await click('Back');
  assert.match(document.body.textContent!, /Selected: Meera Joshi/);
  await click('Next');
  assert.match(document.querySelector('textarea')!.value, /reporting assignment/);
  await click('Confirm reassignment');
  assert.equal(saved, 1);
  assert.equal(writes[0].body.recipientId, 'person-4');
  assert.equal(writes[0].body.action, 'REASSIGN');
});

test('reassignment search resets recipient pagination without changing the stored recipient', async () => {
  view = await render(
    <RequestActionDialog
      record={record}
      action="REASSIGN"
      onClose={() => {}}
      onReload={() => {}}
      onSaved={() => assert.fail('Unexpected save')}
    />,
  );
  const waitForSearch = async () => {
    await act(async () => new Promise(resolve => setTimeout(resolve, 280)));
    await settle();
  };
  await waitForSearch();
  await click('Next recipient results');
  await click('Previous recipient results');
  const search = document.querySelector<HTMLInputElement>('input[placeholder^="Search a person"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(
      search,
      'Priya',
    );
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await waitForSearch();
  assert.equal(search.value, 'Priya');
  assert.equal(
    document.querySelector<HTMLButtonElement>('button[aria-label="Previous recipient results"]')!
      .disabled,
    true,
  );
  assert.equal(writes.length, 0);
});

test('editing AI draft facts requires regeneration before they can be applied', async () => {
  view = await render(
    <RequestActionDialog
      record={record}
      action="RESOLVE"
      onClose={() => {}}
      onReload={() => {}}
      onSaved={() => assert.fail('Unexpected save')}
    />,
  );
  await fill('Resolution note', 'Delivery team checked the old mapping.');
  await click('Draft with AI');
  await click('Generate draft');
  await click('Edit facts and regenerate');
  await fill('Facts for the draft', 'The manager confirmed the new mapping.');
  await click('Generate draft');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(w => w.url === '/api/assistant/workflow-draft'));
  assert.equal(writes[1].body.notes, 'The manager confirmed the new mapping.');
});
