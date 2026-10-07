import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { createApp } from '../src/create-app.js';
import {
  LearningPracticeService,
  sessionInput,
  attemptInput,
  type PracticeState,
  type PracticeStore,
} from '../src/modules/learning/practice.js';
import type { LearningStore, LearningPlan } from '../src/modules/learning/learning.js';
const planId = randomUUID(),
  taskId = randomUUID(),
  actor = randomUUID(),
  quizId = randomUUID(),
  attemptId = randomUUID();
const plan: LearningPlan = {
  id: planId,
  revision: 1,
  title: 'Learn',
  goal: 'Practice',
  timezone: 'Asia/Kolkata',
  dailyMinutes: 30,
  targetDate: '2026-10-10',
  status: 'ACTIVE',
  tasks: [{ id: taskId, title: 'Azure storage', estimatedMinutes: 30, plannedDate: '2026-10-04' }],
};
const question = {
  prompt: 'Which is object storage?',
  options: ['Blob', 'Queue', 'DNS', 'Identity'],
  correctIndex: 0,
  explanation: 'Blob stores objects.',
};
const state: PracticeState = {
  session: { revision: 0, notes: '', minutes: 0, resources: [] },
  quizzes: [
    {
      id: quizId,
      title: 'Storage',
      provider: 'test',
      createdAt: new Date().toISOString(),
      questions: [question],
    },
  ],
  attempts: [],
};
function setup() {
  let canManage = true;
  const owners: string[] = [],
    writes: object[] = [];
  const learning: LearningStore = {
    read: async a => {
      owners.push(a);
      return { canManage, plans: a === actor ? [structuredClone(plan)] : [] };
    },
    change: async () => {
      throw Error('Practice must not complete learning');
    },
  };
  const practice: PracticeStore = {
    read: async a => {
      owners.push(a);
      return structuredClone(state);
    },
    write: async (a, p, t, action, payload) => {
      owners.push(a);
      assert.equal(p, planId);
      assert.equal(t, taskId);
      writes.push({ action, payload });
    },
  };
  return {
    learning,
    practice,
    owners,
    writes,
    revoke: () => {
      canManage = false;
    },
  };
}
test('study drafts validate URLs, notes, minutes, revisions and editable fields', () => {
  assert.equal(
    sessionInput({
      revision: 0,
      notes: ' draft ',
      minutes: 0,
      resources: [{ label: ' Docs ', url: 'https://example.com/learn' }],
    }).notes,
    'draft',
  );
  for (const extra of [
    { minutes: -1 },
    { revision: 1.5 },
    { notes: 'x'.repeat(2001) },
    { completedAt: 'forged' },
    { resources: [{ label: 'Bad', url: 'javascript:alert(1)' }] },
    { resources: [{ label: 'Bad', url: 'https://user:secret@example.com/' }] },
  ])
    assert.throws(() =>
      sessionInput({ revision: 0, notes: '', minutes: 20, resources: [], ...extra }),
    );
});
test('attempt requests cannot provide scores, answer keys, actor IDs or timestamps', () => {
  const valid = { id: attemptId, quizId, answers: [0] };
  assert.deepEqual(attemptInput(valid), valid);
  for (const extra of [
    { score: 100 },
    { personId: actor },
    { correctIndex: 0 },
    { submittedAt: 'forged' },
    { answers: [null] },
    { answers: [4] },
    { answers: [0.5] },
  ])
    assert.throws(() => attemptInput({ ...valid, ...extra }));
});
test('quiz retrieval hides keys and explanations; own submitted attempts have explicit review', async () => {
  const f = setup(),
    s = structuredClone(state);
  s.attempts = [
    {
      id: attemptId,
      quizId,
      answers: [1],
      score: 0,
      total: 1,
      submittedAt: new Date().toISOString(),
    },
  ];
  f.practice.read = async () => s;
  const service = new LearningPracticeService(f.learning, f.practice);
  const view = await service.read(actor, planId, taskId);
  assert.ok(!JSON.stringify(view).includes('correctIndex'));
  assert.ok(!JSON.stringify(view).includes('explanation'));
  const review = await service.review(actor, planId, taskId, attemptId);
  assert.equal(review.review[0].correctIndex, 0);
  assert.equal(review.review[0].answer, 1);
  await assert.rejects(service.read(randomUUID(), planId, taskId));
  await assert.rejects(service.review(actor, planId, taskId, randomUUID()));
});
test('practice generation is actor-bound and fails closed on revocation or malformed model output', async () => {
  const f = setup();
  const service = new LearningPracticeService(f.learning, f.practice, async a => {
    assert.equal(a, actor);
    f.revoke();
    return {
      provider: 'test',
      artifact: { kind: 'practice_quiz', title: 'Practice', questions: [question] },
    };
  });
  await assert.rejects(
    service.quiz(actor, planId, taskId, { count: 1 }, AbortSignal.timeout(1000)),
  );
  assert.equal(f.writes.length, 0);
  const g = setup(),
    invalid = new LearningPracticeService(g.learning, g.practice, async () => ({
      provider: 'test',
      artifact: { kind: 'practice_quiz', title: 'Bad', questions: [] },
    }));
  await assert.rejects(
    invalid.quiz(actor, planId, taskId, { count: 1 }, AbortSignal.timeout(1000)),
  );
  assert.equal(g.writes.length, 0);
  await assert.rejects(
    invalid.quiz(actor, planId, taskId, { count: 0 }, AbortSignal.timeout(1000)),
  );
});
test('generation stores only validated questions and never calls plan completion', async () => {
  const f = setup(),
    service = new LearningPracticeService(f.learning, f.practice, async () => ({
      provider: 'test',
      artifact: { kind: 'practice_quiz', title: 'Practice', questions: [question] },
    }));
  await service.quiz(actor, planId, taskId, { count: 1 }, AbortSignal.timeout(1000));
  assert.equal(f.writes.length, 1);
  assert.ok(f.owners.every(a => a === actor));
  const payload = (f.writes[0] as { payload: { questions: unknown[] } }).payload;
  assert.deepEqual(payload.questions, [question]);
});
test('practice HTTP authenticates, rejects forged fields and independently checks write permission', async () => {
  const access = await LocalAccessStore.open(),
    snapshot = access.snapshot(),
    person = snapshot.people[0];
  person.id = actor;
  person.overrides.push(
    { permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'learning.manage', scope: 'OWN', effect: 'ALLOW' },
  );
  access.snapshot = () => structuredClone(snapshot);
  const f = setup(),
    practice = new LearningPracticeService(f.learning, f.practice);
  const server = createApp({
    verify: async header => {
      if (header !== 'Bearer trusted') throw Error();
      return { tenantId: 't', objectId: 'o' };
    },
    profile: async () => undefined,
    access,
    resolveAccess: async () => actor,
    learning: f.learning,
    practice,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/learning/practice`,
    headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + `?planId=${planId}&taskId=${taskId}`)).status, 401);
    const read = await fetch(base + `?planId=${planId}&taskId=${taskId}`, { headers });
    assert.equal(read.status, 200);
    assert.ok(!(await read.text()).includes('correctIndex'));
    const body = { planId, taskId, revision: 0, notes: 'Draft', minutes: 15, resources: [] };
    assert.equal(
      (
        await fetch(base + '/session', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, actorId: actor }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(base + '/session', { method: 'POST', headers, body: JSON.stringify(body) }))
        .status,
      200,
    );
    assert.equal(f.writes.length, 1);
    person.overrides.push({ permission: 'learning.manage', scope: 'OWN', effect: 'DENY' });
    assert.equal(
      (await fetch(base + '/session', { method: 'POST', headers, body: JSON.stringify(body) }))
        .status,
      403,
    );
    assert.equal(
      (await fetch(base + `?planId=${planId}&taskId=${taskId}`, { headers })).status,
      200,
    );
    assert.equal(f.writes.length, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
