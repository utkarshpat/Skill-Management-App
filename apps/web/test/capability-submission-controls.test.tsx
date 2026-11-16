import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { component, MemoryRouter, refreshDevelopmentLogin, click } from './support/interactions';
const { CapabilitySubmissions } = component<
  typeof import('../src/capabilities/CapabilitySubmissions')
>('capabilities/CapabilitySubmissions.tsx');

const root = '/api/capability-submissions';
const draft = {
  id: 'submission-1',
  label: 'SQL reporting and Azure',
  status: 'DRAFT',
  canEdit: true,
  revision: 7,
  skills: 1,
  certifications: 1,
};
let records: (typeof draft)[], view: Awaited<ReturnType<typeof render>> | undefined;
let readFailure: number, writeFailure: number, updated: number;
let writes: { url: string; revision: number }[];
beforeEach(async () => {
  records = [{ ...draft }];
  readFailure = writeFailure = updated = 0;
  writes = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    if (url === root + '?view=mine')
      return readFailure
        ? Response.json(
            { error: { message: 'Current draft access denied' } },
            { status: readFailure },
          )
        : Response.json({ records });
    if (url === root + '/' + draft.id + '/discard' || url === root + '/' + draft.id + '/restore') {
      assert.equal(init?.method, 'POST');
      const { revision } = JSON.parse(String(init?.body));
      writes.push({ url, revision });
      if (writeFailure)
        return Response.json(
          { error: { message: 'Draft revision changed' } },
          { status: writeFailure },
        );
      records = url.endsWith('/restore') ? [{ ...draft, revision: revision + 1 }] : [];
      return Response.json({ revision: revision + 1 });
    }
    throw Error('Unexpected submission request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount() {
  view = await render(
    <MemoryRouter>
      <CapabilitySubmissions onUpdated={() => updated++} />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
const dialog = () => document.querySelector('.form-dialog')!;

test('combined draft deletion requires confirmation and undo uses the returned revision', async () => {
  await mount();
  await click('Delete SQL reporting and Azure draft');
  await click('Keep draft', dialog());
  assert.deepEqual(writes, []);
  await click('Delete SQL reporting and Azure draft');
  await click('Delete draft', dialog());
  assert.equal(document.querySelector('.cap-submission-card'), null);
  assert.equal(updated, 1);
  await click('Undo');
  assert.deepEqual(writes, [
    { url: root + '/' + draft.id + '/discard', revision: 7 },
    { url: root + '/' + draft.id + '/restore', revision: 8 },
  ]);
  assert.match(
    document.querySelector('.cap-submission-card')!.textContent!,
    /SQL reporting and Azure/,
  );
  assert.equal(updated, 2);
});

test('failed draft deletion retains the record and fresh permission denial hides it until retry', async () => {
  await mount();
  writeFailure = 409;
  await click('Delete SQL reporting and Azure draft');
  await click('Delete draft', dialog());
  assert.ok(dialog());
  assert.equal(updated, 0);
  assert.ok(document.querySelector('.cap-submission-card'));
  await click('Close Delete submission draft?', dialog());
  readFailure = 403;
  await act(async () => window.dispatchEvent(new Event('own-skills-updated')));
  await settle();
  assert.equal(document.querySelector('.cap-submission-card'), null);
  assert.match(document.body.textContent!, /Current draft access denied/);
  readFailure = 0;
  await click('Retry');
  assert.ok(document.querySelector('.cap-submission-card'));
  assert.equal(writes.length, 1);
});

test('recent draft expansion does not expose submitted records in the personal draft list', async () => {
  records = Array.from({ length: 7 }, (_, i) => ({
    ...draft,
    id: 'submission-' + (i + 1),
    label: 'Reporting draft ' + (i + 1),
    status: i === 6 ? 'SUBMITTED' : 'DRAFT',
  }));
  await mount();
  const count = () => document.querySelectorAll('.cap-submission-card').length;
  assert.equal(count(), 5);
  await click('Show all recent submissions');
  assert.equal(count(), 6);
  assert.doesNotMatch(document.body.textContent!, /Reporting draft 7/);
  await click('Show fewer');
  assert.equal(count(), 5);
  assert.deepEqual(writes, []);
});
