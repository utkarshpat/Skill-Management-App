import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import { registerHooks } from 'node:module';
import { MemoryRouter } from 'react-router';
import { refreshDevelopmentLogin } from '../src/auth';
import { click, change } from './support/interactions';
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context);
  },
});
const { Certifications } = await import('../src/certifications/Certifications');
let view: Awaited<ReturnType<typeof render>> | undefined;
let failure = 0;
let canManage = false;
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
  canManage = false;
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
            canManage,
            canUploadImage: canManage,
            canSubmitNew: false,
            canReview: true,
          });
    if (url.startsWith('/api/capability-submissions/links/')) return Response.json({ links: [] });
    if (url.startsWith('/api/capability-submissions?')) return Response.json({ records: [] });
    if (url === '/api/capability-submissions/availability')
      return Response.json({ aiAvailable: false, fileAvailable: true });
    if (url === '/api/capability-submissions/options')
      return Response.json({ claims: [], certifications: records, definitions: [] });
    if (url.startsWith('/api/my-skills/catalogue?')) return Response.json({ skills: [], total: 0 });
    if (url.endsWith('/image')) return Response.json({ items: [] });
    throw Error('Unexpected request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(async () => {
  css.deregister();
  await closeBrowser();
});
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

async function waitForEditor(title: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const element = document.querySelector(`dialog[aria-label="${title}"]`);
    if (element) return element;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  }
  throw Error('Expected editor: ' + title);
}

test('approved expiring credential can start renewal from the list and from read-only details', async () => {
  canManage = true;
  records[0].expiryDate = '2026-01-31';
  await mount();
  await click('Record renewal for Azure Fundamentals');
  let editor = await waitForEditor('Renew certificate');
  assert.match(editor.textContent!, /Azure Fundamentals/);
  await click('Cancel', editor);
  await click('View Azure Fundamentals credential');
  await click('Record renewal', document.querySelector('.form-dialog-footer')!);
  editor = await waitForEditor('Renew certificate');
  assert.match(editor.textContent!, /Azure Fundamentals/);
  assert.equal(document.querySelector('dialog[aria-label="Azure Fundamentals"]'), null);
  await click('Cancel', editor);
  assert.equal(document.querySelector('dialog'), null);
});

test('editable credential opens the combined editor from details and the submit action', async () => {
  canManage = true;
  records[0] = { ...record, status: 'DRAFT', canEdit: true, canSubmit: true };
  await mount();
  await click('View Azure Fundamentals credential');
  await click('Edit details');
  let editor = await waitForEditor('Add skill');
  assert.match(editor.textContent!, /Azure Fundamentals/);
  await click('Cancel', editor);
  await click('Submit Azure Fundamentals for review');
  editor = await waitForEditor('Add skill');
  assert.match(editor.textContent!, /Azure Fundamentals/);
  await click('Cancel', editor);
  assert.equal(document.querySelector('dialog'), null);
});

test('recommendation entry can return to the personal portfolio without opening an editor', async () => {
  await mount('/certifications?tab=recommendations');
  assert.match(document.body.textContent!, /Recommendations from your manager/);
  await click('Back to my certifications');
  assert.ok(document.querySelector('[aria-label="View Azure Fundamentals credential"]'));
  assert.equal(document.querySelector('dialog'), null);
});

test('renewal deep link waits for an authorized portfolio and consumes the selected record once', async () => {
  canManage = true;
  records[0].expiryDate = '2026-01-31';
  await mount('/certifications?renew=' + record.id);
  const editor = await waitForEditor('Renew certificate');
  await click('Cancel', editor);
  const previous = requests.length;
  await act(async () => window.dispatchEvent(new Event('notifications-remote-updated')));
  await settle();
  assert.ok(requests.length > previous);
  assert.equal(document.querySelector('dialog'), null);
});

test('read-only portfolio cannot start renewal through a direct record link', async () => {
  records[0].expiryDate = '2026-01-31';
  await mount('/certifications?renew=' + record.id);
  assert.equal(
    document.querySelector('[aria-label="Record renewal for Azure Fundamentals"]'),
    null,
  );
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(requests.includes('/api/capability-submissions/options'), false);
});

test('credential pagination, status tabs and renewal attention apply independent filters', async () => {
  records.push(
    { ...record, id: 'draft', certificationName: 'Data Engineering Associate', status: 'DRAFT' },
    {
      ...record,
      id: 'expired',
      certificationName: 'Database Administrator',
      expiryDate: '2020-01-01',
    },
    ...[
      'Cloud Operations',
      'Network Engineer',
      'Security Engineer',
      'Data Analyst',
      'Platform Engineer',
      'Service Management',
      'Kubernetes Administrator',
      'Linux Engineer',
      'Solution Architect',
    ].map((certificationName, index) => ({
      ...record,
      certificationName,
      id: 'credential-' + index,
    })),
  );
  await mount();
  const rows = () => [...document.querySelectorAll('tbody tr')];
  assert.equal(rows().length, 10);
  await click('Next certifications page');
  assert.equal(rows().length, 2);
  await click('Previous certifications page');
  assert.equal(rows().length, 10);
  await click('Next certifications page');
  await change(
    document.querySelector<HTMLSelectElement>('[aria-label="Certifications per page"]')!,
    '25',
  );
  assert.equal(rows().length, 12);
  assert.equal(document.querySelector('.skills-current-page')!.textContent, '1');
  await click('Drafts: 1. Filter certifications');
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent!, /Data Engineering Associate/);
  await click('Reviewed', document.querySelector('.skills-list-tabs')!);
  assert.equal(rows().length, 11);
  const renewal = [...document.querySelectorAll('.skills-insight-card')].find(
    card => card.querySelector('h3')?.textContent === 'Renewal attention',
  )!;
  await click('Expired', renewal);
  assert.equal(rows().length, 1);
  assert.match(rows()[0].textContent!, /Database Administrator/);
  await click('Database Administrator');
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Database Administrator/);
});
