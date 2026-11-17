import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { closeBrowser, deferred, render, settle } from './support/browser';
import { initializeAuth } from '../src/auth';

const cssHooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { ReviewWorkspace } = await import('../src/ReviewWorkspace');
after(async () => {
  cssHooks.deregister();
  await closeBrowser();
});
const skills = {
  claims: [],
  total: 0,
  pageSize: 10,
  canViewTeam: true,
  canRecommend: true,
  summary: { pending: 0, approved: 0, changes: 0, rejected: 0 },
};
async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (condition()) return;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  }
  assert.ok(condition(), 'Expected review state did not arrive');
}
function fixture() {
  const reads = new Map<string, ReturnType<typeof deferred<Response>>>();
  globalThis.fetch = async input => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/auth/config') return Response.json({ enabled: false });
    if (path === '/api/dev-login')
      return Response.json({ mode: 'local-demo', signedIn: true, people: [] });
    assert.ok(
      ['/api/skill-reviews', '/api/capability-submissions', '/api/certifications'].includes(path),
      path,
    );
    assert.ok(!reads.has(path), 'Initial queues should be requested once: ' + path);
    const pending = deferred<Response>();
    reads.set(path, pending);
    return pending.promise;
  };
  return reads;
}
async function resolve(
  reads: ReturnType<typeof fixture>,
  path: string,
  data: unknown,
  status = 200,
) {
  await act(async () => reads.get(path)!.resolve(Response.json(data, { status })));
  await settle();
}
test('initial queues read in parallel and show combined submissions before slower queues settle', async () => {
  const reads = fixture();
  await initializeAuth();
  const view = await render(
    <MemoryRouter>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  const content = () => document.querySelector<HTMLElement>('.review-workspace-content')!;
  assert.equal(content().hidden, false);
  assert.match(content().textContent ?? '', /Loading review requests/);
  assert.equal(document.querySelector('.assigned-review-total'), null);
  await resolve(reads, '/api/capability-submissions', { records: [] });
  assert.match(content().textContent ?? '', /All caught up/);
  await resolve(reads, '/api/skill-reviews', skills);
  assert.equal(content().hidden, false);
  await resolve(reads, '/api/certifications', { records: [], total: 0, pageSize: 10 });
  assert.equal(content().hidden, false);
  assert.equal(document.querySelectorAll('.review-workspace-tabs button').length, 3);
  assert.match(content().textContent ?? '', /All caught up/);
  assert.equal(document.querySelector('.assigned-review-total'), null);
  assert.equal(document.querySelector<HTMLDetailsElement>('.review-legacy-history')!.open, true);
  assert.equal(reads.size, 3);
  await view.unmount();
});
test('failed combined queue shows its error while other queues stay visible', async () => {
  const reads = fixture();
  await initializeAuth();
  const view = await render(
    <MemoryRouter>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  await resolve(reads, '/api/skill-reviews', {
    ...skills,
    canViewTeam: false,
    canRecommend: false,
  });
  await resolve(reads, '/api/certifications', { records: [], total: 0, pageSize: 10 });
  await resolve(
    reads,
    '/api/capability-submissions',
    { error: { message: 'Combined queue unavailable.' } },
    503,
  );
  const content = document.querySelector<HTMLElement>('.review-workspace-content')!;
  assert.equal(content.hidden, false);
  assert.match(
    content.querySelector('[role="alert"]')!.textContent ?? '',
    /Combined queue unavailable/,
  );
  assert.doesNotMatch(content.textContent ?? '', /All caught up/);
  assert.equal(document.querySelectorAll('.review-workspace-tabs button').length, 1);
  await view.unmount();
});
test('review permission failure reveals only the error and retry, never resolved child content or privileged tabs', async () => {
  const reads = fixture();
  await initializeAuth();
  const view = await render(
    <MemoryRouter>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  await resolve(reads, '/api/capability-submissions', { records: [] });
  await resolve(reads, '/api/certifications', { records: [], total: 0, pageSize: 10 });
  await resolve(
    reads,
    '/api/skill-reviews',
    { error: { message: 'Review permission denied.' } },
    403,
  );
  assert.equal(document.querySelector<HTMLElement>('.review-workspace-content')!.hidden, true);
  const alert = [...document.querySelectorAll<HTMLElement>('[role="alert"]')].find(
    node => !node.closest('[hidden]'),
  );
  assert.match(alert?.textContent ?? '', /Review permission denied.*Retry/);
  assert.equal(document.querySelector('.review-loading'), null);
  await view.unmount();
});
test('reviewers without certification access do not request or wait for that queue', async () => {
  const reads = fixture();
  await initializeAuth();
  const view = await render(
    <MemoryRouter>
      <ReviewWorkspace />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 2);
  await resolve(reads, '/api/skill-reviews', {
    ...skills,
    canViewTeam: false,
    canRecommend: false,
  });
  await resolve(reads, '/api/capability-submissions', { records: [] });
  assert.equal(reads.has('/api/certifications'), false);
  assert.equal(document.querySelector<HTMLElement>('.review-workspace-content')!.hidden, false);
  await view.unmount();
});
function permissiveFixture(extra: (path: string) => boolean) {
  const reads = new Map<string, ReturnType<typeof deferred<Response>>>();
  const other: string[] = [];
  globalThis.fetch = async input => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/auth/config') return Response.json({ enabled: false });
    if (path === '/api/dev-login')
      return Response.json({ mode: 'local-demo', signedIn: true, people: [] });
    if (
      !reads.has(path) &&
      ['/api/skill-reviews', '/api/capability-submissions', '/api/certifications'].includes(path)
    ) {
      const pending = deferred<Response>();
      reads.set(path, pending);
      return pending.promise;
    }
    assert.ok(extra(path), 'Unexpected request: ' + path);
    other.push(path);
    if (path.endsWith('/image')) return Response.json({ items: [] });
    return new Promise<Response>(() => {});
  };
  return { reads, other };
}
const linkedId = 'f2718656-e761-401a-8a78-f16a00000001';
const certification = {
  id: linkedId,
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
  notes: '',
  status: 'SUBMITTED',
  feedback: '',
  submittedAt: '2026-01-13T00:00:00Z',
  canReview: true,
  canEdit: false,
  canSubmit: false,
};
test('transient legacy review outage keeps the combined workspace usable', async () => {
  const reads = fixture();
  await initializeAuth();
  const view = await render(
    <MemoryRouter>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  await resolve(reads, '/api/capability-submissions', { records: [] });
  await resolve(reads, '/api/certifications', { records: [], total: 0, pageSize: 10 });
  await resolve(
    reads,
    '/api/skill-reviews',
    { error: { message: 'Review database is waking up.' } },
    503,
  );
  const content = document.querySelector<HTMLElement>('.review-workspace-content')!;
  assert.equal(content.hidden, false);
  assert.match(content.textContent ?? '', /All caught up/);
  assert.match(document.body.textContent ?? '', /Review database is waking up.*Retry/);
  await view.unmount();
});
test('review permission denial closes and blocks a submission deep-link dialog', async () => {
  const submission = '2b5a1c9e-1111-4a2b-8c3d-000000000001';
  const { reads, other } = permissiveFixture(path =>
    path.startsWith('/api/capability-submissions/'),
  );
  await initializeAuth();
  const view = await render(
    <MemoryRouter initialEntries={['/skill-reviews?submission=' + submission]}>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  await resolve(reads, '/api/capability-submissions', { records: [] });
  await resolve(reads, '/api/certifications', { records: [], total: 0, pageSize: 10 });
  await resolve(
    reads,
    '/api/skill-reviews',
    { error: { message: 'Review permission denied.' } },
    403,
  );
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.querySelector<HTMLElement>('.review-workspace-content')!.hidden, true);
  assert.ok(other.every(path => path.includes(submission)));
  await view.unmount();
});
test('certification notification link opens from the authorized queue after a transient failure', async () => {
  const { reads } = permissiveFixture(path => path.startsWith('/api/certifications/' + linkedId));
  await initializeAuth();
  const view = await render(
    <MemoryRouter initialEntries={['/skill-reviews?certification=' + linkedId.toUpperCase()]}>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  await resolve(reads, '/api/skill-reviews', skills);
  await resolve(reads, '/api/capability-submissions', { records: [] });
  await resolve(reads, '/api/certifications', { error: { message: 'Queue unavailable.' } }, 503);
  assert.equal(document.querySelector('dialog'), null);
  const retry = document.querySelector<HTMLButtonElement>('.assigned-review-error button');
  assert.ok(retry);
  reads.delete('/api/certifications');
  await act(async () => retry.click());
  await waitFor(() => reads.has('/api/certifications'));
  await resolve(reads, '/api/certifications', {
    records: [certification],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  await waitFor(() => Boolean(document.querySelector('dialog')));
  assert.match(document.querySelector('dialog')!.textContent ?? '', /Azure Fundamentals/);
  await view.unmount();
});
test('certification notification link without a reviewable record opens nothing', async () => {
  const { reads, other } = permissiveFixture(() => false);
  await initializeAuth();
  const view = await render(
    <MemoryRouter
      initialEntries={['/skill-reviews?certification=f2718656-e761-401a-8a78-f16a00000002']}
    >
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  await resolve(reads, '/api/skill-reviews', skills);
  await resolve(reads, '/api/capability-submissions', { records: [] });
  await resolve(reads, '/api/certifications', {
    records: [certification],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  assert.equal(document.querySelector('dialog'), null);
  assert.deepEqual(other, []);
  await view.unmount();
});
