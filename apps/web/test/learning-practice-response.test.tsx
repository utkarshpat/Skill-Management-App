import test from 'node:test';
import assert from 'node:assert/strict';
import { readPracticeState, readPracticeReview } from '../src/learning-practice-response';
const quizId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  attemptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const question = {
  prompt: 'Which join retains all customers?',
  options: ['LEFT JOIN', 'INNER JOIN', 'CROSS JOIN', 'No join'],
};
const attempt = {
  id: attemptId,
  quizId,
  answers: [0, 1],
  score: 1,
  total: 2,
  submittedAt: '2026-11-05T05:00:00Z',
};
function state() {
  return {
    session: {
      revision: 2,
      notes: 'Compared SQL reporting joins',
      minutes: 30,
      resources: [{ label: 'SQL reference', url: 'https://learn.microsoft.com/training/' }],
    },
    quizzes: [
      {
        id: quizId,
        title: 'Customer reporting practice',
        provider: 'Company AI',
        createdAt: '2026-11-05T05:00:00Z',
        questions: [
          structuredClone(question),
          {
            prompt: 'Which clause groups reporting rows?',
            options: ['ORDER BY', 'GROUP BY', 'WHERE', 'LIMIT'],
          },
        ],
      },
    ],
    attempts: [structuredClone(attempt)],
  };
}
function review() {
  return {
    ...structuredClone(attempt),
    review: state().quizzes[0].questions.map((q, i) => ({
      ...q,
      answer: attempt.answers[i],
      correctIndex: 1,
      explanation: i
        ? 'GROUP BY aggregates reporting groups.'
        : 'The exercise requires a different join.',
    })),
  };
}
test('practice response validation preserves legitimate initial drafts/history and rejects corrupt nested data before rendering', () => {
  const valid = state();
  assert.deepEqual(readPracticeState(valid), valid);
  assert.deepEqual(
    readPracticeState({
      session: { revision: 0, notes: '', minutes: 0, resources: [] },
      quizzes: [],
      attempts: [],
    }),
    { session: { revision: 0, notes: '', minutes: 0, resources: [] }, quizzes: [], attempts: [] },
  );
  const mutations: [string, (value: any) => void][] = [
    [
      'missing session',
      v => {
        delete v.session;
      },
    ],
    [
      'null session',
      v => {
        v.session = null;
      },
    ],
    [
      'negative revision',
      v => {
        v.session.revision = -1;
      },
    ],
    [
      'fractional revision',
      v => {
        v.session.revision = 1.5;
      },
    ],
    [
      'nontext notes',
      v => {
        v.session.notes = null;
      },
    ],
    [
      'overlong notes',
      v => {
        v.session.notes = 'x'.repeat(2001);
      },
    ],
    [
      'negative study minutes',
      v => {
        v.session.minutes = -1;
      },
    ],
    [
      'unbounded study minutes',
      v => {
        v.session.minutes = 481;
      },
    ],
    [
      'missing resource list',
      v => {
        v.session.resources = null;
      },
    ],
    [
      'too many resources',
      v => {
        v.session.resources = Array(6).fill(v.session.resources[0]);
      },
    ],
    [
      'null resource',
      v => {
        v.session.resources = [null];
      },
    ],
    [
      'empty resource name',
      v => {
        v.session.resources[0].label = '';
      },
    ],
    [
      'unsafe resource protocol',
      v => {
        v.session.resources[0].url = 'http://example.test/';
      },
    ],
    [
      'resource credentials',
      v => {
        v.session.resources[0].url = 'https://user:example@docs.example.test/';
      },
    ],
    [
      'invalid resource URL',
      v => {
        v.session.resources[0].url = 'not-a-url';
      },
    ],
    [
      'missing quiz list',
      v => {
        v.quizzes = null;
      },
    ],
    [
      'null quiz',
      v => {
        v.quizzes = [null];
      },
    ],
    [
      'foreign-shaped quiz ID',
      v => {
        v.quizzes[0].id = 'other';
      },
    ],
    [
      'empty quiz title',
      v => {
        v.quizzes[0].title = '';
      },
    ],
    [
      'overlong quiz title',
      v => {
        v.quizzes[0].title = 'x'.repeat(121);
      },
    ],
    [
      'missing provider',
      v => {
        v.quizzes[0].provider = null;
      },
    ],
    [
      'invalid quiz date',
      v => {
        v.quizzes[0].createdAt = 'not-a-date';
      },
    ],
    [
      'missing question list',
      v => {
        v.quizzes[0].questions = null;
      },
    ],
    [
      'empty question list',
      v => {
        v.quizzes[0].questions = [];
      },
    ],
    [
      'unbounded question count',
      v => {
        v.quizzes[0].questions = Array(21).fill(question);
      },
    ],
    [
      'null question',
      v => {
        v.quizzes[0].questions = [null];
      },
    ],
    [
      'empty question prompt',
      v => {
        v.quizzes[0].questions[0].prompt = '';
      },
    ],
    [
      'overlong question prompt',
      v => {
        v.quizzes[0].questions[0].prompt = 'x'.repeat(241);
      },
    ],
    [
      'missing options',
      v => {
        v.quizzes[0].questions[0].options = null;
      },
    ],
    [
      'missing choice',
      v => {
        v.quizzes[0].questions[0].options.pop();
      },
    ],
    [
      'duplicate choices',
      v => {
        v.quizzes[0].questions[0].options[1] = 'LEFT JOIN';
      },
    ],
    [
      'null choice',
      v => {
        v.quizzes[0].questions[0].options[1] = null;
      },
    ],
    [
      'overlong choice',
      v => {
        v.quizzes[0].questions[0].options[1] = 'x'.repeat(81);
      },
    ],
    [
      'missing attempt list',
      v => {
        v.attempts = null;
      },
    ],
    [
      'null attempt',
      v => {
        v.attempts = [null];
      },
    ],
    [
      'invalid attempt ID',
      v => {
        v.attempts[0].id = 'other';
      },
    ],
    [
      'invalid attempt quiz',
      v => {
        v.attempts[0].quizId = 'other';
      },
    ],
    [
      'invalid total',
      v => {
        v.attempts[0].total = 0;
      },
    ],
    [
      'score beyond total',
      v => {
        v.attempts[0].score = 3;
      },
    ],
    [
      'invalid attempt date',
      v => {
        v.attempts[0].submittedAt = 'not-a-date';
      },
    ],
    [
      'missing answers',
      v => {
        v.attempts[0].answers = null;
      },
    ],
    [
      'missing answer',
      v => {
        v.attempts[0].answers.pop();
      },
    ],
    [
      'out-of-range choice',
      v => {
        v.attempts[0].answers[0] = 4;
      },
    ],
    [
      'fractional choice',
      v => {
        v.attempts[0].answers[0] = 0.5;
      },
    ],
  ];
  for (const value of [undefined, null, [], true, 'unexpected'])
    assert.throws(() => readPracticeState(value), /session response is incomplete/);
  for (const [name, mutate] of mutations) {
    const value = structuredClone(valid);
    mutate(value);
    assert.throws(() => readPracticeState(value), /session response is incomplete/, name);
  }
});
test('saved explanations must match the exact attempt/quiz and contain complete scored questions', () => {
  const valid = review();
  assert.deepEqual(readPracticeReview(valid, attemptId, quizId), valid);
  const mutations: [string, (value: any) => void][] = [
    [
      'wrong attempt',
      v => {
        v.id = quizId;
      },
    ],
    [
      'wrong quiz',
      v => {
        v.quizId = attemptId;
      },
    ],
    [
      'missing review',
      v => {
        v.review = null;
      },
    ],
    [
      'incomplete review',
      v => {
        v.review.pop();
      },
    ],
    [
      'null explanation',
      v => {
        v.review[0] = null;
      },
    ],
    [
      'invalid correct choice',
      v => {
        v.review[0].correctIndex = 4;
      },
    ],
    [
      'answer mismatch',
      v => {
        v.review[0].answer = 2;
      },
    ],
    [
      'missing explanation text',
      v => {
        v.review[0].explanation = null;
      },
    ],
    [
      'overlong explanation',
      v => {
        v.review[0].explanation = 'x'.repeat(241);
      },
    ],
    [
      'malformed options',
      v => {
        v.review[0].options = [];
      },
    ],
  ];
  for (const value of [undefined, null, {}, []])
    assert.throws(
      () => readPracticeReview(value, attemptId, quizId),
      /practice review is incomplete/,
    );
  for (const [name, mutate] of mutations) {
    const value = structuredClone(valid);
    mutate(value);
    assert.throws(
      () => readPracticeReview(value, attemptId, quizId),
      /practice review is incomplete/,
      name,
    );
  }
});
