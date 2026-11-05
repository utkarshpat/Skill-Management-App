import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
const require = createRequire(import.meta.url),
  { refreshDevelopmentLogin } = require('../src/auth.ts') as typeof import('../src/auth');
const { MemoryRouter } = require('react-router') as typeof import('react-router');
const { Dashboard } = (() => {
  const css = require.extensions['.css'];
  require.extensions['.css'] = () => {};
  try {
    return require('../src/Dashboard.tsx') as typeof import('../src/Dashboard');
  } finally {
    if (css) require.extensions['.css'] = css;
    else delete require.extensions['.css'];
  }
})();
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const task = {
  id: 'sql-joins',
  planId: 'reporting-plan',
  title: 'Compare SQL joins for customer reports',
  planTitle: 'Northstar reporting delivery',
  plannedDate: '2026-11-04',
  timezone: 'Asia/Calcutta',
  estimatedMinutes: 30,
  due: 'OVERDUE',
  daysOverdue: 1,
  planCompleted: 1,
  planTotal: 3,
  href: '/learning?plan=reporting-plan&task=sql-joins',
};
const requests = {
  total: 3,
  submitted: 1,
  inProgress: 1,
  resolved: 1,
  cancelled: 0,
  canCreate: true,
  recentRecords: [
    {
      id: 'workshop',
      reference: 'REQ-2026-018',
      kind: 'REQUEST',
      title: 'Approve SQL workshop',
      status: 'SUBMITTED',
      priority: 'HIGH',
      recipientName: 'Rohan Mehta',
      updatedAt: '2026-11-05T05:00:00Z',
    },
  ],
};
function snapshot() {
  return {
    revision: 7,
    actorId: actor,
    ai: true,
    actions: [{ id: 'learning', label: 'Create learning plan', href: '/learning?action=create' }],
    cards: ['attention', 'learning', 'capability', 'requests'].map(id => ({
      id,
      title: {
        attention: 'Needs attention',
        learning: 'Learning progress',
        capability: 'Skill progress',
        requests: 'My requests',
      }[id],
      description: 'Current authorized workspace data',
      endpoint: '/api/dashboard/' + id,
      scope: { actorId: actor, kind: id === 'attention' ? 'ASSIGNED_OR_OWN' : 'OWN' },
    })),
    cardData: {
      attention: {
        data: {
          total: 1,
          groups: [
            {
              id: 'learning',
              title: 'Learning backlog',
              description: 'Tasks needing attention',
              href: '/learning?tab=backlog',
              label: 'Review tasks',
              tone: 'amber',
              count: 1,
            },
          ],
        },
      },
      learning: {
        data: {
          total: 3,
          completed: 1,
          progress: 33,
          activePlans: 1,
          loggedMinutes: 30,
          overdue: 1,
          today: 0,
          canManage: true,
          nextTask: task,
        },
      },
      capability: {
        data: {
          total: 2,
          verified: 1,
          pending: 0,
          draft: 1,
          changesRequested: 0,
          rejected: 0,
          canClaim: true,
          topSkills: [
            {
              id: 'sql',
              skillName: 'SQL',
              category: 'Databases',
              rank: 2,
              levelName: 'Autonomous',
              maxRank: 4,
            },
          ],
          recentClaims: [
            {
              id: 'reporting-skill',
              skillName: 'Power BI',
              category: 'Analytics',
              rank: 1,
              levelName: 'Foundation',
              status: 'DRAFT',
              updatedAt: '2026-11-05T05:00:00Z',
              href: '/my-skills?claim=reporting-skill',
            },
          ],
        },
      },
      requests: { data: requests },
    },
  };
}
let overview: any,
  overviewFailure = 0,
  cardFailure = 0,
  paths: string[] = [],
  mounted: Awaited<ReturnType<typeof render>> | undefined;
