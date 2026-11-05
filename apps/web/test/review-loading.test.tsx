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
test('initial queues read in parallel and reveal a complete layout once, without temporary credential cards or single-tab navigation', async () => {
  const reads = fixture();
  await initializeAuth();
  const view = await render(
    <MemoryRouter>
      <ReviewWorkspace certificationsAllowed />
    </MemoryRouter>,
  );
  await waitFor(() => reads.size === 3);
  const content = () => document.querySelector<HTMLElement>('.review-workspace-content')!;
  assert.equal(content().hidden, true);
  assert.match(
    document.querySelector('.review-loading')!.textContent ?? '',
    /Checking your permissions/,
  );
  assert.equal(document.querySelector('.assigned-review-total'), null);
  await resolve(reads, '/api/capability-submissions', { records: [] });
  assert.equal(content().hidden, true);
  await resolve(reads, '/api/skill-reviews', skills);
  assert.equal(content().hidden, true);
  await resolve(reads, '/api/certifications', { records: [], total: 0, pageSize: 10 });
  assert.equal(content().hidden, false);
  assert.equal(document.querySelectorAll('.review-workspace-tabs button').length, 3);
  assert.match(content().textContent ?? '', /All caught up/);
  assert.equal(document.querySelector('.assigned-review-total'), null);
  assert.equal(document.querySelector<HTMLDetailsElement>('.review-legacy-history')!.open, true);
  assert.equal(reads.size, 3);
  await view.unmount();
});
test('failed queue reads settle the shared loader into explicit errors, not an invented empty queue', async () => {
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
