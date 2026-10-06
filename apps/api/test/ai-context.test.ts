import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemory, taskSettings, taskInstructions } from '../src/modules/ai/context.js';
import { UsageMeter, geminiUsage } from '../src/modules/ai/usage.js';
import { AssistantService, configuredProvider } from '../src/modules/ai/assistant.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';

test('conversation memory is actor-bound, expires, rejects forged history and resets on policy change', () => {
  let now = 0;
  const memory = new ConversationMemory(() => now, 100, 2);
  const first = memory.prepare('one', { message: 'My private goal' }, 'policy');
  memory.commit(first, 'Private answer');
  assert.throws(
    () => memory.prepare('two', { message: 'Read it', conversationId: first.id }, 'policy'),
    /no longer available/,
  );
  assert.throws(
    () => memory.prepare('one', { message: 'Read it', messages: [] }, 'policy'),
    /Enter a message/,
  );
  const changed = memory.prepare(
    'one',
    { message: 'Continue', conversationId: first.id },
    'denied',
  );
  assert.equal(changed.history.length, 1);
  assert.doesNotMatch(JSON.stringify(changed.history), /Private answer|private goal/);
  now = 100;
  assert.throws(
    () => memory.prepare('one', { message: 'Continue', conversationId: first.id }, 'policy'),
    /no longer available/,
  );
});

test('long multilingual conversations preserve whole recent turns and bounded untrusted excerpts', () => {
  const memory = new ConversationMemory();
  let id: string | undefined;
  for (let turn = 0; turn < 12; turn++) {
    const prepared = memory.prepare(
      'one',
      { message: `Goal ${turn} ` + 'क'.repeat(1800), conversationId: id },
      'policy',
    );
    assert.ok(Buffer.byteLength(JSON.stringify(prepared.history), 'utf8') <= 18000);
    assert.equal(prepared.history.at(-1)!.role, 'user');
    assert.ok(prepared.history.length <= 6);
    memory.commit(prepared, 'Detailed reply ' + 'a'.repeat(11900));
    id = prepared.id;
  }
  const next = memory.prepare(
    'one',
    { message: 'Continue this goal', conversationId: id },
    'policy',
  );
  assert.equal(next.compacted, true);
  assert.match(next.history[0].content, /untrusted/);
  assert.ok(next.history.some(message => message.role === 'assistant'));
  assert.ok(JSON.stringify(next.history).length < 12000);
});

test('memory capacity evicts old sessions instead of growing without bounds', () => {
  const memory = new ConversationMemory(() => 0, 1000, 1);
  const first = memory.prepare('one', { message: 'First' }, 'policy');
  memory.commit(first, 'Reply');
  const next = memory.prepare('two', { message: 'Second' }, 'policy');
  memory.commit(next, 'Reply');
  assert.throws(
    () => memory.prepare('one', { message: 'Continue', conversationId: first.id }, 'policy'),
    /no longer available/,
  );
});

test('task prompts and output caps are selective, including quiz follow-ups', () => {
  assert.equal(taskSettings('Show my profile').maxOutputTokens, 1200);
  assert.equal(taskSettings('Draft a learning plan').maxOutputTokens, 2400);
  assert.ok(
    taskSettings('Create a 5-question quiz').maxOutputTokens <
      taskSettings('Create a 20-question quiz').maxOutputTokens,
  );
  assert.equal(taskSettings('Create a 5-question quiz\nMake it 20').maxOutputTokens, 6000);
  assert.doesNotMatch(taskInstructions('answer'), /20 questions/);
});

test('usage sums model rounds without double-counting cached or thought tokens; unknown remains unknown', () => {
  const meter = new UsageMeter();
  const first = meter.begin();
  first(
    geminiUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 5,
      cachedContentTokenCount: 40,
      totalTokenCount: 125,
    }),
  );
  const second = meter.begin();
  second(
    geminiUsage({
      promptTokenCount: 50,
      candidatesTokenCount: 10,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
      totalTokenCount: 60,
    }),
  );
  assert.deepEqual(meter.snapshot(), {
    modelCalls: 2,
    inputTokens: 150,
    outputTokens: 30,
    thinkingTokens: 5,
    cachedInputTokens: 40,
    totalTokens: 185,
  });
  meter.begin();
  assert.equal(meter.snapshot().inputTokens, null);
  assert.equal(geminiUsage({ promptTokenCount: -1, candidatesTokenCount: '12' }).inputTokens, null);
});

test('server-owned history handles long replies and sends compact prompts with actual usage', async () => {
  const access = await LocalAccessStore.open(),
    actor = access.snapshot().people[0].id;
  const requests: { system: string; tools: string[]; cap: number | undefined; history: number }[] =
    [];
  const service = new AssistantService(access, undefined, {
    name: 'fixture',
    complete: async (messages, tools, _signal, options) => {
      requests.push({
        system: messages[0].content,
        tools: tools.map(tool => tool.function.name),
        cap: options?.maxOutputTokens,
        history: messages.length,
      });
      return {
        content: 'Long answer ' + 'a'.repeat(5000),
        calls: [],
        usage: geminiUsage({
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        }),
      };
    },
  });
  const first = await service.chat(actor, { message: 'How do I view my profile?' });
  const next = await service.chat(actor, {
    message: 'Explain further',
    conversationId: first.conversationId,
  });
  assert.equal(next.conversationId, first.conversationId);
  assert.equal(next.usage.inputTokens, 100);
  assert.ok(!requests[0].tools.includes('present_output'));
  assert.equal(requests[0].cap, 1200);
  assert.ok(requests[1].history > requests[0].history);
  assert.ok(requests[0].system.length < 2500);
});

