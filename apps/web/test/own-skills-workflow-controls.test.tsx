import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  change,
} from './support/interactions';
const { MySkills } = component<typeof import('../src/MySkills')>('MySkills.tsx');
const original: import('../src/MySkills').Claim = {
  id: 'f2718656-e761-401a-8a78-f16a00000001',
  revision: 5,
  skillId: 'sql',
  skillName: 'SQL reporting',
  category: 'Data',
  definitionRevision: 3,
  rank: 3,
  levelName: 'Practitioner',
  experienceMonths: 18,
  lastUsedOn: '2026-10-01',
  description: 'Built customer reports using joins and grouped totals.',
  status: 'DRAFT',
  updatedAt: '2026-11-08T10:00:00Z',
  personId: 'aditi',
  personName: 'Aditi Menon',
  projects: 'Customer reporting',
  evidence: 'Reviewed delivery notes',
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let claims: (typeof original)[],
  failure = 0,
  writeFailure = 0,
  canClaim = true;
let writes: any[] = [],
  reads: string[] = [];
beforeEach(async () => {
  claims = [{ ...original }];
  failure = 0;
  writeFailure = 0;
  canClaim = true;
  writes = [];
  reads = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    reads.push(url);
    if (url === '/api/dev-login') return demoResponse();
    if (url === '/api/my-skills/submit') {
      writes.push(JSON.parse(String(init?.body)));
      return writeFailure
        ? Response.json(
            { error: { message: 'Claim revision changed. Refresh before submitting.' } },
            { status: writeFailure },
          )
        : Response.json({ ok: true });
    }
    if (url.startsWith('/api/my-skills?page='))
      return failure
        ? Response.json({ error: { message: 'Own skill access denied' } }, { status: failure })
        : Response.json({ claims, total: claims.length, page: 1, pageSize: 100, canClaim });
    if (url.startsWith('/api/capability-submissions?')) return Response.json({ records: [] });
    if (url.startsWith('/api/capability-submissions/links/')) return Response.json({ links: [] });
    if (url.includes('/evidence'))
      return Response.json({ items: [], revision: 5, canUpload: false });
    if (url.startsWith('/api/skill-reviews/'))
      return Response.json({ history: [], total: 0, pageSize: 5 });
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
async function mount(path = '/my-skills') {
  view = await render(
    <MemoryRouter initialEntries={[path]}>
      <MySkills />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}

test('own skill view searches recorded claims and opens read-only evidence without submitting', async () => {
  claims.push({
    ...original,
    id: 'azure',
    skillId: 'azure',
    skillName: 'Azure operations',
    category: 'Cloud',
    status: 'APPROVED',
    feedback: 'Delivery evidence reviewed.',
  });
  await mount();
  await change(document.querySelector('[aria-label="Search your skills"]')!, 'Azure');
  assert.equal(document.querySelector('[aria-label="View SQL reporting claim"]'), null);
  await click('View Azure operations claim');
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Delivery evidence reviewed/);
  assert.equal(writes.length, 0);
  await click('Close');
  await change(document.querySelector('[aria-label="Search your skills"]')!, '');
  await click('To complete');
  assert.ok(document.querySelector('[aria-label="View SQL reporting claim"]'));
  assert.equal(document.querySelector('[aria-label="View Azure operations claim"]'), null);
  await click('Clear skill filters');
  await change(document.querySelector('[aria-label="Filter skill category"]')!, 'Cloud');
  assert.equal(document.querySelector('[aria-label="View SQL reporting claim"]'), null);
});

test('submission recovery uses the loaded draft revision and preserves conflict details until retry', async () => {
  await mount('/my-skills?submitClaim=' + original.id);
  assert.ok(document.querySelector('[aria-label="Submit for review"]'));
  assert.equal(writes.length, 0);
  writeFailure = 409;
  await click('Submit for review', document.querySelector('.form-dialog-footer')!);
  assert.match(document.body.textContent!, /Claim revision changed/);
  assert.deepEqual(writes[0], { id: original.id, revision: 5, action: 'SUBMIT', feedback: '' });
  writeFailure = 0;
  await click('Submit for review', document.querySelector('.form-dialog-footer')!);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('invalid and unknown recovery links never submit or open another claim', async () => {
  await mount('/my-skills?submitClaim=not-a-uuid');
  assert.match(document.body.textContent!, /claim is unavailable/);
  assert.equal(writes.length, 0);
  assert.equal(document.querySelector('.form-dialog'), null);
  await view!.unmount();
  view = undefined;
  await mount('/my-skills?claim=f2718656-e761-401a-8a78-f16a00000099');
  assert.match(document.body.textContent!, /claim is unavailable/);
  assert.equal(writes.length, 0);
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('denied skill refresh clears the profile and retry reflects current read-only permissions', async () => {
  await mount();
  failure = 403;
  await act(async () => window.dispatchEvent(new Event('own-skills-updated')));
  await settle();
  assert.match(document.body.textContent!, /Own skill access denied/);
  assert.equal(document.querySelector('[aria-label="My skills profile"]'), null);
  failure = 0;
  canClaim = false;
  await click('Retry');
  assert.ok(document.querySelector('[aria-label="My skills profile"]'));
  assert.equal(document.querySelector('[aria-label="Submit SQL reporting for review"]'), null);
  await view!.unmount();
  view = undefined;
  await mount('/my-skills?submitClaim=' + original.id);
  assert.match(document.body.textContent!, /does not have permission to submit/);
  assert.equal(writes.length, 0);
});
