import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import { component, refreshDevelopmentLogin, click } from './support/interactions';
const { ClaimEvidence } = component<typeof import('../src/ClaimEvidence')>('ClaimEvidence.tsx');
const claim = {
  id: 'aditi-sql-claim',
  revision: 5,
  status: 'DRAFT',
  evidence:
    'Delivery notes https://delivery.example/report javascript:alert(1) http://insecure.example',
} as import('../src/MySkills').Claim;
const item = {
  id: 'delivery-file',
  bytes: 12,
  width: null,
  height: null,
  mimeType: 'application/pdf',
  fileName: 'report-tests.pdf',
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let items: any[] = [],
  readFailure = 0,
  writeFailure = 0,
  binaryFailure = 0,
  canUpload = true;
let requests: { url: string; init?: RequestInit }[] = [],
  revisions: number[] = [],
  busy: boolean[] = [],
  promoted: File[] = [],
  revoked: string[] = [];
let pending: ReturnType<typeof deferred<Response>> | undefined;
beforeEach(async () => {
  items = [];
  readFailure = 0;
  writeFailure = 0;
  binaryFailure = 0;
  canUpload = true;
  requests = [];
  revisions = [];
  busy = [];
  promoted = [];
  revoked = [];
  pending = undefined;
  mock.method(URL, 'createObjectURL', () => 'blob:private-evidence');
  mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(String(url)));
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    requests.push({ url, init });
    if (init?.method === 'POST') {
      if (pending) return pending.promise;
      if (writeFailure)
        return Response.json(
          { error: { message: 'Evidence revision changed' } },
          { status: writeFailure },
        );
      items = [item];
      return Response.json({ revision: 6, canUpload, items });
    }
    if (url.endsWith('/evidence'))
      return readFailure
        ? Response.json({ error: { message: 'Evidence access denied' } }, { status: readFailure })
        : Response.json({ revision: 5, canUpload, items });
    if (url.includes('/evidence/'))
      return binaryFailure
        ? new Response('', { status: binaryFailure })
        : new Response('private-file', { headers: { 'Content-Type': 'application/pdf' } });
    throw Error('Unexpected evidence request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(reviewer = false) {
  view = await render(
    <ClaimEvidence
      claim={claim}
      reviewer={reviewer}
      onRevision={value => revisions.push(value)}
      onBusy={value => busy.push(value)}
      onUseAsCertificate={value => promoted.push(value)}
    />,
  );
  await settle();
  await settle();
}
async function upload(value: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [value] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await settle();
  await settle();
}

test('evidence upload validates the file, preserves failure recovery and advances only a confirmed revision', async () => {
  await mount();
  assert.equal(document.querySelectorAll('.claim-evidence-links a').length, 1);
  assert.equal(
    document.querySelector('.claim-evidence-links a')!.getAttribute('rel'),
    'noopener noreferrer',
  );
  await upload(new File([], 'empty.pdf', { type: 'application/pdf' }));
  assert.equal(requests.filter(r => r.init?.method === 'POST').length, 0);
  assert.match(document.body.textContent!, /up to 10 MB/);
  writeFailure = 409;
  await upload(new File(['%PDF-evidence'], 'report-tests.pdf', { type: 'application/pdf' }));
  assert.match(document.body.textContent!, /Evidence revision changed/);
  assert.deepEqual(revisions, []);
  writeFailure = 0;
  await upload(new File(['%PDF-evidence'], 'report-tests.pdf', { type: 'application/pdf' }));
  assert.deepEqual(revisions, [6]);
  assert.deepEqual(busy, [true, false, true, false, true, false]);
  const posts = requests.filter(r => r.init?.method === 'POST');
  assert.equal(new Headers(posts[1].init!.headers).get('X-Claim-Revision'), '5');
  assert.equal(new Headers(posts[1].init!.headers).get('X-Evidence-File-Name'), 'report-tests.pdf');
  assert.ok(document.querySelector('[aria-label="View report-tests.pdf"]'));
});

test('reviewer evidence uses the review endpoint without upload or certificate promotion actions', async () => {
  items = [item];
  await mount(true);
  assert.ok(requests.every(r => r.url.startsWith('/api/skill-reviews/')));
  assert.equal(document.querySelector('input[type="file"]'), null);
  assert.equal(
    [...document.querySelectorAll('button')].some(b =>
      b.textContent?.includes('Use as certificate'),
    ),
    false,
  );
  assert.match(document.body.textContent!, /latest submission/);
  await view!.unmount();
  view = undefined;
  assert.deepEqual(revoked, ['blob:private-evidence']);
});

test('metadata denial retries explicitly and six files disable further uploads', async () => {
  readFailure = 403;
  await mount();
  assert.match(document.body.textContent!, /Evidence access denied/);
  assert.equal(document.querySelector('input[type="file"]'), null);
  readFailure = 0;
  items = Array.from({ length: 6 }, (_, i) => ({
    ...item,
    id: 'evidence-' + i,
    mimeType: 'image/webp',
    width: 800,
    height: 600,
  }));
  await click('Retry files');
  assert.equal(document.querySelector<HTMLInputElement>('input[type="file"]')!.disabled, true);
  assert.equal(document.querySelectorAll('.claim-image-preview').length, 6);
  assert.match(document.body.textContent!, /800 × 600/);
});

test('certificate promotion rereads the exact private file and a failed file read does not promote', async () => {
  items = [item];
  await mount();
  await click('Use as certificate');
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].name, 'report-tests.pdf');
  assert.equal(await promoted[0].text(), 'private-file');
  assert.equal(promoted[0].type, 'application/pdf');
  binaryFailure = 403;
  await click('Use as certificate');
  assert.equal(promoted.length, 1);
  assert.equal(document.querySelector<HTMLButtonElement>('button')!.disabled, false);
});

test('leaving during an evidence upload aborts it and ignores its late revision', async () => {
  await mount();
  pending = deferred<Response>();
  await upload(new File(['%PDF-evidence'], 'report-tests.pdf', { type: 'application/pdf' }));
  const request = requests.find(r => r.init?.method === 'POST')!;
  await view!.unmount();
  view = undefined;
  assert.equal(request.init!.signal!.aborted, true);
  await act(async () =>
    pending!.resolve(Response.json({ revision: 6, items: [item], canUpload: true })),
  );
  await settle();
  assert.deepEqual(revisions, []);
});
