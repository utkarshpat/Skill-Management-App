import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import {
  registerLearningRoutes,
  type LearningDependencies,
} from '../src/modules/learning/routes.js';
import { AccessError } from '../src/shared/errors.js';
import type { LocalAccessState, Assignment } from '../src/modules/access/local-access-store.js';
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('learning HTTP keeps planner, recovery and practice actor-bound and independently handles unavailable services', async t => {
  const permissions: Assignment[] = (
    ['profile.view', 'learning.view', 'learning.manage'] as const
  ).map(permission => ({ permission, scope: 'OWN', effect: 'ALLOW' }));
  const state: LocalAccessState = {
    revision: 1,
    audit: [],
    roles: [{ id, name: 'Personal learning workspace', permissions }],
    people: [
      {
        id: actor,
        displayName: 'Aditi Menon',
        employeeCode: 'EMP-1042',
        active: true,
        roleIds: [id],
        overrides: [],
      },
    ],
  };
  const calls: { action: string; args: unknown[] }[] = [];
  let failure: AccessError | undefined;
  const call =
    (action: string) =>
    (...args: unknown[]) => {
      assert.equal(args[0], actor);
      if (failure) throw failure;
      calls.push({ action, args });
      return Promise.resolve({ saved: true });
    };
  const learning: NonNullable<LearningDependencies['learning']> = {
    read: async who => {
      assert.equal(who, actor);
      if (failure) throw failure;
      return { plans: [], canManage: true };
    },
    change: async (who, input) => {
      await call('change')(who, input);
    },
  };
  // These doubles isolate HTTP dispatch/permission contracts. Actual plan,
  // recovery and practice validation/SQL behavior are exercised in their suites.
  const practice = {
    read: call('practice.read'),
    review: call('practice.review'),
    session: call('session'),
    quiz: call('quiz'),
    attempt: call('attempt'),
  } as unknown as NonNullable<LearningDependencies['practice']>;
  const planner = { draft: call('planner') } as unknown as NonNullable<
    LearningDependencies['planner']
  >;
  const recovery = {
    preview: call('preview'),
    apply: call('apply'),
    advice: call('advice'),
  } as unknown as NonNullable<LearningDependencies['recovery']>;
  const deps: LearningDependencies = {
    verify: async h => {
      if (h !== 'Bearer employee') throw Error();
      return { tenantId: id, objectId: actor };
    },
    resolveAccess: async () => actor,
    access: {
      snapshot: () => structuredClone(state),
      person: who => state.people.find(p => p.id === who),
      save: async () => state,
    },
    learning,
    practice,
    planner,
    recovery,
  };
  const app = express();
  app.use(express.json());
  registerLearningRoutes(app, deps, undefined, undefined);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const root = `http://127.0.0.1:${address.port}/api/learning`,
    headers = { Authorization: 'Bearer employee', 'Content-Type': 'application/json' },
    get = (path = '') => fetch(root + path, { headers }),
    post = (path: string, body: unknown) =>
      fetch(root + path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(root)).status, 401);
  const own = await get();
  assert.equal(own.status, 200);
  assert.equal(((await own.json()) as { actorId: string }).actorId, actor);
  assert.equal((await post('', { id, revision: 2, action: 'PAUSE' })).status, 200);
  assert.equal((await post('', { id, revision: 0, action: 'PAUSE' })).status, 400);
  for (const path of [
    '/practice?planId=' + id + '&taskId=' + id,
    '/practice/review?planId=' + id + '&taskId=' + id + '&id=' + id,
  ])
    assert.equal((await get(path)).status, 200, path);
  for (const path of ['/practice?actorId=' + id, '/practice/review?personId=' + id])
    assert.equal((await get(path)).status, 400, path);
  for (const action of ['session', 'quiz', 'attempt']) {
    const body =
      action === 'session'
        ? {
            planId: id,
            taskId: id,
            revision: 1,
            notes: 'SQL join practice',
            minutes: 30,
            resources: [],
          }
        : action === 'quiz'
          ? { planId: id, taskId: id, count: 3 }
          : { planId: id, taskId: id, id, quizId: id, answers: [1, 2] };
    assert.equal((await post('/practice/' + action, body)).status, 200, action);
    assert.equal(
      (await post('/practice/' + action, { ...body, personId: id })).status,
      400,
      action,
    );
    assert.equal((await post('/practice/' + action, [])).status, 400, action);
  }
  for (const action of ['preview', 'apply', 'advice'])
    assert.equal(
      (await post('/recovery/' + action, { planId: id, revision: 2 })).status,
      200,
      action,
    );
  assert.equal((await post('/planner', { goal: 'Build SQL reporting capability' })).status, 200);
  for (const action of ['planner', 'advice', 'quiz']) {
    const selected = calls.find(c => c.action === action);
    assert.ok(selected);
    const signal = selected.args.at(-1);
    assert.ok(signal instanceof AbortSignal && !signal.aborted);
  }
  failure = new AccessError(409, 'Learning changed. Refresh the current plan.');
  for (const path of ['', '/practice', '/practice/review'])
    assert.equal((await get(path)).status, 409, path);
  for (const path of [
    '/planner',
    '/recovery/preview',
    '/recovery/apply',
    '/recovery/advice',
    '/practice/session',
    '/practice/quiz',
    '/practice/attempt',
  ])
    assert.equal((await post(path, { planId: id, taskId: id })).status, 409, path);
  failure = undefined;
  const missing: [
    keyof Pick<LearningDependencies, 'learning' | 'practice' | 'planner' | 'recovery'>,
    string[],
  ][] = [
    ['learning', ['']],
    [
      'practice',
      ['/practice', '/practice/review', '/practice/session', '/practice/quiz', '/practice/attempt'],
    ],
    ['planner', ['/planner']],
    ['recovery', ['/recovery/preview', '/recovery/apply', '/recovery/advice']],
  ];
  for (const [key, paths] of missing) {
    const previous = deps[key];
    delete deps[key];
    for (const path of paths) {
      const read = path === '' || path === '/practice' || path === '/practice/review';
      assert.equal((await (read ? get(path) : post(path, {}))).status, 503, path);
    }
    if (key === 'learning')
      assert.equal((await post('', { id, revision: 2, action: 'PAUSE' })).status, 503);
    Object.assign(deps, { [key]: previous });
  }
  state.people[0].overrides = [{ permission: 'learning.manage', scope: 'OWN', effect: 'DENY' }];
  assert.equal((await get()).status, 200);
  assert.equal((await post('/planner', {})).status, 403);
  state.people[0].overrides = [{ permission: 'learning.view', scope: 'OWN', effect: 'DENY' }];
  assert.equal((await get()).status, 403);
  state.people[0].overrides = [];
  state.people[0].active = false;
  assert.equal((await get()).status, 403);
});
