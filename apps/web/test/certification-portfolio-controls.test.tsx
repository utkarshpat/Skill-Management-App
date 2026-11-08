import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  change,
} from './support/interactions';
const { Certifications } = component<typeof import('../src/certifications/Certifications')>(
  'certifications/Certifications.tsx',
);
let view: Awaited<ReturnType<typeof render>> | undefined;
let failure = 0;
let records: import('../src/certifications/types').CertificationRecord[];
let requests: string[] = [];
const record: import('../src/certifications/types').CertificationRecord = {
  id: 'f2718656-e761-401a-8a78-f16a00000001',
  revision: 3,
  personId: 'aditi',
  name: 'Aditi Menon',
  employeeCode: '710902',
  certificationName: 'Azure Fundamentals',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-12',
  expiryDate: null,
  credentialId: 'AZ-1042',
  credentialUrl: 'https://learn.microsoft.com/',
  notes: 'Completed cloud onboarding',
  status: 'APPROVED',
  feedback: 'Issuer details checked',
  reviewedBy: 'Rohan Mehta',
  reviewedAt: '2026-02-01T12:00:00Z',
  canReview: false,
  canEdit: false,
  canSubmit: false,
};
beforeEach(async () => {
  failure = 0;
  records = [{ ...record }];
  requests = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url === '/api/dev-login') return demoResponse();
    if (url.startsWith('/api/certifications?'))
      return failure
        ? Response.json(
            { error: { message: 'Current certification access is unavailable' } },
            { status: failure },
          )
        : Response.json({
            records,
            total: records.length,
            page: 1,
            pageSize: 100,
            snapshotRevision: 4,
            canManage: false,
            canSubmitNew: false,
            canReview: true,
          });
    if (url.startsWith('/api/capability-submissions/links/')) return Response.json({ links: [] });
    if (url.startsWith('/api/capability-submissions?')) return Response.json({ records: [] });
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
async function mount(path = '/certifications') {
  view = await render(
    <MemoryRouter initialEntries={[path]}>
      <Certifications />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}

test('credential portfolio opens read-only issuer details and navigates the authorized review view', async () => {
  await mount();
  await click('View Azure Fundamentals credential');
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Aditi|Azure Fundamentals/);
  assert.match(
    document.querySelector('.form-dialog')!.textContent!,
    /Manager feedback.*Issuer details checked/s,
  );
  const link = document.querySelector('.form-dialog a')!;
  assert.equal(link.getAttribute('href'), 'https://learn.microsoft.com/');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Rohan Mehta/);
  await click('Close');
  assert.equal(document.querySelector('.form-dialog'), null);
  await click('Assigned reviews');
  assert.ok(requests.some(url => url.includes('view=queue')));
  await click('My certifications');
  assert.ok(requests.filter(url => url.includes('view=mine')).length >= 2);
});

test('portfolio filters search and reset without inventing empty certifications', async () => {
  records.push({
    ...record,
    id: 'oracle',
    certificationName: 'Oracle Database SQL',
    provider: 'Oracle',
    category: 'Data',
    status: 'DRAFT',
    feedback: '',
    expiryDate: '2020-01-01',
  });
  await mount();
  await change(document.querySelector('[aria-label="Search your certifications"]')!, 'Oracle');
  assert.equal(document.querySelector('[aria-label="View Azure Fundamentals credential"]'), null);
  assert.ok(document.querySelector('[aria-label="View Oracle Database SQL credential"]'));
  await click('Clear search query');
  await change(document.querySelector('[aria-label="Filter certification category"]')!, 'Cloud');
  assert.equal(document.querySelector('[aria-label="View Oracle Database SQL credential"]'), null);
  await click('Clear certification filters');
  await change(document.querySelector('[aria-label="Filter credential validity"]')!, 'Expired');
  assert.equal(document.querySelector('[aria-label="View Azure Fundamentals credential"]'), null);
  await click('Clear certification filters');
  await change(
    document.querySelector('[aria-label="Filter certification review status"]')!,
    'REJECTED',
  );
  assert.equal(document.querySelector('tbody tr'), null);
  await click('Clear filters');
  assert.ok(document.querySelector('[aria-label="View Azure Fundamentals credential"]'));
});

test('revoked portfolio access clears credential details; explicit retry reads current data', async () => {
  await mount();
  await click('View Azure Fundamentals credential');
  failure = 403;
  await act(async () => window.dispatchEvent(new Event('notifications-remote-updated')));
  await settle();
  await settle();
  assert.equal(document.querySelector('.form-dialog'), null);
  assert.match(document.body.textContent!, /Current certification access is unavailable/);
  assert.equal(document.querySelector('[aria-label="View Azure Fundamentals credential"]'), null);
  failure = 0;
  records = [];
  await click('Retry');
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelector('[aria-label="View Azure Fundamentals credential"]'), null);
});
