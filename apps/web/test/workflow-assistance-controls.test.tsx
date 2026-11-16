import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse, deferred } from './support/browser';
import {
  component,
  MemoryRouter,
  refreshDevelopmentLogin,
  click,
  fill,
} from './support/interactions';
const { ReviewAssistance } =
  component<typeof import('../src/ReviewAssistance')>('ReviewAssistance.tsx');
const { AssistantPeopleResults } = component<
  typeof import('../src/business/AssistantPeopleResults')
>('business/AssistantPeopleResults.tsx');
const { SkillGrowthJourney } =
  component<typeof import('../src/SkillGrowthJourney')>('SkillGrowthJourney.tsx');

let view: Awaited<ReturnType<typeof render>> | undefined;
let respond: (url: string, init?: RequestInit) => Promise<Response>;
const requests: { url: string; body: any }[] = [];
beforeEach(async () => {
  requests.length = 0;
  respond = async url => {
    throw Error('Unexpected request ' + url);
  };
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/dev-login') return demoResponse();
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond(url, init);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('review assistance binds drafts to claim revision and proposed decision, requires explicit use and supports pagination', async () => {
  const used: string[] = [];
  const decisions: string[] = [];
  const claim: any = { id: 'claim-sql', revision: 8, personId: 'aditi', skillName: 'SQL' };
  respond = async (url, init) => {
    if (url === '/api/assistant') return Response.json({ configured: true });
    const body = JSON.parse(String(init?.body));
    return Response.json({
      body: 'Use current reviewed evidence. '.repeat(25),
      kind: body.kind,
      revision: 8,
      decision: body.decision,
    });
  };
  view = await render(
    <ReviewAssistance
      claim={claim}
      canDraft
      decision="APPROVE"
      onDecision={v => decisions.push(v)}
      onUse={v => used.push(v)}
      hasFeedback={false}
    />,
  );
  await settle();
  await fill('Reviewer facts', 'Demonstrated SQL joins in the payments project');
  await fill('Proposed decision', 'REQUEST_CHANGES');
  assert.deepEqual(decisions, ['REQUEST_CHANGES']);
  await click('Summarize evidence');
  assert.equal(requests.at(-1)?.body.id, 'claim-sql');
  assert.equal(requests.at(-1)?.body.revision, 8);
  assert.equal(used.length, 0);
  await click('More');
  await click('Previous');
  await click('New draft');
  await click('Draft feedback');
  await click('Use feedback draft');
  assert.equal(used.length, 1);
  assert.match(document.body.textContent ?? '', /Draft added to feedback/);
  await click('New draft');
  respond = async () =>
    Response.json({ body: 'Stale feedback', kind: 'FEEDBACK', revision: 7, decision: 'APPROVE' });
  await click('Draft feedback');
  const apply = [...document.querySelectorAll('button')].find(b =>
    b.textContent?.includes('Use feedback draft'),
  );
  assert.equal(apply?.disabled, true);
  assert.equal(used.length, 1);
});

test('review assistance separates availability failures, generation cancellation and read-only summaries', async () => {
  respond = async () => Response.json({ configured: false });
  view = await render(
    <ReviewAssistance
      claim={{ id: 'claim', revision: 1 } as any}
      canDraft={false}
      decision="REJECT"
      onDecision={() => {}}
      onUse={() => assert.fail('Feedback unavailable')}
      hasFeedback
    />,
  );
  await settle();
  assert.match(document.body.textContent ?? '', /AI is unavailable/);
  await view.unmount();
  view = undefined;
  const pending = deferred<Response>();
  let signal: AbortSignal | undefined;
  respond = async (url, init) => {
    if (url === '/api/assistant') return Response.json({ configured: true });
    signal = init?.signal as AbortSignal;
    return pending.promise;
  };
  view = await render(
    <ReviewAssistance
      claim={{ id: 'claim', revision: 1 } as any}
      canDraft={false}
      decision="REJECT"
      onDecision={() => {}}
      onUse={() => {}}
      hasFeedback={false}
    />,
  );
  await settle();
  await click('Summarize evidence');
  await click('Cancel generation');
  assert.equal(signal?.aborted, true);
  pending.resolve(Response.json({ kind: 'SUMMARY', body: 'Late private draft', revision: 1 }));
  await settle();
  assert.doesNotMatch(document.body.textContent ?? '', /Late private draft/);
  respond = async () =>
    Response.json({ error: { message: 'Current review assignment revoked' } }, { status: 403 });
  await click('Summarize evidence');
  assert.match(document.body.textContent ?? '', /Current review assignment revoked/);
});

const peopleQuery = {
  skills: [{ id: 'sql', minRank: 2 }],
  certifications: ['azure'],
  headcount: 2,
  onlyEligible: false,
  page: 1,
  scopeId: 'portfolio',
  hierarchyId: 'client',
};
function matches(page = 1, canExport = true) {
  return {
    context: {
      canExport,
      asOf: '2026-11-06T09:00:00Z',
      scopes: [{ id: 'portfolio', label: 'UK Delivery' }],
      hierarchy: [{ id: 'client', name: 'NHS SBS IT' }],
    },
    query: peopleQuery,
    requirements: [{ type: 'SKILL', name: 'SQL', criterion: '2' }],
    total: 2,
    eligibleTotal: 1,
    required: 1,
    page,
    pageSize: 1,
    rows: [
      {
        id: page === 1 ? 'aditi' : 'rohan',
        employee: page === 1 ? 'Aditi Menon' : 'Rohan Mehta',
        employeeCode: page === 1 ? '710902' : '710903',
        matched: page === 1 ? 1 : 0,
        eligible: page === 1,
        criteria: [{ name: 'SQL', criterion: '2', matched: page === 1 }],
      },
    ],
  };
}
test('assistant people matching filters, pages and exports only after a fresh authorized request', async () => {
  const urls: string[] = [];
  mock.method(URL, 'createObjectURL', () => {
    urls.push('blob');
    return 'blob:verified-people';
  });
  mock.method(URL, 'revokeObjectURL', () => {});
  mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  respond = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (url.endsWith('/export')) return new Response('Employee,SQL');
    return Response.json(matches(body.page));
  };
  view = await render(<AssistantPeopleResults query={peopleQuery} />);
  await settle();
  assert.match(document.body.textContent ?? '', /Aditi Menon/);
  await click('CSV');
  assert.equal(urls.length, 1);
  assert.equal(requests.at(-1)?.body.format, 'csv');
  await click('View results');
  await click('Next');
  assert.match(document.querySelector('dialog')?.textContent ?? '', /Rohan Mehta/);
  await click('Previous');
  await click('Excel');
  assert.equal(requests.at(-1)?.body.format, 'xlsx');
  const checkbox = document.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  await settle();
  assert.equal(requests.at(-1)?.body.onlyEligible, true);
  respond = async () =>
    Response.json({ error: { message: 'Analytics access was revoked' } }, { status: 403 });
  await click('Next');
  assert.match(document.body.textContent ?? '', /Analytics access was revoked/);
  assert.doesNotMatch(document.querySelector('dialog')?.textContent ?? '', /Aditi Menon/);
  respond = async () => Response.json({ ...matches(), rows: [], total: 0, eligibleTotal: 0 });
  await click('Retry');
  assert.match(document.body.textContent ?? '', /No people match these filters/);
});

const task = {
  id: 'joins',
  title: 'Practice joins',
  kind: 'PRACTICE',
  completedAt: null,
  rank: 1,
  minutes: 30,
  resources: [],
};
const plan: any = {
  id: 'plan-sql',
  title: 'SQL delivery foundations',
  goal: 'Use SQL safely in payment reporting',
  skillId: 'sql',
  skillName: 'SQL',
  status: 'ACTIVE',
  revision: 3,
  tasks: [task],
};
test('skill growth journey continues learning, resumes plans and links only to own reviewed claim workflows', async () => {
  const continued: any[] = [];
  const resumed: any[] = [];
  respond = async url =>
    url.startsWith('/api/recommendations')
      ? Response.json({
          items: [
            {
              id: 'recommendation',
              skillName: 'Azure',
              title: 'Cloud foundations',
              status: 'PENDING',
              senderName: 'Neha Rao',
            },
          ],
          total: 1,
          pageSize: 10,
        })
      : Response.json({ claims: [], total: 0, pageSize: 10, canClaim: true });
  view = await render(
    <MemoryRouter>
      <SkillGrowthJourney
        plans={[plan]}
        canManage
        onContinue={(p, t) => continued.push([p.id, t.id])}
        onResume={p => resumed.push(p.id)}
      />
    </MemoryRouter>,
  );
  await settle();
  await click('Continue learning');
  assert.deepEqual(continued, [['plan-sql', 'joins']]);
  const renderPlans = (plans: any[], canManage = true) => (
    <MemoryRouter>
      <SkillGrowthJourney
        plans={plans}
        canManage={canManage}
        onContinue={() => {}}
        onResume={p => resumed.push(p.id)}
      />
    </MemoryRouter>
  );
  await view.update(renderPlans([{ ...plan, status: 'PAUSED' }]));
  await click('Resume learning plan');
  assert.deepEqual(resumed, ['plan-sql']);
  await view.update(
    renderPlans([{ ...plan, tasks: [{ ...task, completedAt: '2026-11-06T09:00:00Z' }] }]),
  );
  assert.ok(document.querySelector('a[href="/my-skills?action=add&skill=SQL"]'));
  await view.update(renderPlans([{ ...plan, status: 'PAUSED' }], false));
  assert.match(document.body.textContent ?? '', /View paused plan/);
  await view.update(renderPlans([]));
  await settle();
  assert.equal(document.querySelector('progress'), null);
});

test('skill growth journey keeps learning usable when claim history fails and retries current sources', async () => {
  let fail = true;
  respond = async url => {
    if (url.startsWith('/api/recommendations'))
      return Response.json({ items: [], total: 0, pageSize: 10 });
    return fail
      ? Response.json({ error: { message: 'Claim history unavailable' } }, { status: 503 })
      : Response.json({ claims: [], total: 0, pageSize: 10, canClaim: false });
  };
  view = await render(
    <MemoryRouter>
      <SkillGrowthJourney plans={[plan]} canManage onContinue={() => {}} onResume={() => {}} />
    </MemoryRouter>,
  );
  await settle();
  assert.match(document.body.textContent ?? '', /Claim history unavailable/);
  assert.ok(
    [...document.querySelectorAll('button')].some(b =>
      b.textContent?.includes('Continue learning'),
    ),
  );
  fail = false;
  await click('Retry');
  assert.doesNotMatch(document.body.textContent ?? '', /Claim history unavailable/);
});
