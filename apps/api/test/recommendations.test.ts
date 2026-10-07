import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recommendationAccess,
  sendRecommendation,
  recommendationResponse,
} from '../src/modules/recommendations/index.js';
import type { LocalAccessState } from '../src/modules/access/index.js';
const id = '00000000-0000-4000-8000-000000000001',
  recipient = '00000000-0000-4000-8000-000000000002';
const fixture = (): LocalAccessState => ({
  revision: 1,
  audit: [],
  roles: [
    {
      id: 'personal',
      name: 'Renamed personal template',
      permissions: [
        { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
        { permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' },
        { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
      ],
    },
  ],
  people: [
    {
      id,
      displayName: 'Manager',
      employeeCode: 'M',
      active: true,
      roleIds: ['personal'],
      overrides: [],
    },
    {
      id: recipient,
      displayName: 'Employee',
      employeeCode: 'E',
      active: true,
      roleIds: ['personal'],
      overrides: [],
    },
  ],
  reporting: [{ personId: recipient, managerId: id }],
});
test('recommendation requires the exact current direct relationship, independent of role labels', () => {
  const s = fixture(),
    actor = s.people[0];
  assert.equal(recommendationAccess(s, actor, recipient).allowed, true);
  assert.equal(recommendationAccess(s, actor, id).allowed, false);
  s.people.push({ ...s.people[1], id: 'other' });
  s.reporting!.push({ personId: 'other', managerId: recipient });
  assert.equal(recommendationAccess(s, actor, 'other').allowed, false);
  s.reporting![0].managerId = 'other';
  assert.equal(recommendationAccess(s, actor, recipient).allowed, false);
});
test('explicit scoped deny and inactive actor block recommendation policy; OWN deny does not expand', () => {
  const s = fixture(),
    actor = s.people[0];
  actor.overrides = [{ permission: 'learning.recommend', scope: 'ORGANIZATION', effect: 'DENY' }];
  assert.equal(recommendationAccess(s, actor, recipient).reasonCode, 'EXPLICIT_DENY');
  actor.overrides = [{ permission: 'learning.recommend', scope: 'OWN', effect: 'DENY' }];
  assert.equal(recommendationAccess(s, actor, recipient).allowed, true);
  actor.active = false;
  assert.equal(recommendationAccess(s, actor, recipient).allowed, false);
});
test('ambiguous, cyclic and inactive recipient relationships fail closed', () => {
  const s = fixture();
  s.people[1].active = false;
  assert.equal(recommendationAccess(s, s.people[0], recipient).allowed, false);
  s.people[1].active = true;
  s.reporting!.push({ personId: recipient, managerId: id });
  assert.equal(recommendationAccess(s, s.people[0], recipient).allowed, false);
  s.reporting = [
    { personId: recipient, managerId: id },
    { personId: id, managerId: recipient },
  ];
  assert.equal(recommendationAccess(s, s.people[0], recipient).allowed, false);
});
test('send validates bounded fields and URL scheme; clients cannot supply status or authority', () => {
  const v = {
    id,
    personId: recipient,
    skillId: id,
    rank: 3,
    reason: 'Develop cloud capability',
    resource: 'https://example.org/learning',
  };
  assert.equal(sendRecommendation(v).rank, 3);
  for (const extra of [
    { rank: 0 },
    { rank: 3.5 },
    { status: 'ACCEPTED' },
    { scope: 'ORGANIZATION' },
    { resource: 'javascript:alert(1)' },
    { resource: 'http://example.org' },
    { reason: '' },
    { targetDate: '2026-02-30' },
  ])
    assert.throws(() => sendRecommendation({ ...v, ...extra }));
});
test('acceptance requires a validated new plan and decline/discuss cannot carry a plan', () => {
  const plan = {
    action: 'CREATE',
    id,
    revision: 0,
    title: 'Cloud goal',
    goal: 'Practice cloud',
    timezone: 'Asia/Kolkata',
    dailyMinutes: 30,
    targetDate: '2026-10-06',
    skillId: id,
    tasks: [{ id: recipient, title: 'Practice', plannedDate: '2026-10-06', estimatedMinutes: 30 }],
  };
  const v = { id, revision: 1, action: 'ACCEPT', message: '', plan };
  assert.equal(recommendationResponse(v).plan?.skillId, id);
  for (const extra of [
    { revision: 0 },
    { actorId: recipient },
    { plan: undefined },
    { plan: { ...plan, revision: 1 } },
    { plan: { ...plan, ownerId: recipient } },
    { action: 'DECLINE' },
    { action: 'DISCUSS', message: '' },
  ])
    assert.throws(() => recommendationResponse({ ...v, ...extra }));
  assert.equal(
    recommendationResponse({
      id,
      revision: 1,
      action: 'DISCUSS',
      message: 'Can we discuss the project context?',
    }).action,
    'DISCUSS',
  );
});

import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import type { RecommendationStore } from '../src/modules/recommendations/index.js';
test('recommendation HTTP binds verified identity, rejects spoofing and rechecks live grants', async () => {
  const state = fixture(),
    actors: string[] = [];
  let sends = 0;
  const access = {
    snapshot: () => structuredClone(state),
    person: async () => undefined,
    save: async () => state,
  };
  const recommendations: RecommendationStore = {
    read: async actor => {
      actors.push(actor);
      return { items: [], total: 0 };
    },
    options: async actor => {
      actors.push(actor);
      return { people: [] };
    },
    send: async actor => {
      actors.push(actor);
      sends++;
      return { saved: true };
    },
    respond: async () => ({ saved: true }),
    notifications: async () => [],
  };
  const server = createApp({
    verify: async header => {
      if (header !== 'Bearer trusted') throw Error();
      return { tenantId: 'tenant', objectId: 'member' };
    },
    profile: async () => undefined,
    access,
    resolveAccess: async () => id,
    recommendations,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/recommendations`,
    headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' },
    body = { id, personId: recipient, skillId: id, rank: 2, reason: 'Learn', resource: '' };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url + '?view=sent', { headers })).status, 200);
    assert.equal((await fetch(url + '?personId=' + recipient, { headers })).status, 400);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, actorId: recipient }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })).status,
      200,
    );
    assert.equal(sends, 1);
    state.people[0].overrides.push({
      permission: 'learning.recommend',
      scope: 'ORGANIZATION',
      effect: 'DENY',
    });
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })).status,
      403,
    );
    assert.equal((await fetch(url + '?view=sent', { headers })).status, 403);
    assert.equal(sends, 1);
    assert.ok(actors.every(actor => actor === id));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
