import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  workflowChange,
  workflowPage,
  workflowFilters,
} from '../src/modules/workflows/workflows.js';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import type { WorkflowStore } from '../src/modules/workflows/index.js';
const input = {
  action: 'CREATE',
  id: randomUUID(),
  kind: 'REQUEST',
  priority: 'NORMAL',
  title: ' Access ',
  description: ' Business reason ',
  recipientId: randomUUID(),
};
test('workflow validation accepts editable fields only; actor, status, approval and revision cannot be supplied on create', () => {
  const v = workflowChange(input);
  assert.equal(v.action, 'CREATE');
  if (v.action === 'CREATE') assert.equal(v.title, 'Access');
  for (const bad of [
    { ...input, ownerId: randomUUID() },
    { ...input, status: 'APPROVED' },
    { ...input, kind: 'OTHER' },
    { ...input, revision: 0 },
    { ...input, title: ' ' },
    { ...input, recipientId: 'manager' },
    { ...input, description: 'x'.repeat(2001) },
  ])
    assert.throws(() => workflowChange(bad));
  assert.throws(() =>
    workflowChange({
      action: 'APPROVE',
      id: input.id,
      eventId: randomUUID(),
      revision: 1,
      body: 'Yes',
    }),
  );
  assert.throws(() => workflowPage(['1']));
  assert.throws(() => workflowPage('0'));
  assert.equal(workflowPage('2'), 2);
});
test('comments and cancellation require bounded text, event id and optimistic revision', () => {
  const b = {
    action: 'COMMENT',
    id: input.id,
    eventId: randomUUID(),
    revision: 2,
    body: ' Update ',
  };
  assert.equal(workflowChange(b).action, 'COMMENT');
  assert.equal(workflowChange({ ...b, action: 'CANCEL' }).action, 'CANCEL');
  for (const extra of [
    { revision: 0 },
    { revision: 1.1 },
    { body: '' },
    { body: 'x'.repeat(1001) },
    { eventId: 'invalid' },
    { recipientId: input.recipientId },
  ])
    assert.throws(() => workflowChange({ ...b, ...extra }));
});
test('workflow HTTP binds authenticated actor and rejects forged create fields before storage', async () => {
  const access = await LocalAccessStore.open(),
    person = access.snapshot().people[0];
  let calls = 0;
  const workflows: WorkflowStore = {
    options: async actor => {
      assert.equal(actor, person.id);
      return { canRequest: true, canIncident: false, recipients: [] };
    },
    list: async () => ({ items: [], total: 0, page: 1, pageSize: 10 }),
    detail: async () => {
      throw Error('No detail');
    },
    notifications: async () => [],
    change: async (actor, change) => {
      assert.equal(actor, person.id);
      assert.equal(change.action, 'CREATE');
      calls++;
    },
  };
  const app = createApp({
    verify: async auth => {
      if (auth !== 'Bearer trusted') throw Error();
      return { tenantId: randomUUID(), objectId: randomUUID(), displayName: 'Actor' };
    },
    profile: async () => undefined,
    resolveAccess: async () => person.id,
    access,
    workflows,
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = 'http://127.0.0.1:' + address.port;
  try {
    assert.equal((await fetch(url + '/api/workflows')).status, 401);
    const send = (b: unknown) =>
      fetch(url + '/api/workflows', {
        method: 'POST',
        headers: { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      });
    assert.equal((await send({ ...input, actorId: person.id })).status, 400);
    assert.equal(calls, 0);
    assert.equal((await send(input)).status, 200);
    assert.equal(calls, 1);
    assert.equal(
      (
        await fetch(url + '/api/workflows?page=1&owner=other', {
          headers: { Authorization: 'Bearer trusted' },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(url + '/api/workflows/options', {
          headers: { Authorization: 'Bearer trusted' },
        })
      ).status,
      200,
    );
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('request categories and list filters reject forged or ambiguous values', () => {
  const created = workflowChange({ ...input, category: 'LEARNING' });
  assert.equal(created.action === 'CREATE' && created.category, 'LEARNING');
  const legacy = workflowChange(input);
  assert.equal(legacy.action === 'CREATE' && legacy.category, 'OTHER');
  assert.throws(() => workflowChange({ ...input, category: 'ADMIN' }));
  assert.deepEqual(workflowFilters({ q: ' Java ', category: 'SKILL', inbox: 'true' }), {
    query: 'Java',
    kind: '',
    status: '',
    priority: '',
    category: 'SKILL',
  });
  for (const status of ['IN_PROGRESS', 'RESOLVED'])
    assert.equal(workflowFilters({ status }).status, status);
  for (const bad of [
    { status: 'CLOSED' },
    { category: ['SKILL', 'OTHER'] },
    { inbox: '1' },
    { q: ['a', 'b'] },
    { q: 'x'.repeat(81) },
    { actorId: input.id },
    { priority: 'URGENT' },
  ])
    assert.throws(() => workflowFilters(bad));
});

test('recipient action payloads require explicit notes, exact revisions and reassignment targets', () => {
  const base = { id: input.id, eventId: input.id, revision: 1, body: 'Reviewed action note' };
  for (const action of ['START', 'RESOLVE', 'REASSIGN']) {
    const payload = {
      ...base,
      action,
      ...(action === 'REASSIGN' ? { recipientId: input.recipientId } : {}),
    };
    assert.equal(workflowChange(payload).action, action);
    for (const forged of [
      { ...payload, actorId: input.id },
      { ...payload, status: 'RESOLVED' },
      { ...payload, revision: 0 },
      { ...payload, body: '' },
    ])
      assert.throws(() => workflowChange(forged));
  }
  assert.throws(() => workflowChange({ ...base, action: 'REASSIGN' }));
  assert.throws(() =>
    workflowChange({ ...base, action: 'RESOLVE', recipientId: input.recipientId }),
  );
});
