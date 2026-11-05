import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { refreshDevelopmentLogin, component, click, fill } from './support/interactions';
import type { Plan } from '../src/Learning';
Object.assign(globalThis, {
  Node: window.Node,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});
const { LearningSession } =
  component<typeof import('../src/LearningSession')>('LearningSession.tsx');
const quizId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const plan: Plan = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revision: 2,
  title: 'Northstar reporting delivery',
  goal: 'Practice SQL joins for customer reporting',
  timezone: 'Asia/Calcutta',
  dailyMinutes: 30,
  targetDate: '2026-12-01',
  status: 'ACTIVE',
  tasks: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'Compare SQL reporting joins',
      plannedDate: '2026-11-05',
      estimatedMinutes: 30,
      notes: 'Review the customer data model',
    },
  ],
};
const quiz = {
  id: quizId,
  title: 'SQL reporting practice',
  provider: 'Company AI',
  createdAt: '2026-11-05T05:00:00Z',
  questions: [
    {
      prompt: 'Which join retains every customer?',
      options: ['LEFT JOIN', 'INNER JOIN', 'CROSS JOIN', 'No join'],
    },
    {
      prompt: 'Which clause groups reporting rows?',
      options: ['ORDER BY', 'GROUP BY', 'WHERE', 'LIMIT'],
    },
  ],
};
function initial() {
  return {
    session: {
      revision: 2,
      notes: 'Reviewed reporting join behavior',
      minutes: 30,
      resources: [
        {
          label: 'SQL joins reference',
          url: 'https://learn.microsoft.com/en-us/sql/t-sql/queries/from-transact-sql',
        },
      ],
    },
    quizzes: [] as any[],
    attempts: [] as any[],
  };
}
let state = initial(),
  mode = '',
  readFailure = 0,
  postFailure = 0,
  writes: { action: string; body: any }[] = [],
  completed: any[] = [],
  mounted: Awaited<ReturnType<typeof render>> | undefined;
beforeEach(async () => {
  state = initial();
  mode = '';
  readFailure = 0;
  postFailure = 0;
  writes = [];
  completed = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/dev-login') return demoResponse();
    if (path.startsWith('/api/learning/practice/review?')) {
      if (mode === 'bad-review') return Response.json({});
      const id = new URL(path, 'http://localhost').searchParams.get('id');
      const attempt = state.attempts.find(a => a.id === id)!;
      return Response.json({
        ...attempt,
        review: quiz.questions.map((q, i) => ({
          ...q,
          answer: attempt.answers[i],
          correctIndex: i,
          explanation: i
            ? 'GROUP BY aggregates reporting groups.'
            : 'LEFT JOIN retains customers without matching transactions.',
        })),
      });
    }
    if (init?.method === 'POST') {
      const action = path.split('/').at(-1)!;
      const body = JSON.parse(String(init.body));
      writes.push({ action, body });
      if (postFailure)
        return Response.json(
          { error: { message: 'Session changed. Review before retrying.' } },
          { status: postFailure },
        );
      if (mode === 'bad-write') return Response.json({});
      if (action === 'session')
        state.session = {
          revision: state.session.revision + 1,
          notes: body.notes,
          minutes: body.minutes,
          resources: body.resources,
        };
      else if (action === 'quiz') state.quizzes = [structuredClone(quiz)];
      else if (action === 'attempt')
        state.attempts = [
          {
            id: body.id,
            quizId: body.quizId,
            answers: body.answers,
            score: body.answers.filter((answer: number, i: number) => answer === i).length,
            total: 2,
            submittedAt: '2026-11-05T06:00:00Z',
          },
        ];
      else throw Error('Unexpected practice action ' + action);
      return Response.json(state);
    }
    assert.ok(path.startsWith('/api/learning/practice?'), path);
    return readFailure
      ? Response.json(
          { error: { message: 'Learning session unavailable' } },
          { status: readFailure },
        )
      : Response.json(mode === 'bad-read' ? {} : state);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  mock.restoreAll();
});
after(closeBrowser);
async function mount(options: Partial<Parameters<typeof LearningSession>[0]> = {}) {
  mounted = await render(
    <LearningSession
      plan={plan}
      task={plan.tasks[0]}
      canManage
      onClose={() => {}}
      onComplete={(minutes, notes) => completed.push({ minutes, notes })}
      {...options}
    />,
  );
  await settle();
  await settle();
}
function page(index: number) {
  return document.querySelector<HTMLElement>(`[data-form-page="${index}"]`)!;
}

