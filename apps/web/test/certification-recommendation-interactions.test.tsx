import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  MemoryRouter,
  refreshDevelopmentLogin,
  component,
  click,
  fill,
} from './support/interactions';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const { CertificationRecommendations } = component<
  typeof import('../src/certifications/CertificationRecommendations')
>('certifications/CertificationRecommendations.tsx');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employee = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const original = {
  id,
  revision: 2,
  personId: employee,
  personName: 'Aditi Menon',
  employeeCode: 'EMP-1042',
  senderName: 'Rohan Mehta',
  certificationName: 'Oracle Database SQL',
  provider: 'Oracle',
  category: 'Databases',
  reason: 'Customer reporting delivery needs stronger SQL credentials',
  credentialUrl: 'https://education.oracle.com/',
  targetDate: '2026-12-01',
  status: 'PENDING',
  response: '',
  canRespond: true,
  updatedAt: '2026-11-05T05:00:00Z',
};
let record: any,
  readFailure = 0,
  writeFailure = 0,
  lookupFailure = false,
  total = 1,
  writes: { path: string; body: any }[] = [],
  reads: string[] = [],
  mounted: Awaited<ReturnType<typeof render>> | undefined;
beforeEach(async () => {
  record = structuredClone(original);
  readFailure = 0;
  writeFailure = 0;
  lookupFailure = false;
  total = 1;
  writes = [];
  reads = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    reads.push(path);
    if (path === '/api/dev-login') return demoResponse();
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (writeFailure)
        return Response.json(
          { error: { message: 'Current recommendation changed' } },
          { status: writeFailure },
        );
      return Response.json({ saved: true });
    }
    if (path.startsWith('/api/certification-recommendations/people'))
      return lookupFailure
        ? Response.json({ error: { message: 'Direct report lookup unavailable' } }, { status: 503 })
        : Response.json({
            people: [{ id: employee, name: 'Aditi Menon', employeeCode: 'EMP-1042' }],
          });
    assert.ok(path.startsWith('/api/certification-recommendations?'), path);
    const page = Number(new URL(path, 'http://localhost').searchParams.get('page') ?? 1);
    return readFailure
      ? Response.json(
          { error: { message: 'Recommendation access unavailable' } },
          { status: readFailure },
        )
      : Response.json({ items: [record], total, page, pageSize: 20, canSend: true });
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(sentOnly = false) {
  mounted = await render(
    <MemoryRouter>
      <CertificationRecommendations sentOnly={sentOnly} />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}

test('credential suggestions keep one write identity across an unconfirmed unchanged send', async () => {
  await mount(true);
  await click('Recommend a certification');
  await fill('Find direct report', 'Aditi');
  await fill('Direct report', employee);
  await fill('Certification name', 'Oracle Database SQL');
  await fill('Issuer', 'Oracle');
  await fill('Category', 'Databases');
  await fill('Why are you recommending it?', 'Supports Northstar customer reporting delivery');
  await fill('Credential information link', 'https://education.oracle.com/');
  await fill('Suggested target date', '2026-12-01');
  writeFailure = 503;
  await click('Send recommendation');
  assert.match(document.body.textContent!, /Send status could not be confirmed/);
  writeFailure = 0;
  await click('Send recommendation');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[1].body.personId, employee);
  assert.equal(writes[1].body.certificationName, 'Oracle Database SQL');
  assert.equal(writes[1].body.targetDate, '2026-12-01');
  assert.equal('reviewerId' in writes[1].body, false);
  assert.equal(document.querySelector('.form-dialog'), null);
});
test('a conflicted response requires exact-record recheck and the fresh revision before it can be retried', async () => {
  await mount();
  await click('Respond');
  const discuss = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    b => b.textContent?.trim() === 'Ask to discuss',
  );
  assert.ok(discuss?.disabled);
  await fill('Your response', 'Please align the credential target with the delivery schedule');
  writeFailure = 409;
  await click('Ask to discuss');
  assert.match(document.body.textContent!, /Check its current status/);
  assert.ok(discuss.disabled);
  record = { ...record, revision: 3 };
  writeFailure = 0;
  await click('Check current status');
  assert.equal(
    document.querySelector<HTMLTextAreaElement>('.form-dialog textarea')?.value,
    'Please align the credential target with the delivery schedule',
  );
  await click('Ask to discuss');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.revision, 2);
  assert.equal(writes[1].body.revision, 3);
  assert.equal(writes[1].body.id, id);
  assert.equal(writes[1].body.action, 'DISCUSS');
  assert.ok(reads.some(path => path.includes('view=received&id=' + id)));
});
test('response reconciliation can discover a committed outcome without replaying an acceptance', async () => {
  await mount();
  await click('Respond');
  writeFailure = 503;
  await click('Accept recommendation');
  assert.match(document.body.textContent!, /could not be confirmed/);
  record = {
    ...record,
    revision: 3,
    status: 'ACCEPTED',
    canRespond: false,
    response: 'Accepted after reviewing the reporting delivery schedule',
  };
  writeFailure = 0;
  await click('Check current status');
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Accepted after reviewing/);
  assert.doesNotMatch(
    document.querySelector('.form-dialog-footer')!.textContent!,
    /Accept recommendation|Ask to discuss|Decline/,
  );
  assert.equal(writes.length, 1);
  await click('Close');
  assert.equal(document.querySelector('.form-dialog'), null);
});
test('revocation clears response details and list pagination remains a current-server query', async () => {
  total = 21;
  await mount();
  await click('Next', document);
  assert.ok(reads.some(path => path.includes('page=2')));
  await click('Respond');
  writeFailure = 403;
  await click('Decline');
  assert.equal(document.querySelector('.form-dialog'), null);
  assert.doesNotMatch(
    document.querySelector('.recommendation-list')!.textContent!,
    /Oracle Database SQL/,
  );
  assert.match(document.body.textContent!, /Current recommendation changed/);
  assert.equal(writes.length, 1);
});
test('a failed direct-report lookup cannot retain a recipient from an earlier search', async () => {
  await mount(true);
  await click('Recommend a certification');
  await fill('Direct report', employee);
  await fill('Certification name', 'Oracle Database SQL');
  await fill('Why are you recommending it?', 'Customer reporting delivery');
  lookupFailure = true;
  await fill('Find direct report', 'unavailable');
  assert.match(document.body.textContent!, /Direct report lookup unavailable/);
  const send = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    b => b.textContent?.trim() === 'Send recommendation',
  );
  assert.ok(send?.disabled);
  assert.equal(document.querySelector<HTMLSelectElement>('.cert-recommend-form select')?.value, '');
  assert.equal(writes.length, 0);
  await click('Cancel');
  assert.equal(document.querySelector('.form-dialog'), null);
});
