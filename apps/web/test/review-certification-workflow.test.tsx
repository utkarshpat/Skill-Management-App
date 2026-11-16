import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { refreshDevelopmentLogin } from '../src/auth';
import { click, change, fill } from './support/interactions';
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context);
  },
});
const { ReviewWorkspace } = await import('../src/ReviewWorkspace');
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
  status: 'SUBMITTED',
  feedback: '',
  submittedAt: '2026-11-08T10:00:00Z',
  canReview: true,
  canEdit: false,
  canSubmit: false,
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let reads: string[] = [],
  writes: any[] = [],
  failure = 0,
  writeFailure = 0,
  analyticsFailure = 0;
beforeEach(async () => {
  reads = [];
  writes = [];
  failure = 0;
  writeFailure = 0;
  analyticsFailure = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    reads.push(url);
    if (url === '/api/dev-login') return demoResponse();
    if (url.startsWith('/api/skill-reviews?'))
      return Response.json({
        claims: [],
        total: 0,
        pageSize: 10,
        canViewTeam: true,
        canRecommend: true,
        categories: [],
        summary: { pending: 0, approved: 0, changes: 0, rejected: 0 },
      });
    if (url.startsWith('/api/skill-reviews/team'))
      return Response.json({
        people: [],
        skills: [],
        total: 0,
        pageSize: 10,
        analytics: {
          members: 0,
          reviewed: 0,
          pending: 0,
          coverage: [],
          levels: [],
          categories: [],
        },
      });
    if (url.startsWith('/api/capability-submissions?')) return Response.json({ records: [] });
    if (url === '/api/certifications' && init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)));
      return writeFailure
        ? Response.json(
            { error: { message: 'Certification assignment changed' } },
            { status: writeFailure },
          )
        : Response.json({ ok: true });
    }
    if (url.startsWith('/api/certifications?'))
      return failure
        ? Response.json(
            { error: { message: 'Certificate queue unavailable' } },
            { status: failure },
          )
        : Response.json({
            records: [record],
            total: 3,
            pageSize: 1,
            canManage: false,
            canSubmitNew: false,
            canReview: true,
          });
    if (url.endsWith('/image')) return Response.json({ items: [] });
    if (url === '/api/certification-recommendations/analytics')
      return analyticsFailure
        ? Response.json(
            { error: { message: 'Certificate analytics unavailable' } },
            { status: analyticsFailure },
          )
        : Response.json({
            pending: 3,
            reviewed: 2,
            certifiedPeople: 1,
            expired: 0,
            expiresSoon: 0,
            noExpiry: 2,
            canRecommend: false,
            categories: [{ category: 'Cloud', count: 2 }],
          });
    if (url.startsWith('/api/recommendations?'))
      return Response.json({ items: [], total: 0, pageSize: 10, canSend: false });
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
async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 60 && !condition(); i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  }
  assert.ok(condition(), 'review did not settle');
}
async function mount() {
  view = await render(
    <MemoryRouter>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => Boolean(document.querySelector('.assigned-review-total')));
  await settle();
}

test('legacy certification queue pages and debounced search retain current review authorization', async () => {
  await mount();
  await click('Next page');
  assert.ok(reads.some(url => url.includes('/api/certifications?') && url.includes('page=2')));
  await click('Previous', document.querySelector('.assigned-review-pagination')!);
  await change(document.querySelector('[aria-label="Search employee or certification"]')!, 'Aditi');
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 340));
  });
  await settle();
  assert.ok(reads.some(url => url.includes('search=Aditi')));
  await click('Clear search');
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 340));
  });
  await settle();
  await click('Review certification');
  await fill('Review note', 'Verified supplied issuer details.');
  writeFailure = 409;
  await click('Approve with note');
  assert.match(document.body.textContent!, /Certification assignment changed/);
  writeFailure = 0;
  await click('Approve with note');
  assert.deepEqual(writes[0], writes[1]);
  assert.deepEqual(writes[1], {
    id: record.id,
    revision: 3,
    action: 'APPROVE',
    feedback: 'Verified supplied issuer details.',
  });
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('team certificate analytics retries its own source and does not imply recommendation permission', async () => {
  await mount();
  analyticsFailure = 503;
  await click('Team analytics');
  assert.match(document.body.textContent!, /Certificate analytics unavailable/);
  analyticsFailure = 0;
  await click('Retry', document.querySelector('.assigned-review-error')!);
  assert.match(
    document.querySelector('[aria-label="Supporting certificate analytics"]')!.textContent!,
    /Currently certified people/,
  );
  await click('Recommendations');
  assert.match(
    document.body.textContent!,
    /Certification recommendations are not available with your current access/,
  );
});
