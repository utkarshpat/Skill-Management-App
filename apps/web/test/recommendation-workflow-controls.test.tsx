import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
  change,
  debounce,
} from './support/interactions';
const { Recommendations } =
  component<typeof import('../src/Recommendations')>('Recommendations.tsx');
const original: import('../src/Recommendations').Recommendation = {
  id: 'recommendation-aditi',
  revision: 6,
  personId: 'aditi',
  personName: 'Aditi Menon',
  employeeCode: '710902',
  senderId: 'rohan',
  senderName: 'Rohan Mehta',
  skillId: 'sql',
  skillName: 'SQL reporting',
  category: 'Data',
  rank: 3,
  levelName: 'Practitioner',
  reason: 'Improve customer reporting delivery',
  resource: 'https://learn.microsoft.com/sql/',
  targetDate: '2026-11-01',
  status: 'PENDING',
  response: '',
  canRespond: true,
  updatedAt: '2026-11-08T10:00:00Z',
};
let view: Awaited<ReturnType<typeof render>> | undefined;
let item: typeof original,
  items: (typeof original)[],
  failure = 0,
  writeFailure = 0,
  lookupFailure = false,
  total = 1;
let writes: { url: string; body: any }[] = [],
  reads: string[] = [];
beforeEach(async () => {
  item = { ...original };
  items = [item];
  failure = 0;
  writeFailure = 0;
  lookupFailure = false;
  total = 1;
  writes = [];
  reads = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    reads.push(url);
    if (url === '/api/dev-login') return demoResponse();
    if (init?.method === 'POST') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      return writeFailure
        ? Response.json(
            { error: { message: 'Recommendation changed. Refresh the current record.' } },
            { status: writeFailure },
          )
        : Response.json({ ok: true });
    }
    if (url.startsWith('/api/recommendations/people?'))
      return lookupFailure
        ? Response.json({ error: { message: 'Direct reports unavailable' } }, { status: 503 })
        : Response.json({ people: [{ id: 'aditi', name: 'Aditi Menon', employeeCode: '710902' }] });
    if (url.startsWith('/api/skills?'))
      return Response.json({
        skills: [
          {
            id: 'sql',
            name: 'SQL reporting',
            category: 'Data',
            levels: [
              { rank: 1, name: 'Foundation' },
              { rank: 3, name: 'Practitioner' },
            ],
          },
        ],
      });
    if (url.startsWith('/api/recommendations?'))
      return failure
        ? Response.json({ error: { message: 'Recommendation access denied' } }, { status: failure })
        : Response.json({ items, total, pageSize: 1, canSend: true });
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
async function mount(
  path = '/learning?tab=recommendations',
  props: Partial<React.ComponentProps<typeof Recommendations>> = {},
) {
  view = await render(
    <MemoryRouter initialEntries={[path]}>
      <Recommendations {...props} />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
function disabled(text: string) {
  return [...document.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith(text))!
    .disabled;
}

test('recommendations paginate directions and show sent records without implying response authority', async () => {
  total = 3;
  await mount();
  await click('Next');
  assert.ok(reads.some(url => url.includes('page=2')));
  await click('Previous');
  await click('Sent');
  assert.ok(reads.some(url => url.includes('view=sent')));
  item.canRespond = false;
  await click('Received');
  await click('View details');
  assert.match(
    document.querySelector('.form-dialog')!.textContent!,
    /unavailable under your current access/,
  );
  assert.equal(document.querySelector('.recommendation-response-actions'), null);
  await click('Close');
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('discussion requires employee facts and conflict preserves the response for retry', async () => {
  let updated = 0;
  await mount(undefined, { onAccepted: () => updated++ });
  await click('Review recommendation');
  await click('Ask for discussion');
  await click('Send discussion request');
  assert.equal(writes.length, 0);
  assert.match(document.body.textContent!, /Tell your manager/);
  await fill(
    'What would you like to discuss?',
    'Can we schedule reporting practice after the client release?',
  );
  writeFailure = 409;
  await click('Send discussion request');
  assert.equal(updated, 0);
  assert.match(document.body.textContent!, /Recommendation changed/);
  assert.equal(
    document.querySelector('textarea')!.value,
    'Can we schedule reporting practice after the client release?',
  );
  writeFailure = 0;
  await click('Send discussion request');
  assert.equal(updated, 1);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[1].body.revision, 6);
  assert.equal(writes[1].body.action, 'DISCUSS');
  assert.equal(writes[1].body.plan, undefined);
});

test('decline is explicit and can return to the unchanged detail before confirmation', async () => {
  await mount();
  await click('Review recommendation');
  await click('Decline');
  await fill('Response note', 'Focus is currently on the client release.');
  await click('Back');
  assert.equal(writes.length, 0);
  await click('Decline');
  await click('Confirm decline');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.action, 'DECLINE');
  assert.equal(writes[0].body.message, 'Focus is currently on the client release.');
});

test('acceptance validates the personal schedule and retries with stable plan and task identities', async () => {
  await mount();
  await click('Review recommendation');
  await click('Accept & build plan');
  await click('Write plan manually');
  await fill('Plan name', '');
  await click('Accept & create plan');
  assert.equal(writes.length, 0);
  assert.match(document.body.textContent!, /Enter a plan name/);
  await fill('Plan name', 'Customer reporting practice');
  await fill('Your goal', 'Deliver grouped customer reports');
  await fill('Minutes per day', '4');
  await click('Accept & create plan');
  assert.equal(writes.length, 0);
  await fill('Minutes per day', '45');
  await fill('Start date', '2026-11-08');
  await fill('Daily tasks', 'Practice filtering\nBuild grouped report');
  await fill('Response note', 'Agreed with the delivery schedule.');
  assert.match(document.body.textContent!, /ends after the suggested target/);
  writeFailure = 409;
  await click('Accept & create plan');
  assert.match(document.body.textContent!, /Recommendation changed/);
  writeFailure = 0;
  await click('Accept & create plan');
  assert.deepEqual(writes[0], writes[1]);
  const body = writes[1].body;
  assert.equal(body.action, 'ACCEPT');
  assert.equal(body.revision, 6);
  assert.equal(body.plan.skillId, 'sql');
  assert.equal(body.plan.title, 'Customer reporting practice');
  assert.equal(body.plan.targetDate, '2026-11-09');
  assert.deepEqual(
    body.plan.tasks.map((t: any) => [t.title, t.plannedDate, t.estimatedMinutes]),
    [
      ['Practice filtering', '2026-11-08', 45],
      ['Build grouped report', '2026-11-09', 45],
    ],
  );
  assert.equal(new Set(body.plan.tasks.map((t: any) => t.id)).size, 2);
});

test('manager wizard retries discovery, validates resource URLs and preserves a failed send draft', async () => {
  await mount();
  lookupFailure = true;
  await click('Recommend a skill');
  await debounce();
  assert.match(document.body.textContent!, /Direct reports unavailable/);
  assert.equal(disabled('Next'), true);
  lookupFailure = false;
  await click('Retry lookup');
  await debounce();
  await change(document.querySelector('[aria-label="Search recommendation recipient"]')!, 'Aditi');
  await debounce();
  await click('Aditi Menon');
  await click('Next');
  await change(document.querySelector('[aria-label="Search recommendation skill"]')!, 'SQL');
  await debounce();
  await click('SQL reporting');
  await fill('Target proficiency', '3');
  await click('Next');
  await fill('Why are you recommending this?', 'Improve grouped reporting for the client.');
  await fill('Learning resource', 'http://example.com');
  assert.equal(disabled('Next'), true);
  await fill('Learning resource', 'https://learn.microsoft.com/sql/');
  await fill('Suggested target date', '2026-12-01');
  await click('Next');
  assert.equal(writes.length, 0);
  assert.match(document.querySelector('.form-dialog')!.textContent!, /Aditi Menon/);
  writeFailure = 409;
  await click('Send recommendation');
  assert.match(document.body.textContent!, /Recommendation changed/);
  writeFailure = 0;
  await click('Send recommendation');
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[1].body.personId, 'aditi');
  assert.equal(writes[1].body.rank, 3);
  assert.equal(writes[1].body.targetDate, '2026-12-01');
});

test('focused recommendation denial recovers explicitly and accepted detail links to the exact plan', async () => {
  failure = 403;
  await mount('/learning?recommendation=recommendation-aditi');
  assert.match(
    document.querySelector('.form-dialog')!.textContent!,
    /Recommendation access denied/,
  );
  failure = 0;
  item.canRespond = false;
  item.status = 'ACCEPTED';
  item.planId = 'personal-reporting-plan';
  item.response = 'Accepted with a reviewed schedule.';
  await click('Retry');
  assert.match(document.body.textContent!, /Accepted with a reviewed schedule/);
  assert.equal(
    document.querySelector('.form-dialog a.secondary-button')?.getAttribute('href'),
    '/learning?tab=paths&openPlan=personal-reporting-plan',
  );
  await click('Close');
  assert.equal(document.querySelector('.form-dialog'), null);
});