test('study sessions preserve notes through conflicts and log completion only after a confirmed session save', async () => {
  await mount();
  await fill('Study notes', 'Compared joins against customer reporting requirements');
  await fill('Actual study minutes', '45');
  postFailure = 409;
  await click('Log completion');
  assert.equal(completed.length, 0);
  assert.match(document.body.textContent!, /Session changed/);
  assert.equal(
    document.querySelector<HTMLTextAreaElement>('.learning-session-fields textarea')!.value,
    'Compared joins against customer reporting requirements',
  );
  postFailure = 0;
  await click('Log completion');
  assert.deepEqual(completed, [
    { minutes: 45, notes: 'Compared joins against customer reporting requirements' },
  ]);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(writes[1].body.planId, plan.id);
  assert.equal(writes[1].body.taskId, plan.tasks[0].id);
  assert.equal(writes[1].body.revision, 2);
});
test('resource drafts reject unsafe URLs, support removal and persist only on explicit session save', async () => {
  await mount();
  await click('Resources');
  await click('Add resource');
  await fill('Resource name', 'Customer reporting exercises');
  await fill('HTTPS URL', 'not-a-url');
  await click('Add to draft');
  assert.match(document.body.textContent!, /full HTTPS resource URL/);
  await fill('HTTPS URL', 'https://user:example@docs.example.test/');
  await click('Add to draft');
  assert.match(document.body.textContent!, /without credentials/);
  await fill('HTTPS URL', 'https://learn.microsoft.com/training/');
  await click('Add to draft');
  assert.equal(writes.length, 0);
  await click('Remove SQL joins reference');
  await click('Save session');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body.resources, [
    { label: 'Customer reporting exercises', url: 'https://learn.microsoft.com/training/' },
  ]);
  assert.match(document.body.textContent!, /Session saved. Completion is logged separately/);
  assert.equal(completed.length, 0);
});
test('practice generation is bounded, answers stay hidden until submission, and failed attempts retain their stable identity', async () => {
  await mount();
  await click('Practice');
  await fill('Number of questions', '21');
  assert.ok(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Generate practice',
    )?.disabled,
  );
  assert.equal(writes.length, 0);
  await fill('Number of questions', '2');
  await click('Generate practice');
  await click('Start practice');
  assert.doesNotMatch(page(2).textContent!, /Correct answer:/);
  assert.ok(
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Submit answers',
    )?.disabled,
  );
  await act(async () => page(2).querySelectorAll<HTMLInputElement>('input[type=radio]')[0].click());
  await click('Next', page(2));
  await act(async () => page(2).querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click());
  postFailure = 409;
  await click('Submit answers');
  assert.match(document.body.textContent!, /Session changed/);
  postFailure = 0;
  await click('Submit answers');
  const attempts = writes.filter(w => w.action === 'attempt');
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.deepEqual(attempts[1].body.answers, [0, 1]);
  assert.equal(attempts[1].body.quizId, quizId);
  assert.equal('correctIndex' in attempts[1].body, false);
  assert.match(page(3).textContent!, /Correct answer:/);
  await click('Next', page(3));
  assert.match(page(3).textContent!, /GROUP BY aggregates/);
  await click('Back to attempts');
  assert.match(page(3).textContent!, /2\/2/);
  assert.equal(completed.length, 0);
});
test('paused or view-only learning sessions expose history but cannot mutate resources, notes or quizzes', async () => {
  state.quizzes = [structuredClone(quiz)];
  await mount({ plan: { ...plan, status: 'PAUSED' }, canManage: false });
  assert.ok(
    document.querySelector<HTMLTextAreaElement>('.learning-session-fields textarea')?.disabled,
  );
  assert.doesNotMatch(
    document.querySelector('.form-dialog-footer')!.textContent!,
    /Save session|Log completion/,
  );
  await click('Resources');
  assert.doesNotMatch(page(1).textContent!, /Add resource/);
  await click('Practice');
  assert.doesNotMatch(page(2).textContent!, /Generate practice/);
  assert.ok(
    Array.from(page(2).querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.trim() === 'Start practice',
    )?.disabled,
  );
  assert.equal(writes.length, 0);
});
test('malformed session and review responses are controlled retryable errors rather than render crashes or false completion', async () => {
  mode = 'bad-read';
  await mount();
  assert.match(document.body.textContent!, /session response is incomplete/i);
  assert.doesNotMatch(
    document.querySelector('.form-dialog-footer')!.textContent!,
    /Save session|Log completion/,
  );
  mode = '';
  await click('Retry');
  await fill('Study notes', 'Updated customer reporting notes');
  mode = 'bad-write';
  await click('Log completion');
  assert.equal(completed.length, 0);
  assert.match(document.body.textContent!, /session response is incomplete/i);
  await mounted!.unmount();
  mounted = undefined;
  mode = 'bad-review';
  state.quizzes = [structuredClone(quiz)];
  state.attempts = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      quizId,
      answers: [0, 1],
      score: 2,
      total: 2,
      submittedAt: '2026-11-05T06:00:00Z',
    },
  ];
  await mount();
  await click('History');
  await click('View explanations');
  assert.match(document.body.textContent!, /practice review is incomplete/i);
  assert.equal(completed.length, 0);
});
