import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeWithinBudget, MemoryAiBudget, SqlAiBudget } from '../src/modules/ai/budget.js';
import { AssistantService, type Provider } from '../src/modules/ai/assistant.js';
import { responsesUsage } from '../src/modules/ai/usage.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
const limited = (e: unknown) => (e as { status?: number }).status === 429;

test('blank SQL token limits use defaults and a lock timeout differs from exhausted quota', async () => {
  const fixture = sqlAdapterFixture();
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  try {
    const budget = new SqlAiBudget(id, {
      AI_ACTOR_DAILY_TOKEN_LIMIT: '',
      AI_ACCOUNT_DAILY_TOKEN_LIMIT: '   ',
    });
    fixture.reject('dbo.AiTokenBudget', { number: 51029, message: 'AI token budget busy.' });
    await assert.rejects(budget.reserveTokens(id, 42), { status: 503 });
    fixture.reject('dbo.AiTokenBudget', { number: 51029, message: 'AI token budget exhausted.' });
    await assert.rejects(budget.reserveTokens(id, 42), { status: 429 });
    assert.equal(fixture.calls[0].inputs.actor_limit, 350_000);
    assert.equal(fixture.calls[0].inputs.account_limit, 5_000_000);
    assert.throws(
      () => new SqlAiBudget(id, { AI_ACTOR_DAILY_TOKEN_LIMIT: '0' }),
      /Invalid AI_ACTOR/,
    );
  } finally {
    await fixture.finish();
  }
});
test('token reservations protect shared capacity and settle once against the original UTC day', async () => {
  let now = 0;
  const budget = new MemoryAiBudget(() => now, { actor: 100, account: 120 });
  const first = await budget.reserveTokens('a', 80);
  await assert.rejects(budget.reserveTokens('a', 21), limited);
  await assert.rejects(budget.reserveTokens('b', 41), limited);
  await first(30);
  await first(0);
  const second = await budget.reserveTokens('b', 90);
  await assert.rejects(budget.reserveTokens('a', 1), limited);
  now = 86_400_000;
  const current = await budget.reserveTokens('b', 100);
  await second(1);
  await assert.rejects(budget.reserveTokens('b', 1), limited);
  await current(100);
});

test('provider failures with usage still spend tokens and unknown usage keeps the reservation', async () => {
  let calls = 0;
  const provider: Provider = {
    name: 'synthetic',
    complete: async (_messages, _tools, _signal, options) => {
      calls++;
      if (calls === 1) {
        options?.onUsage?.(responsesUsage({ input_tokens: 170, output_tokens: 50 }));
        throw Error('Provider failure after billing');
      }
      return { content: 'Done.', calls: [] };
    },
  };
  const budget = new MemoryAiBudget(() => 0, { actor: 270, account: 400 });
  const run = (actor: string) =>
    completeWithinBudget(budget, actor, provider, [], [], new AbortController().signal, {
      maxOutputTokens: 100,
    });
  await assert.rejects(run('a'), /after billing/);
  await assert.rejects(run('a'), limited);
  await run('b');
  await assert.rejects(run('b'), limited);
  assert.equal(calls, 2);
});
test('shared budget rejects overlapping replies and shares quotas between service instances', async () => {
  const budget = new MemoryAiBudget(),
    store = await LocalAccessStore.open(),
    actor = store.snapshot().people[0].id;
  const provider = { name: 'stub', complete: async () => ({ content: 'Done', calls: [] }) };
  const service = () =>
    new AssistantService(
      store,
      undefined,
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      budget,
    );
  const a = service(),
    b = service(),
    input = { messages: [{ role: 'user', content: 'Explain my workspace' }] };
  const release = await budget.acquire(actor);
  await assert.rejects(b.chat(actor, input), limited);
  await release();
  for (let n = 0; n < 9; n++) await a.chat(actor, input);
  await assert.rejects(b.chat(actor, input), limited);
});
test('leases expire, old release cannot clear new lease, and minute/day budgets reset', async () => {
  let now = 0;
  const budget = new MemoryAiBudget(() => now);
  const old = await budget.acquire('actor');
  now = 120001;
  const current = await budget.acquire('actor');
  await old();
  await assert.rejects(budget.acquire('actor'), limited);
  await current();
  for (let i = 0; i < 9; i++) await (await budget.acquire('actor'))();
  await assert.rejects(budget.acquire('actor'), limited);
  now += 60000;
  await (
    await budget.acquire('actor')
  )();
});
test('account daily budget is shared across actors and failed model calls release concurrency', async () => {
  let now = 0;
  const budget = new MemoryAiBudget(() => now);
  for (let i = 0; i < 500; i++) await (await budget.acquire(String(i)))();
  await assert.rejects(budget.acquire('another'), limited);
  now = 86400000;
  await (
    await budget.acquire('another')
  )();
  const store = await LocalAccessStore.open(),
    actor = store.snapshot().people[0].id;
  const service = new AssistantService(
    store,
    undefined,
    {
      name: 'stub',
      complete: async () => {
        throw Error('Provider failed');
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    budget,
  );
  await assert.rejects(
    service.chat(actor, { messages: [{ role: 'user', content: 'Help' }] }),
    /Provider failed/,
  );
  await (
    await budget.acquire(actor)
  )();
});
