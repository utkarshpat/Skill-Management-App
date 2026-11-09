import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { registerHooks } from 'node:module';
import { MemoryRouter } from 'react-router';
import { refreshDevelopmentLogin } from '../src/auth';
import { click, change, fill, debounce } from './support/interactions';
import { commonLevels } from '../src/proficiency';
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context);
  },
});
const { MySkills } = await import('../src/MySkills');
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
  draftFailure = 0,
  canClaim = true;
let writes: any[] = [],
  reads: string[] = [];
beforeEach(async () => {
  claims = [{ ...original }];
  failure = 0;
  writeFailure = 0;
  draftFailure = 0;
  canClaim = true;
  writes = [];
  reads = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    reads.push(url);
    if (url === '/api/dev-login') return demoResponse();
    if (url.startsWith('/api/my-skills/catalogue?'))
      return Response.json({
        skills: [
          {
            id: 'sql',
            name: 'SQL reporting',
            category: 'Data',
            definitionRevision: 3,
            levels: commonLevels(),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 3,
        categories: [{ name: 'Data', count: 1 }],
      });
    if (url === '/api/my-skills') {
      const body = JSON.parse(String(init?.body));
      writes.push(body);
      if (draftFailure)
        return Response.json(
          { error: { message: 'Skill draft changed during editing' } },
          { status: draftFailure },
        );
      claims = claims.map(claim =>
        claim.id === body.id ? { ...claim, ...body, revision: body.revision + 1 } : claim,
      );
      return Response.json({ ok: true });
    }
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
    if (url === '/api/capability-submissions/options')
      return Response.json({ claims, certifications: [], definitions: [] });
    if (url === '/api/capability-submissions/availability')
      return Response.json({ aiAvailable: false, fileAvailable: true });
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
after(async () => {
  css.deregister();
  await closeBrowser();
});
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

test('editing a legacy skill draft retains conflict edits and saves before offering submission', async () => {
  await mount('/my-skills?editClaim=' + original.id);
  await debounce();
  const wizard = () => document.querySelector('.skill-wizard')!;
  await click('Next', wizard());
  await fill('Experience (months)', '24', wizard());
  await fill('Last used', '2026-10-15', wizard());
  await fill(
    'Describe your experience',
    'Implemented grouped reporting for the client release.',
    wizard(),
  );
  await fill('Projects', 'Client reporting release', wizard());
  await click('Next', wizard());
  draftFailure = 409;
  await click('Save changes', wizard());
  assert.match(document.body.textContent!, /Skill draft changed during editing/);
  assert.equal(
    document.querySelector<HTMLTextAreaElement>('#skill-experience-description')!.value,
    'Implemented grouped reporting for the client release.',
  );
  draftFailure = 0;
  await click('Save changes', wizard());
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[1].revision, 5);
  assert.equal(writes[1].experienceMonths, 24);
  assert.equal(writes[1].definitionRevision, 3);
  assert.ok(document.querySelector('[aria-label="Submit for review"]'));
  await click('Cancel', document.querySelector('.claim-review-dialog')!);
  assert.equal(writes.length, 2);
});

test('save-success submit-failure keeps a recovery link for the saved next revision', async () => {
  await mount('/my-skills?editClaim=' + original.id);
  await debounce();
  const wizard = () => document.querySelector('.skill-wizard')!;
  await click('Next', wizard());
  await click('Next', wizard());
  writeFailure = 409;
  await click('Submit for review', wizard());
  assert.equal(writes.length, 2);
  assert.equal(writes[0].revision, 5);
  assert.deepEqual(writes[1], { id: original.id, revision: 6, action: 'SUBMIT', feedback: '' });
  assert.match(document.body.textContent!, /Skill draft saved, but it could not be submitted/);
  assert.equal(
    document.querySelector('a[href*="submitClaim"]')!.getAttribute('href'),
    '/my-skills?submitClaim=' + original.id,
  );
  assert.equal(claims[0].revision, 6);
});

test('add skill opens the combined editor from the portfolio and cancel returns to the same claim list', async () => {
  await mount();
  await click('Add skill', document.querySelector('.my-skills-actions')!);
  for (
    let attempt = 0;
    attempt < 40 && !document.querySelector('dialog[aria-label="Add skill"]');
    attempt++
  ) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  }
  const editor = document.querySelector('dialog[aria-label="Add skill"]');
  assert.ok(editor);
  await click('Cancel', editor);
  assert.equal(document.querySelector('dialog'), null);
  assert.ok(document.querySelector('[aria-label="View SQL reporting claim"]'));
  assert.equal(writes.length, 0);
});

test('submitting an existing draft from the skill list rechecks the loaded revision and can be cancelled', async () => {
  await mount();
  const submit = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button =>
    button.getAttribute('aria-label')?.match(/Submit.*SQL reporting/),
  );
  assert.ok(submit);
  await act(async () => submit.click());
  const dialog = document.querySelector('dialog[aria-label="Submit for review"]');
  assert.ok(dialog);
  await click('Cancel', dialog);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(writes.length, 0);
  await act(async () => submit.click());
  await click('Submit for review', document.querySelector('.form-dialog-footer')!);
  assert.deepEqual(writes, [{ id: original.id, revision: 5, action: 'SUBMIT', feedback: '' }]);
});

test('AI skill draft stays unsaved while choosing a published definition and closing the wizard', async () => {
  let closed = 0;
  view = await render(
    <MemoryRouter>
      <MySkills
        reviewRequest={{
          description: 'Validated customer reporting totals.',
          onClose: () => closed++,
          onSaved: () => assert.fail('Draft should remain unsaved'),
        }}
      />
    </MemoryRouter>,
  );
  await settle();
  await debounce();
  const wizard = document.querySelector('.form-dialog')!;
  const search = wizard.querySelector<HTMLInputElement>('[aria-label="Search published skills"]')!;
  await change(search, 'SQL');
  await debounce();
  assert.ok(
    reads.some(
      url =>
        url.includes('/catalogue?') &&
        new URL(url, 'http://localhost').searchParams.get('search') === 'SQL',
    ),
  );
  await click('SQL reporting', wizard);
  assert.match(wizard.textContent!, /SQL reporting/);
  await click('Cancel', wizard);
  const discard = wizard.querySelector('[role="alertdialog"]');
  assert.ok(discard);
  await click('Keep editing', discard);
  assert.equal(closed, 0);
  await click('Cancel', wizard);
  await click('Discard', wizard.querySelector('[role="alertdialog"]')!);
  assert.equal(closed, 1);
  assert.equal(writes.length, 0);
});

test('skill profile rank and status filters reset pagination and category insights replace prior filters', async () => {
  claims = Array.from({ length: 12 }, (_, index) => ({
    ...original,
    id: 'skill-claim-' + index,
    skillId: 'skill-' + index,
    skillName: 'Reporting skill ' + (index + 1),
    status: index % 2 ? 'APPROVED' : 'DRAFT',
    rank: index % 2 ? 3 : 2,
    category: index % 2 ? 'Cloud' : 'Data',
  }));
  await mount();
  const rowCount = () => document.querySelectorAll('.skills-item-card').length;
  assert.equal(rowCount(), 10);
  await click('Next skill page');
  assert.equal(rowCount(), 2);
  await click('Previous skill page');
  await change(document.querySelector<HTMLSelectElement>('[aria-label="Skills per page"]')!, '5');
  assert.equal(rowCount(), 5);
  await click('Next skill page');
  await change(
    document.querySelector<HTMLSelectElement>('[aria-label="Filter proficiency level"]')!,
    '3',
  );
  assert.equal(document.querySelector('.skills-current-page')!.textContent, '1');
  await change(
    document.querySelector<HTMLSelectElement>('[aria-label="Filter skill status"]')!,
    'DRAFT',
  );
  assert.match(document.querySelector('.skills-empty')!.textContent!, /No matching skills/);
  await click('Data', document.querySelector('.skills-category-chart')!);
  assert.equal(rowCount(), 5);
  assert.ok(
    [...document.querySelectorAll('.skills-category-pill')].every(
      item => item.textContent === 'Data',
    ),
  );
  await click('Manager reviewed: 6. Filter skills');
  assert.ok(
    [...document.querySelectorAll('.skills-status')].every(item =>
      item.classList.contains('approved'),
    ),
  );
  await click('Review my drafts');
  assert.ok(
    [...document.querySelectorAll('.skills-status')].every(item =>
      item.classList.contains('draft'),
    ),
  );
  await click('Reporting skill 1', document.querySelector('.skills-items-container')!);
  assert.ok(document.querySelector('dialog[aria-label="Reporting skill 1"]'));
});

test('empty skill profile can start an authorized first claim without creating a draft on cancel', async () => {
  claims = [];
  await mount();
  await click('Add your first skill');
  for (
    let attempt = 0;
    attempt < 40 && !document.querySelector('dialog[aria-label="Add skill"]');
    attempt++
  ) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  }
  const editor = document.querySelector('dialog[aria-label="Add skill"]');
  assert.ok(editor);
  await click('Cancel', editor);
  assert.equal(document.querySelector('dialog'), null);
  assert.match(
    document.querySelector('.skills-empty')!.textContent!,
    /Start building your skill profile/,
  );
  assert.equal(writes.length, 0);
});
