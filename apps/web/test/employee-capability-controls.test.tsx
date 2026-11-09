import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  change,
} from './support/interactions';
import type { Claim } from '../src/MySkills';
import type { TeamPerson, TeamSkill } from '../src/team-analytics';

const { EmployeeCapability } =
  component<typeof import('../src/EmployeeCapability')>('EmployeeCapability.tsx');
const person: TeamPerson = {
  id: 'aditi',
  name: 'Aditi Menon',
  employeeCode: '710902',
  reviewed: 1,
  pending: 1,
};
const claim: Claim = {
  id: 'sql-claim',
  personId: person.id,
  skillId: 'sql',
  skillName: 'SQL reporting',
  category: 'Data',
  revision: 7,
  definitionRevision: 3,
  rank: 3,
  levelName: 'Experienced',
  experienceMonths: 18,
  description: 'Reconciled monthly delivery reports.',
  status: 'APPROVED',
  updatedAt: '2026-11-08T10:00:00Z',
};
const pending: Claim = {
  ...claim,
  id: 'azure-claim',
  skillId: 'azure',
  skillName: 'Azure operations',
  category: 'Cloud',
  status: 'SUBMITTED',
};
const skills: TeamSkill[] = [claim, pending].map(item => ({
  ...item,
  personId: person.id,
  status: item.status === 'APPROVED' ? 'APPROVED' : 'SUBMITTED',
}));
let view: Awaited<ReturnType<typeof render>> | undefined;
let pages: string[], detailFailure: number, listFailure: number, foreign: boolean, denied: boolean;
let writes: Record<string, unknown>[], reviews: number, saved: number;

beforeEach(async () => {
  pages = [];
  writes = [];
  reviews = saved = detailFailure = listFailure = 0;
  foreign = denied = false;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    if (path === '/api/dev-login') return demoResponse();
    if (path === '/api/capability-submissions') return Response.json({ records: [] });
    if (path === '/api/skill-reviews') {
      const page = url.searchParams.get('page')!;
      pages.push(page);
      assert.equal(url.searchParams.get('person'), person.id);
      return listFailure
        ? Response.json(
            { error: { message: 'Assigned records unavailable' } },
            { status: listFailure },
          )
        : Response.json({
            claims: [page === '1' ? claim : pending],
            total: 2,
            pageSize: 1,
            canReadHistory: true,
          });
    }
    if (path === '/api/skill-reviews/decision') {
      writes.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }
    if (path.endsWith('/evidence'))
      return Response.json({ items: [], revision: 7, canUpload: false });
    if (path === '/api/assistant') return Response.json({ configured: false });
    if (path.startsWith('/api/capability-submissions/links/')) return Response.json({ links: [] });
    if (path.startsWith('/api/skill-reviews/')) {
      if (url.searchParams.has('page'))
        return Response.json({ history: [], total: 0, pageSize: 5 });
      if (detailFailure)
        return Response.json(
          { error: { message: 'Current claim access denied' } },
          { status: detailFailure },
        );
      const item = path.endsWith(pending.id) ? pending : claim;
      return Response.json({
        claim: { ...item, personId: foreign ? 'another-person' : person.id },
        reviewAccess: {
          allowed: !denied && item.status === 'SUBMITTED',
          reasonCode: denied
            ? 'EXPLICIT_DENY'
            : item.status === 'SUBMITTED'
              ? 'REPORTING_POLICY'
              : 'NOT_AWAITING_REVIEW',
          resource: { type: 'SKILL_CLAIM', id: item.id, revision: item.revision },
          sources: [],
        },
      });
    }
    throw Error('Unexpected employee capability request ' + url);
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
      <EmployeeCapability
        person={person}
        skills={skills}
        onReviews={() => reviews++}
        onSaved={() => saved++}
      />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
const result = () => document.querySelector('#employee-skill-results')!;
const dialog = () => document.querySelector('.claim-review-dialog')!;
const summary = () => document.querySelector('.employee-capability-summary')!;
async function metric(name: string) {
  const button = [...summary().querySelectorAll('button')].find(item =>
    item.textContent?.includes(name),
  )!;
  await click(button.textContent!.trim(), summary());
}

test('employee summary filters and layout keep the same scoped skills while clearing old search', async () => {
  await mount();
  await change(
    document.querySelector<HTMLInputElement>('[aria-label="Search employee skills"]')!,
    'no match',
  );
  assert.match(result().textContent!, /No matching skills/);
  await metric('Manager reviewed');
  assert.match(result().textContent!, /SQL reporting/);
  assert.doesNotMatch(result().textContent!, /Azure operations/);
  await metric('Assigned pending reviews');
  assert.match(result().textContent!, /Azure operations/);
  await metric('Visible skill claims');
  await click('Skill list');
  assert.match(result().textContent!, /SQL reporting.*Azure operations/s);
  await click('Skill cards');
  await click('Open pending reviews');
  assert.equal(reviews, 1);
});

test('employee history loads the next assigned page and current permission denial keeps the claim read-only', async () => {
  denied = true;
  await mount();
  await click('Review records');
  assert.match(result().textContent!, /1 of 2 assigned records loaded/);
  await click('Load more review records');
  assert.deepEqual(pages, ['1', '2']);
  assert.match(result().textContent!, /2 of 2 assigned records loaded/);
  await click('Open review', result());
  assert.ok(dialog());
  assert.equal(dialog().querySelector('[aria-label="Review feedback"]'), null);
  await click('Close Azure operations', dialog());
  assert.equal(dialog(), null);
  assert.deepEqual(writes, []);
});

test('detail retry hides foreign claims and clears assigned links after list access is lost', async () => {
  listFailure = 403;
  await mount();
  assert.match(result().textContent!, /Assigned records unavailable/);
  assert.doesNotMatch(result().textContent!, /Evidence & history/);
  listFailure = 0;
  await click('Retry details');
  await click('Review records');
  foreign = true;
  await click('View evidence & history', result());
  assert.match(result().textContent!, /unavailable in this employee profile/);
  assert.equal(dialog(), null);
  foreign = false;
  detailFailure = 403;
  await click('View evidence & history', result());
  assert.match(result().textContent!, /Current claim access denied/);
  assert.equal(dialog(), null);
});

test('successful assigned review forwards the exact claim revision and refreshes the employee parent', async () => {
  await mount();
  await click('Review records');
  await click('Load more review records');
  await click('Open review', result());
  await click('Verify', dialog());
  await change(
    dialog().querySelector<HTMLTextAreaElement>('[aria-label="Review feedback"]')!,
    'Reviewed cloud deployment evidence.',
  );
  await click('Confirm verification', dialog());
  assert.deepEqual(writes, [
    {
      id: pending.id,
      revision: 7,
      action: 'APPROVE',
      feedback: 'Reviewed cloud deployment evidence.',
    },
  ]);
  assert.equal(dialog(), null);
  assert.equal(saved, 1);
});
