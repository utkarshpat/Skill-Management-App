import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import {
  MemoryRouter,
  refreshDevelopmentLogin,
  component,
  click,
  fill,
  change,
  debounce,
} from './support/interactions';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const { Recommendations } =
  component<typeof import('../src/Recommendations')>('Recommendations.tsx');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  employee = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  manager = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const recommendation = {
  id,
  revision: 2,
  personId: employee,
  personName: 'Aditi Menon',
  employeeCode: 'EMP-1042',
  senderId: manager,
  senderName: 'Rohan Mehta',
  skillId: id,
  skillName: 'SQL',
  category: 'Databases',
  rank: 2,
  levelName: 'Autonomous',
  reason: 'Northstar Bank reporting delivery needs stronger SQL joins',
  resource: 'https://learn.microsoft.com/training/',
  targetDate: '2026-12-01',
  status: 'PENDING',
  response: '',
  canRespond: true,
  updatedAt: '2026-11-05T05:00:00Z',
};
let mounted: Awaited<ReturnType<typeof render>> | undefined,
  feed: any,
  failure = 0,
  lookupFailure = false,
  saveFailure = false,
  writes: { path: string; body: any }[] = [],
  reads: string[] = [],
  accepted = 0;
beforeEach(async () => {
  feed = { items: [recommendation], total: 1, pageSize: 20, canSend: true };
  failure = 0;
  lookupFailure = false;
  saveFailure = false;
  writes = [];
  reads = [];
  accepted = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    reads.push(path);
    if (path === '/api/dev-login') return demoResponse();
    if (init?.method === 'POST') {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return saveFailure
        ? Response.json(
            { error: { message: 'Reporting access changed. Review before retrying.' } },
            { status: 409 },
          )
        : Response.json({ saved: true });
    }
    if (path.startsWith('/api/recommendations/people'))
      return lookupFailure
        ? Response.json({ error: { message: 'Recipient lookup unavailable' } }, { status: 503 })
        : Response.json({
            people: [{ id: employee, name: 'Aditi Menon', employeeCode: 'EMP-1042' }],
          });
    if (path.startsWith('/api/skills?'))
      return Response.json({
        skills: [
          {
            id,
            name: 'SQL',
            category: 'Databases',
            levels: [
              { rank: 1, name: 'Foundation' },
              { rank: 2, name: 'Autonomous' },
            ],
          },
        ],
      });
    if (path.startsWith('/api/recommendations?'))
      return failure
        ? Response.json(
            { error: { message: 'Recommendations temporarily unavailable' } },
            { status: failure },
          )
        : Response.json(feed);
    throw Error('Unexpected recommendation request ' + path);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(sentOnly = false, entry = '/learning') {
  mounted = await render(
    <MemoryRouter initialEntries={[entry]}>
      <Recommendations sentOnly={sentOnly} onAccepted={() => accepted++} />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}

test('received recommendations require discussion details and retain exact revisions through a failed response retry', async () => {
  await mount();
  assert.match(document.body.textContent!, /From Rohan Mehta/);
  await click('Review recommendation');
  await click('Ask for discussion');
  await click('Send discussion request');
  assert.match(document.body.textContent!, /Tell your manager what/);
  assert.equal(writes.length, 0);
  await fill(
    'What would you like to discuss?',
    'Please align the SQL practice with the customer report schedule.',
  );
  saveFailure = true;
  await click('Send discussion request');
  assert.match(document.body.textContent!, /Reporting access changed/);
  saveFailure = false;
  await click('Send discussion request');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, writes[1].body);
  assert.deepEqual(writes[1].body, {
    id,
    revision: 2,
    action: 'DISCUSS',
    message: 'Please align the SQL practice with the customer report schedule.',
  });
  assert.equal(accepted, 1);
});
test('acceptance requires a reviewed personal plan and does not directly update the skill profile', async () => {
  await mount();
  await click('Review recommendation');
  await click('Accept & build plan');
  assert.match(document.body.textContent!, /learning/i);
  await click('Write plan manually');
  await fill('Plan name', 'SQL reporting delivery practice');
  await fill('Your goal', 'Apply SQL joins and document a customer reporting example');
  await click('Accept & create plan');
  assert.equal(writes.length, 1);
  const body = writes[0].body;
  assert.equal(body.action, 'ACCEPT');
  assert.equal(body.id, id);
  assert.equal(body.revision, 2);
  assert.equal(body.plan.action, 'CREATE');
  assert.equal(body.plan.skillId, id);
  assert.equal(body.plan.tasks.length, 3);
  assert.equal(new Set(body.plan.tasks.map((task: any) => task.id)).size, 3);
  assert.equal(body.plan.revision, 0);
  assert.equal('rank' in body.plan, false);
  assert.equal(accepted, 1);
});
test('manager recommendations validate each step, recover lookup errors and retry with the same recommendation ID', async () => {
  await mount(true);
  lookupFailure = true;
  await click('Recommend a skill');
  await debounce();
  assert.match(document.body.textContent!, /Recipient lookup unavailable/);
  lookupFailure = false;
  await click('Retry lookup');
  await debounce();
  await click('Aditi Menon');
  await click('Next');
  await click('SQL');
  const select = document.querySelector<HTMLSelectElement>('.form-dialog select');
  assert.ok(select);
  await change(select, '2');
  await click('Next');
  await fill('Why are you recommending this?', 'Build customer reporting SQL capability');
  await fill('Learning resource', 'http://unsafe.example/');
  const next = Array.from(document.querySelectorAll<HTMLButtonElement>('.form-dialog button')).find(
    b => b.textContent?.trim() === 'Next',
  );
  assert.ok(next?.disabled);
  await fill('Learning resource', 'https://learn.microsoft.com/training/');
  await click('Next');
  saveFailure = true;
  await click('Send recommendation');
  assert.match(document.body.textContent!, /Reporting access changed/);
  saveFailure = false;
  await click('Send recommendation');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.id, writes[1].body.id);
  assert.deepEqual(writes[1].body, {
    id: writes[0].body.id,
    personId: employee,
    skillId: id,
    rank: 2,
    reason: 'Build customer reporting SQL capability',
    resource: 'https://learn.microsoft.com/training/',
  });
});
test('feed failures, unavailable focused recommendations and recorded outcomes do not expose response controls', async () => {
  failure = 503;
  await mount();
  assert.match(document.body.textContent!, /Recommendations temporarily unavailable/);
  failure = 0;
  await click('Retry');
  assert.match(document.body.textContent!, /SQL/);
  await mounted!.unmount();
  mounted = undefined;
  feed = { ...feed, items: [] };
  await mount(false, '/learning?recommendation=' + id);
  assert.match(document.body.textContent!, /This recommendation is unavailable/);
  await click('Back to recommendations');
  assert.match(document.body.textContent!, /No recommendations yet/);
  await mounted!.unmount();
  mounted = undefined;
  feed = {
    ...feed,
    items: [
      {
        ...recommendation,
        status: 'ACCEPTED',
        canRespond: false,
        planId: 'reporting-plan',
        response: 'Accepted with a weekly practice schedule',
      },
    ],
  };
  await mount();
  await click('View details');
  assert.match(document.body.textContent!, /Accepted with a weekly/);
  assert.ok(document.querySelector('a[href="/learning?tab=paths&openPlan=reporting-plan"]'));
  assert.doesNotMatch(
    document.querySelector('.form-dialog')!.textContent!,
    /Accept & build plan|Ask for discussion/,
  );
  assert.equal(writes.length, 0);
});
