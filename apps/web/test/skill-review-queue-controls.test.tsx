import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRequire } from 'node:module';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  change,
} from './support/interactions';
import type { Claim } from '../src/MySkills';
import type { ClaimReviewDecision } from '../src/ClaimReviewAccess';

const { useLocation } = createRequire(import.meta.url)(
  'react-router',
) as typeof import('react-router');
const { SkillReviews } = component<typeof import('../src/SkillReviews')>('SkillReviews.tsx');
const claim: Claim = {
  id: 'reporting-sql',
  revision: 7,
  personId: 'aditi',
  personName: 'Aditi Menon',
  skillId: 'sql',
  skillName: 'SQL reporting',
  category: 'Data',
  definitionRevision: 3,
  rank: 3,
  levelName: 'Experienced',
  experienceMonths: 18,
  description: 'Reconciled customer reporting totals before month end.',
  status: 'SUBMITTED',
  updatedAt: '2026-11-08T10:00:00Z',
};
const feedback = 'The reconciliation matches the delivery evidence.';
let view: Awaited<ReturnType<typeof render>> | undefined;
let queue: URLSearchParams[], details: string[], writes: unknown[];
let failure: number, denied: boolean, historical: boolean, combined: boolean, writeFailure: number;
let team: boolean, emptyQueue: boolean;

function Query() {
  return <output data-query>{useLocation().search}</output>;
}