beforeEach(async () => {
  overview = snapshot();
  overviewFailure = 0;
  cardFailure = 0;
  paths = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = String(input);
    paths.push(path);
    if (path === '/api/dev-login') return demoResponse();
    if (path === '/api/dashboard/overview')
      return overviewFailure
        ? Response.json(
            { error: { message: 'Workspace refresh unavailable' } },
            { status: overviewFailure },
          )
        : Response.json(overview);
    if (path.startsWith('/api/dashboard/requests?status=')) {
      const status = new URL(path, 'http://localhost').searchParams.get('status');
      return Response.json({
        ...requests,
        recentRecords:
          status === 'IN_PROGRESS'
            ? [
                {
                  ...requests.recentRecords[0],
                  title: 'SQL access investigation',
                  kind: 'INCIDENT',
                  status: 'IN_PROGRESS',
                },
              ]
            : [],
      });
    }
    if (path === '/api/dashboard/learning')
      return cardFailure
        ? Response.json({ error: { message: 'Learning access changed' } }, { status: cardFailure })
        : Response.json(snapshot().cardData.learning.data);
    throw Error('Unexpected dashboard request ' + path);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount() {
  mounted = await render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
async function click(text: string, root: ParentNode = document) {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b =>
    b.textContent?.trim().startsWith(text),
  );
  assert.ok(button, 'Missing button ' + text);
  await act(async () => button.click());
  await settle();
  await settle();
}

test('dashboard combines current cards, correct deep links, request status filters and task-bound AI help', async () => {
  await mount();
  assert.match(document.body.textContent!, /Compare SQL joins/);
  assert.match(document.body.textContent!, /Power BI/);
  assert.match(document.body.textContent!, /Rohan Mehta/);
  assert.equal(paths.filter(p => p === '/api/dashboard/overview').length, 1);
  assert.equal(
    document.querySelector('a[href="/learning?action=create"]')?.textContent?.trim(),
    'Get started: Create learning plan',
  );
  const events: CustomEvent[] = [];
  const listener = (event: Event) => events.push(event as CustomEvent);
  window.addEventListener('assistant-context-request', listener);
  try {
    await click('Help with this task');
    assert.match(events[0].detail.prompt, /planId reporting-plan and taskId sql-joins/);
    assert.match(events[0].detail.prompt, /Do not complete or reschedule/);
  } finally {
    window.removeEventListener('assistant-context-request', listener);
  }
  const card = document.querySelector('.dashboard-requests')!;
  await click('In progress', card);
  assert.match(card.textContent!, /SQL access investigation/);
  assert.doesNotMatch(card.textContent!, /Approve SQL workshop/);
  assert.ok(paths.includes('/api/dashboard/requests?status=IN_PROGRESS'));
  assert.ok(card.querySelector('a[href="/requests?status=IN_PROGRESS"]'));
  await click('Cancelled', card);
  assert.match(card.textContent!, /No cancelled requests/);
  await click('All', card);
  assert.match(card.textContent!, /Approve SQL workshop/);
});
test('dashboard overview failure is retryable without stale records or duplicate card fetches', async () => {
  overviewFailure = 503;
  await mount();
  assert.match(document.body.textContent!, /Workspace refresh unavailable/);
  assert.doesNotMatch(document.body.textContent!, /Power BI/);
  overviewFailure = 0;
  await click('Retry');
  assert.match(document.body.textContent!, /Power BI/);
  assert.equal(paths.filter(p => p === '/api/dashboard/overview').length, 2);
});
test('failed individual card retries current data; denial clears the old workspace projection', async () => {
  overview.cardData.learning = {
    error: { status: 503, message: 'Learning temporarily unavailable' },
  };
  await mount();
  const card = document.querySelector('.dashboard-learning')!;
  assert.match(card.textContent!, /Learning temporarily unavailable/);
  await click('Retry', card);
  assert.match(card.textContent!, /Compare SQL joins/);
  assert.ok(paths.includes('/api/dashboard/learning'));
  await mounted!.unmount();
  mounted = undefined;
  overview = snapshot();
  overview.cardData.learning = {
    error: { status: 503, message: 'Learning temporarily unavailable' },
  };
  await mount();
  cardFailure = 403;
  overview = { ...snapshot(), revision: 8, cards: [], cardData: {}, actions: [], ai: false };
  await click('Retry', document.querySelector('.dashboard-learning')!);
  assert.match(document.body.textContent!, /Your workspace is ready/);
  assert.doesNotMatch(
    document.body.textContent!,
    /Power BI|Compare SQL joins|Approve SQL workshop/,
  );
});
