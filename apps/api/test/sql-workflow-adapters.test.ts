import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlWorkflowStore } from '../src/modules/workflows/sql-store.js';
import { SqlRecommendationStore } from '../src/modules/recommendations/sql-store.js';
import type {
  SendRecommendation,
  RecommendationResponse,
} from '../src/modules/recommendations/recommendations.js';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  manager = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  at = new Date('2026-11-04T10:00:00Z');
test('workflow adapter retains participant identities, filters, history and revision-bound commands', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlWorkflowStore(account),
      row = {
        id: id.toUpperCase(),
        requesterId: actor.toUpperCase(),
        recipientId: manager.toUpperCase(),
        title: 'Advanced SQL workshop',
        status: 'SUBMITTED',
        createdAt: at,
        updatedAt: at,
      };
    f.reply(
      'dbo.WorkflowWorkspace',
      [{ canRequest: true, canIncident: false }],
      [{ id: manager.toUpperCase(), name: 'Rohan Mehta', kind: 'REQUEST', reportingManager: true }],
    );
    assert.equal((await store.options(actor)).recipients[0].id, manager);
    f.reply('dbo.ReadWorkflowList', [{ total: 1, page: 2 }], [row], [{ submitted: 1 }]);
    const result = await store.list(actor, 2, true, {
      query: 'SQL',
      kind: 'REQUEST',
      status: 'SUBMITTED',
      priority: 'NORMAL',
      category: 'LEARNING',
    });
    assert.equal(result.items[0].recipientId, manager);
    assert.equal(result.items[0].updatedAt, at.toISOString());
    assert.equal(result.page, 2);
    assert.equal(f.calls.at(-1)?.inputs.inbox, true);
    f.reply('dbo.ReadWorkflowList', [{ total: 0, page: 1 }], [], [{}]);
    await store.list(actor, 1, false);
    assert.equal(f.calls.at(-1)?.inputs.query, '');
    f.reply(
      'dbo.WorkflowWorkspace',
      [row],
      [{ id, action: 'COMMENT', body: 'Delivery team has an internal workshop', at }],
    );
    const detail = await store.detail(actor, id);
    assert.equal(detail.events[0].at, at.toISOString());
    assert.equal(detail.record.requesterId, actor);
    f.reply('dbo.WorkflowWorkspace', [{ id: manager.toUpperCase(), name: 'Rohan Mehta' }]);
    assert.equal((await store.reassignmentOptions(actor, id))[0].id, manager);
    const change = {
      action: 'COMMENT' as const,
      id,
      revision: 2,
      eventId: manager,
      body: 'The workshop matches our delivery work',
    };
    f.reply('dbo.WorkflowWorkspace');
    await store.change(actor, change);
    assert.equal(f.calls.at(-1)?.inputs.payload, JSON.stringify(change));
    f.reply('dbo.WorkflowWorkspace', [
      { id, at, title: 'Workshop request', body: 'Updated', href: '/requests' },
    ]);
    assert.equal((await store.notifications(actor))[0].at, at.toISOString());
    for (const c of f.calls) {
      assert.equal(c.inputs.actor_id, actor);
      assert.equal(c.inputs.account_id, account);
    }
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [51011, 409],
      [51000, 400],
      [547, 400],
    ]) {
      f.reject('dbo.WorkflowWorkspace', { number });
      await assert.rejects(store.change(actor, change), { status });
    }
    for (const [number, status] of [
      [51003, 403],
      [51000, 400],
    ]) {
      f.reject('dbo.ReadWorkflowList', { number });
      await assert.rejects(store.list(actor, 1, false), { status });
    }
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
    ]) {
      f.reject('dbo.WorkflowWorkspace', { number });
      await assert.rejects(store.reassignmentOptions(actor, id, 'Rohan'), { status });
    }
    f.reject('dbo.WorkflowWorkspace', { number: 51003 });
    await assert.rejects(store.options(actor, 'Rohan'), { status: 403 });
    const error = new Error('offline');
    for (const [proc, run] of [
      ['dbo.WorkflowWorkspace', () => store.detail(actor, id)],
      ['dbo.WorkflowWorkspace', () => store.options(actor)],
      ['dbo.WorkflowWorkspace', () => store.reassignmentOptions(actor, id)],
      ['dbo.ReadWorkflowList', () => store.list(actor, 1, false)],
    ] as const) {
      f.reject(proc, error);
      await assert.rejects(run(), e => e === error);
    }
  } finally {
    await f.finish();
  }
});
test('recommendation SQL adapter distinguishes sent/received views, optional plans and denied relationships', async () => {
  const f = sqlAdapterFixture();
  try {
    const store = new SqlRecommendationStore(account),
      recommendation = {
        id: id.toUpperCase(),
        personId: actor.toUpperCase(),
        senderId: manager.toUpperCase(),
        skillId: account.toUpperCase(),
        planId: id.toUpperCase(),
        title: 'SQL performance',
      };
    f.reply(
      'dbo.LearningRecommendations',
      [{ total: 2 }],
      [recommendation, { ...recommendation, planId: null }],
    );
    const data = await store.read(actor, 'received', 2, id);
    assert.equal(data.items[0].planId, id);
    assert.equal(data.items[1].planId, undefined);
    assert.deepEqual(JSON.parse(String(f.calls.at(-1)?.inputs.payload)), {
      view: 'received',
      page: 2,
      id,
    });
    f.reply('dbo.LearningRecommendations', [{ total: 0 }], []);
    await store.read(actor, 'sent', 1);
    f.reply('dbo.LearningRecommendations', [{ id: manager.toUpperCase(), name: 'Rohan Mehta' }]);
    assert.equal((await store.options(actor, 'Rohan')).people[0].id, manager);
    const send = {
      id,
      personId: actor,
      skillId: account,
      rank: 3,
      reason: 'Practise customer reporting queries',
      resource: 'https://learn.microsoft.com/en-us/sql/',
    } as SendRecommendation;
    f.reply('dbo.LearningRecommendations');
    assert.deepEqual(await store.send(actor, send), { saved: true, id });
    const response = {
      id,
      action: 'ACCEPT',
      revision: 1,
      plan: { id: manager },
    } as RecommendationResponse;
    f.reply('dbo.LearningRecommendations');
    assert.equal((await store.respond(actor, response)).planId, manager);
    f.reply('dbo.LearningRecommendations');
    assert.equal(
      (
        await store.respond(actor, {
          id,
          action: 'DECLINE',
          revision: 1,
          message: 'Already covered in my current learning plan',
        })
      ).planId,
      undefined,
    );
    f.reply('dbo.LearningRecommendations', [
      {
        id,
        at,
        title: 'SQL recommendation',
        body: 'From Rohan',
        href: '/LEARNING?RECOMMENDATION=' + id.toUpperCase(),
      },
    ]);
    assert.equal((await store.notifications(actor))[0].href, '/learning?recommendation=' + id);
    for (const [number, status] of [
      [51003, 403],
      [51004, 404],
      [51009, 409],
      [2601, 409],
      [2627, 409],
      [51000, 400],
      [51010, 400],
    ]) {
      f.reject('dbo.LearningRecommendations', { number });
      await assert.rejects(store.read(actor, 'received', 1), { status });
    }
    const error = new Error('offline');
    f.reject('dbo.LearningRecommendations', error);
    await assert.rejects(store.read(actor, 'received', 1), e => e === error);
  } finally {
    await f.finish();
  }
});