beforeEach(async () => {
  queue = [];
  details = [];
  writes = [];
  failure = writeFailure = 0;
  denied = combined = team = emptyQueue = false;
  historical = true;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    if (path === '/api/dev-login') return demoResponse();
    if (path === '/api/skill-reviews/team')
      return Response.json({
        people: [
          { id: 'aditi', name: 'Aditi Menon', employeeCode: '710902', reviewed: 0, pending: 1 },
        ],
        skills: [],
        total: 1,
        pageSize: 25,
      });
    if (path === '/api/skill-reviews') {
      queue.push(url.searchParams);
      if (failure)
        return Response.json(
          { error: { message: 'Queue permission unavailable' } },
          { status: failure },
        );
      const filtered = url.searchParams.get('search') === 'no match';
      return Response.json({
        claims: filtered || emptyQueue ? [] : [claim],
        total: filtered || emptyQueue ? 0 : 2,
        canViewTeam: team,
        pageSize: 1,
        canReadHistory: historical,
        categories: ['Data'],
        summary: { pending: 1, approved: 1, changes: 0, rejected: 0 },
      });
    }
    if (path === '/api/skill-reviews/decision') {
      writes.push(JSON.parse(String(init?.body)));
      return writeFailure
        ? Response.json(
            { error: { message: 'Reviewer assignment changed' } },
            { status: writeFailure },
          )
        : Response.json({ ok: true });
    }
    if (path.endsWith('/evidence'))
      return Response.json({ revision: 7, canUpload: false, items: [] });
    if (path.startsWith('/api/capability-submissions/links/')) return Response.json({ links: [] });
    if (path === '/api/assistant') return Response.json({ configured: false });
    if (path === '/api/skill-reviews/reporting-sql' && url.searchParams.has('page'))
      return Response.json({ history: [], total: 0, pageSize: 10 });
    if (path.startsWith('/api/skill-reviews/')) {
      details.push(path);
      const reviewAccess: ClaimReviewDecision = {
        allowed: !denied,
        reasonCode: denied ? 'EXPLICIT_DENY' : 'REPORTING_POLICY',
        summaryOnly: false,
        resource: { type: 'SKILL_CLAIM', id: claim.id, revision: claim.revision },
        resolvedScope: { kind: 'DIRECT_REPORTS', actorId: 'rohan' },
        constraints: [],
        sources: [],
      };
      return Response.json({
        claim: { ...claim, ...(combined ? { activeSubmissionId: 'submission-42' } : {}) },
        reviewAccess,
      });
    }
    throw Error('Unexpected review request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

async function mount(path = '/skill-reviews', unified = false) {
  view = await render(
    <MemoryRouter initialEntries={[path]}>
      <SkillReviews unified={unified} />
      <Query />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
const dialog = () => document.querySelector('.claim-review-dialog')!;
const filters = () => queue.at(-1)!;

test('queue filters reset pagination and retain the legacy review disclosure through empty results', async () => {
  await mount('/skill-reviews', true);
  await click('Next reviews page');
  assert.equal(filters().get('page'), '2');
  await click('Previous reviews page');
  assert.equal(filters().get('page'), '1');
  await change(
    document.querySelector<HTMLSelectElement>('[aria-label="Review status"]')!,
    'APPROVED',
  );
  await change(
    document.querySelector<HTMLSelectElement>('[aria-label="Review category"]')!,
    'Data',
  );
  await change(
    document.querySelector<HTMLInputElement>('[aria-label="Search review employee or skill"]')!,
    ' no match ',
  );
  await act(async () =>
    document
      .querySelector('.review-filters')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await settle();
  assert.deepEqual(Object.fromEntries(filters()), {
    page: '1',
    search: 'no match',
    category: 'Data',
    status: 'APPROVED',
  });
  assert.match(document.body.textContent!, /No matching reviews/);
  assert.equal(document.querySelector<HTMLDetailsElement>('.review-legacy-history')!.open, true);
  await click('Reset filters');
  assert.deepEqual(Object.fromEntries(filters()), {
    page: '1',
    search: '',
    category: '',
    status: 'SUBMITTED',
  });
});

test('current review denial renders read-only and combined claim routes to its current submission', async () => {
  denied = true;
  await mount('/skill-reviews', true);
  await click('Review claim');
  assert.match(dialog().textContent!, /SQL reporting/);
  assert.equal(dialog().querySelector('[aria-label="Review feedback"]'), null);
  assert.equal(writes.length, 0);
  await click('Close SQL reporting', dialog());
  denied = false;
  combined = true;
  await click('Review claim');
  const query = new URLSearchParams(document.querySelector('[data-query]')!.textContent!);
  assert.equal(query.get('submission'), 'submission-42');
  assert.equal(query.get('tab'), 'queue');
  assert.equal(dialog(), null);
  assert.equal(details.length, 2);
});

test('assignment conflict preserves review feedback and requires a fresh authorized claim to save', async () => {
  await mount('/skill-reviews?claim=reporting-sql');
  assert.ok(dialog());
  await click('Verify', dialog());
  await change(
    dialog().querySelector<HTMLTextAreaElement>('[aria-label="Review feedback"]')!,
    feedback,
  );
  writeFailure = 409;
  await click('Confirm verification', dialog());
  assert.match(dialog().textContent!, /Reviewer assignment changed/);
  assert.equal(dialog().querySelector('textarea')!.value, feedback);
  await click('Cancel', dialog());
  await click('Review claim');
  await click('Verify', dialog());
  await change(
    dialog().querySelector<HTMLTextAreaElement>('[aria-label="Review feedback"]')!,
    feedback,
  );
  writeFailure = 0;
  const previous = queue.length;
  await click('Confirm verification', dialog());
  assert.deepEqual(
    writes,
    Array(2).fill({ id: claim.id, revision: 7, action: 'APPROVE', feedback }),
  );
  assert.equal(dialog(), null);
  assert.ok(queue.length > previous);
});

test('queue denial and unavailable history deep link cannot fabricate an authorized claim', async () => {
  failure = 403;
  historical = false;
  await mount('/skill-reviews?claim=unassigned');
  assert.match(document.body.textContent!, /Queue permission unavailable/);
  assert.equal(dialog(), null);
  failure = 0;
  await click('Retry');
  assert.match(document.body.textContent!, /unavailable in your current queue/);
  assert.equal(dialog(), null);
  assert.deepEqual(details, []);
  assert.deepEqual(writes, []);
});

test('team analytics review link replaces the tab and filters only the selected direct report', async () => {
  team = true;
  await mount('/skill-reviews?tab=team', true);
  await click('Review claims');
  assert.equal(filters().get('person'), 'aditi');
  assert.equal(filters().get('status'), 'SUBMITTED');
  assert.equal(
    new URLSearchParams(document.querySelector('[data-query]')!.textContent!).get('tab'),
    'queue',
  );
  await click('Show all direct reports');
  assert.equal(filters().has('person'), false);
  assert.equal(filters().get('page'), '1');
  assert.equal(writes.length, 0);
});

test('empty pending queue can show all review states and retry the canonical queue', async () => {
  emptyQueue = true;
  await mount();
  await click('View all review states');
  assert.equal(filters().get('status'), 'ALL');
  const before = queue.length;
  await click('Review queue');
  assert.equal(queue.length, before + 1);
  assert.equal(filters().get('status'), 'ALL');
  assert.equal(writes.length, 0);
});
