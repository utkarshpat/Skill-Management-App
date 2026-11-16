import test, { after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, settle, closeBrowser } from './support/browser';
import { component, click, change } from './support/interactions';
const { AssistantOutput } =
  component<typeof import('../src/AssistantOutput')>('AssistantOutput.tsx');
import type { Artifact } from '../src/AssistantOutput';
let view: Awaited<ReturnType<typeof render>> | undefined;
const draft = (kind: Artifact['kind']): Artifact => ({
  kind,
  title: 'Client reporting workflow',
  summary: 'Review the reporting request',
  body: 'Please review my reporting assignment.',
  steps: ['Check scope', 'Confirm with manager'],
  questions: [],
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(closeBrowser);

test('assistant draft editing hands off only the reviewed text and creates no record automatically', async () => {
  const reviews: string[] = [],
    documents: string[] = [];
  view = await render(
    <AssistantOutput
      artifact={draft('skill_draft')}
      onReview={text => reviews.push(text)}
      onDocument={text => documents.push(text)}
    />,
  );
  assert.equal(reviews.length, 0);
  await click('Edit draft');
  await change(
    document.querySelector<HTMLTextAreaElement>('[aria-label="Draft text"]')!,
    'Reviewed SQL reporting evidence',
  );
  await click('Preview draft');
  await click('Review skill draft');
  assert.deepEqual(reviews, ['Reviewed SQL reporting evidence']);
  await click('Open draft document');
  assert.match(documents[0], /^# Client reporting workflow/);
  assert.match(documents[0], /Reviewed SQL reporting evidence/);
  assert.match(documents[0], /1\. Check scope\n2\. Confirm with manager/);
  assert.match(document.body.textContent!, /No records have been changed/);
});

test('request and incident handoffs preserve distinct kinds and never imply submission', async () => {
  const reviews: any[] = [];
  for (const [kind, expected] of [
    ['request_draft', 'REQUEST'],
    ['incident_draft', 'INCIDENT'],
  ] as const) {
    await view?.unmount();
    view = await render(
      <AssistantOutput artifact={draft(kind)} onReviewRequest={value => reviews.push(value)} />,
    );
    await click(kind === 'request_draft' ? 'Review request draft' : 'Review incident draft');
    assert.deepEqual(reviews.at(-1), {
      kind: expected,
      title: 'Client reporting workflow',
      description: 'Please review my reporting assignment.',
    });
    assert.match(document.body.textContent!, /Not submitted/);
  }
});

test('business handoffs retain draft family and edits, while task planning uses explicit review defaults', async () => {
  const business: any[] = [],
    plans: any[] = [];
  for (const kind of ['amendment_draft', 'demand_draft'] as const) {
    await view?.unmount();
    view = await render(
      <AssistantOutput artifact={draft(kind)} onReviewBusiness={value => business.push(value)} />,
    );
    await click('Review business draft');
    assert.equal(business.at(-1).kind, kind);
    assert.equal(business.at(-1).summary, 'Review the reporting request');
  }
  await view!.unmount();
  view = await render(
    <AssistantOutput
      artifact={{ ...draft('task_draft'), body: '', steps: [] }}
      onReviewPlan={value => plans.push(value)}
    />,
  );
  assert.equal(plans.length, 0);
  await click('Review plan & add to calendar');
  assert.deepEqual(plans[0], {
    title: 'Client reporting workflow',
    goal: 'Review the reporting request',
    tasks: ['Client reporting workflow'],
    dailyMinutes: 30,
  });
});

test('clipboard failure is explicit, successful copy uses edited text and new edits reset copied state', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let failure = true;
  const copied: string[] = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          if (failure) throw Error('Clipboard denied');
          copied.push(text);
        },
      },
    },
  });
  try {
    view = await render(<AssistantOutput artifact={draft('request_draft')} />);
    await click('Copy draft');
    assert.match(document.querySelector('[role="alert"]')!.textContent!, /Copy is unavailable/);
    failure = false;
    await click('Copy draft');
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.match(copied[0], /Client reporting workflow\nPlease review/);
    assert.ok([...document.querySelectorAll('button')].some(b => b.textContent === 'Copied'));
    await click('Edit draft');
    await change(document.querySelector<HTMLTextAreaElement>('textarea')!, 'Updated request text');
    await click('Copy draft');
    assert.match(copied[1], /Updated request text/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('practice quiz requires every answer, reports no verified skill, and retry clears selections', async () => {
  const artifact: Artifact = {
    ...draft('practice_quiz'),
    questions: [
      {
        prompt: 'Which action submits a draft?',
        options: ['Preview only', 'Explicit confirmation'],
        correctIndex: 1,
        explanation: 'Preview does not save the request.',
      },
      {
        prompt: 'Who reviews your skill?',
        options: ['Any colleague', 'Assigned current manager'],
        correctIndex: 1,
        explanation: 'The current assigned reviewer is required.',
      },
    ],
  };
  view = await render(<AssistantOutput artifact={artifact} />);
  await click('Next');
  assert.equal(
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      b => b.textContent === 'Check answers',
    )!.disabled,
    true,
  );
  await click('Previous');
  await act(async () => document.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  await click('Next');
  await act(async () =>
    document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click(),
  );
  await click('Check answers');
  assert.match(document.body.textContent!, /1 \/ 2/);
  assert.match(document.body.textContent!, /does not verify a skill/);
  assert.ok([...document.querySelectorAll<HTMLInputElement>('input')].every(i => i.disabled));
  await click('Previous');
  assert.match(document.querySelector('.quiz-explanation')!.textContent!, /Review this question/);
  await click('Next');
  assert.match(document.querySelector('.quiz-explanation')!.textContent!, /Correct/);
  await click('Try again');
  assert.match(document.body.textContent!, /Question 1 of 2/);
  assert.ok(
    [...document.querySelectorAll<HTMLInputElement>('input')].every(i => !i.checked && !i.disabled),
  );
});
