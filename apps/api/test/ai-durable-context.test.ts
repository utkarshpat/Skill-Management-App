import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/create-app.js';
import { AssistantService, type Provider } from '../src/modules/ai/assistant.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { AccessError } from '../src/shared/errors.js';
import type { ConversationsStore, SavedConversation } from '../src/modules/ai/conversations.js';

class TestHistory implements ConversationsStore {
  records = new Map<string, SavedConversation>();
  fail = false;
  async list(actor: string) {
    return [...this.records.values()]
      .filter(item => item.context.actor === actor)
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  }
  async read(actor: string, id: string) {
    const value = this.records.get(id);
    if (!value || value.context.actor !== actor)
      throw new AccessError(404, 'Conversation unavailable.');
    return structuredClone(value);
  }
  async save(actor: string, value: SavedConversation) {
    if (this.fail) throw new AccessError(503, 'Storage unavailable.');
    const current = this.records.get(value.id);
    if ((current?.revision ?? 0) !== value.revision) throw new AccessError(409, 'Changed');
    assert.equal(value.context.actor, actor);
    this.records.delete(value.id);
    this.records.set(value.id, structuredClone({ ...value, revision: value.revision + 1 }));
    const own = [...this.records.values()].filter(item => item.context.actor === actor);
    for (const old of own.slice(0, -2)) this.records.delete(old.id);
  }
  async delete(actor: string, id: string) {
    await this.read(actor, id);
    this.records.delete(id);
  }
}
test('durable chats resume after service restart, stay actor-bound and retain only two successful conversations', async () => {
  const access = await LocalAccessStore.open(),
    actor = access.snapshot().people[0].id,
    history = new TestHistory();
  let seen = '';
  const provider: Provider = {
    name: 'test',
    complete: async messages => {
      seen = JSON.stringify(messages);
      return { content: 'Acknowledged your goal.', calls: [] };
    },
  };
  const make = () =>
    new AssistantService(access, undefined, provider, undefined, undefined, undefined, history);
  const first = await make().chat(actor, { message: 'My goal is typed APIs' });
  assert.ok(first.conversationId);
  const restarted = make();
  await restarted.chat(actor, {
    message: 'Continue my goal',
    conversationId: first.conversationId,
  });
  assert.match(seen, /typed APIs/);
  const transcript = await restarted.history(actor, first.conversationId);
  assert.ok(transcript.messages);
  assert.equal(transcript.messages.length, 4);
  await assert.rejects(history.read('foreign', first.conversationId!), /unavailable/);
  await make().chat(actor, { message: 'Second conversation' });
  history.fail = true;
  await assert.rejects(
    make().chat(actor, { message: 'Failed third conversation' }),
    /Storage unavailable/,
  );
  assert.equal((await history.list(actor)).length, 2);
  history.fail = false;
  await make().chat(actor, { message: 'Third conversation' });
  assert.equal((await history.list(actor)).length, 2);
  await assert.rejects(history.read(actor, first.conversationId!), /unavailable/);
  const remaining = (await history.list(actor))[0];
  await make().history(actor, remaining.id, true);
  assert.equal((await history.list(actor)).length, 1);
});

test('durable transcript is bounded and permission changes reset model context on resume', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  access.snapshot = () => structuredClone(state);
  const history = new TestHistory();
  let seen = '';
  const provider: Provider = {
    name: 'test',
    complete: async messages => {
      seen = JSON.stringify(messages);
      return { content: 'Reply', calls: [] };
    },
  };
  const make = () =>
    new AssistantService(access, undefined, provider, undefined, undefined, undefined, history);
  const first = await make().chat(actor, { message: 'Old sensitive context' });
  state.people[0].overrides.push({
    permission: 'permissions.manage',
    scope: 'ORGANIZATION',
    effect: 'DENY',
  });
  await make().chat(actor, { message: 'Continue', conversationId: first.conversationId });
  assert.doesNotMatch(seen, /Old sensitive context/);
  const saved = await history.read(actor, first.conversationId!);
  saved.messages = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(12000),
  }));
  history.records.set(saved.id, saved);
  await make().chat(actor, { message: 'Continue', conversationId: saved.id });
  const bounded = await history.read(actor, saved.id);
  assert.ok(bounded.messages.length <= 40);
  assert.ok(JSON.stringify(bounded.messages).length <= 200000);
  state.people[0].active = false;
  await assert.rejects(make().history(actor), /not assigned/);
  await assert.rejects(
    make().chat(actor, { message: 'Continue', conversationId: saved.id }),
    /not assigned/,
  );
});

test('history HTTP binds verified actor, omits internal context and returns useful errors', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  access.snapshot = () => structuredClone(state);
  const history = new TestHistory(),
    service = new AssistantService(
      access,
      undefined,
      { name: 'test', complete: async () => ({ content: 'Answer', calls: [] }) },
      undefined,
      undefined,
      undefined,
      history,
    );
  const saved = await service.chat(actor, { message: 'A saved goal' });
  const server = createApp({
    verify: async header => {
      if (header !== 'Bearer test') throw Error();
      return { tenantId: 'test', objectId: 'test' };
    },
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access,
    assistant: service,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/assistant/conversations`,
    headers = { Authorization: 'Bearer test' };
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url + '/' + saved.conversationId + '?actorId=foreign', {
      headers,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.messages.length, 2);
    assert.equal(body.context, undefined);
    assert.equal(body.policy, undefined);
    assert.equal((await fetch(url + '/invalid', { headers })).status, 400);
    assert.equal((await fetch(url + '/' + randomUUID(), { headers })).status, 404);
    assert.equal(
      (await fetch(url + '/' + saved.conversationId, { method: 'DELETE', headers })).status,
      200,
    );
    assert.equal((await fetch(url, { headers })).status, 200);
    state.people[0].active = false;
    assert.equal((await fetch(url, { headers })).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