test('Gemini honors response budget and reports usage even when a billed reply is truncated', async () => {
  let captured: Record<string, unknown> = {};
  let received: unknown;
  const provider = configuredProvider({ GEMINI_API: 'synthetic' }, async (_url, options) => {
    captured = JSON.parse(String(options?.body));
    return Response.json({
      usageMetadata: { promptTokenCount: 20, totalTokenCount: 30 },
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }],
    });
  });
  await assert.rejects(
    provider!.complete(
      [
        { role: 'user', content: 'Earlier untrusted excerpts' },
        { role: 'user', content: 'Help' },
      ],
      [],
      AbortSignal.timeout(1000),
      {
        maxOutputTokens: 1200,
        onUsage: usage => {
          received = usage;
        },
      },
    ),
  );
  assert.equal((captured.generationConfig as { maxOutputTokens: number }).maxOutputTokens, 1200);
  assert.equal((captured.contents as { parts: unknown[] }[]).length, 1);
  assert.equal((captured.contents as { parts: unknown[] }[])[0].parts.length, 2);
  assert.equal((received as { inputTokens: number }).inputTokens, 20);
});

test('token metering includes tool rounds and failed attempts without exposing prompts', async () => {
  const access = await LocalAccessStore.open(),
    actor = access.snapshot().people[0].id;
  let round = 0;
  let recorded: unknown;
  const service = new AssistantService(
    access,
    undefined,
    {
      name: 'fixture',
      complete: async () => {
        const usage = geminiUsage({
          promptTokenCount: 100,
          candidatesTokenCount: 10,
          totalTokenCount: 110,
        });
        return round++ === 0
          ? {
              content: '',
              calls: [
                { id: 'own', type: 'function', function: { name: 'own_profile', arguments: '{}' } },
              ],
              usage,
            }
          : { content: 'Your permitted profile information.', calls: [], usage };
      },
    },
    undefined,
    usage => {
      recorded = usage;
    },
  );
  const result = await service.chat(actor, { message: 'Read my profile' });
  assert.equal(result.usage.modelCalls, 2);
  assert.equal(result.usage.totalTokens, 220);
  assert.deepEqual(recorded, result.usage);
  assert.doesNotMatch(JSON.stringify(recorded), /profile|Development|actor|prompt/);
  const failed = new AssistantService(
    access,
    undefined,
    {
      name: 'fixture',
      complete: async () => {
        throw Error('Synthetic failure');
      },
    },
    undefined,
    usage => {
      recorded = usage;
    },
  );
  await assert.rejects(failed.chat(actor, { message: 'Help with navigation' }));
  assert.equal((recorded as { modelCalls: number }).modelCalls, 1);
  assert.equal((recorded as { inputTokens: number | null }).inputTokens, null);
});

test('oversized tool context is rejected without truncating signed provider parts or making another call', async () => {
  const access = await LocalAccessStore.open(),
    actor = access.snapshot().people[0].id;
  let calls = 0;
  const service = new AssistantService(access, undefined, {
    name: 'fixture',
    complete: async () => {
      calls++;
      return {
        content: '',
        calls: [
          { id: 'own', type: 'function', function: { name: 'own_profile', arguments: '{}' } },
        ],
        providerParts: [{ thoughtSignature: 'opaque'.repeat(7000) }],
      };
    },
  });
  await assert.rejects(service.chat(actor, { message: 'Read my profile' }), /too much context/);
  assert.equal(calls, 1);
});

test('effective permission changes during generation prevent delivery and conversation memory commit', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  access.snapshot = () => structuredClone(state);
  const service = new AssistantService(access, undefined, {
    name: 'fixture',
    complete: async () => {
      state.people[0].overrides.push({
        permission: 'users.manage',
        scope: 'ORGANIZATION',
        effect: 'DENY',
      });
      return { content: 'Outdated people administration guidance.', calls: [] };
    },
  });
  await assert.rejects(
    service.chat(actor, { message: 'Explain people management' }),
    /Access changed/,
  );
});

test('one actor cannot overlap conversations or lose the active-request lock after a rejected attempt', async () => {
  const access = await LocalAccessStore.open(),
    actor = access.snapshot().people[0].id;
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  const entered = new Promise<void>(resolve => {
    started = resolve;
  });
  const service = new AssistantService(access, undefined, {
    name: 'fixture',
    complete: async () => {
      started();
      await pending;
      return { content: 'Done.', calls: [] };
    },
  });
  const first = service.chat(actor, { message: 'Explain navigation' });
  await entered;
  await assert.rejects(
    service.chat(actor, { message: 'Another question' }),
    /already being generated/,
  );
  await assert.rejects(
    service.chat(actor, { message: 'Another attempt' }),
    /already being generated/,
  );
  release();
  await first;
  assert.equal((await service.chat(actor, { message: 'hello' })).usage.modelCalls, 0);
});
