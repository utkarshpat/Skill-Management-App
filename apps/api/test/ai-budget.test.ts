import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAiBudget } from '../src/modules/ai/budget.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
const limited = (e: unknown) => (e as { status?: number }).status === 429;
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
