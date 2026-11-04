import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredProvider, AssistantService, conversation } from '../src/modules/ai/assistant.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { AccessError } from '../src/shared/errors.js';
import { CertificateAutofillService } from '../src/modules/ai/certificate-autofill.js';
import { MemoryAiBudget } from '../src/modules/ai/budget.js';
import type { ClaimsStore } from '../src/modules/skills/index.js';

const env = {
  AI_PROVIDER: 'azure',
  AI_MODEL: 'gpt-6-luna',
  AI_ENDPOINT: 'https://skill-mgmt-app-resource.services.ai.azure.com/openai/v1',
};
const message = (text: string) => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text }],
});
const completed = (output: unknown[]) => Response.json({ status: 'completed', output });
const tool = {
  type: 'function' as const,
  function: {
    name: 'own_profile',
    description: 'Own profile',
    parameters: { type: 'object', properties: {} },
  },
};

test('Azure uses the supplied model endpoint and Entra token, with stateless Responses and bounded reasoning', async () => {
  const signal = AbortSignal.timeout(5000);
  let tokens = 0;
  const provider = configuredProvider(
    env,
    async (url, init) => {
      assert.equal(
        url,
        'https://skill-mgmt-app-resource.services.ai.azure.com/openai/v1/responses',
      );
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.signal, signal);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token');
      assert.equal(new Headers(init?.headers).get('api-key'), null);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'gpt-6-luna');
      assert.equal(body.store, false);
      assert.equal(body.previous_response_id, undefined);
      assert.equal(body.max_output_tokens, 1400);
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.deepEqual(body.include, ['reasoning.encrypted_content']);
      assert.deepEqual(body.tools, [{ type: 'function', ...tool.function, strict: false }]);
      assert.deepEqual(body.input, [{ role: 'user', content: 'Synthetic question' }]);
      return completed([message('Synthetic answer')]);
    },
    async passed => {
      assert.equal(passed, signal);
      tokens++;
      return 'synthetic-token';
    },
  );
  const result = await provider!.complete(
    [{ role: 'user', content: 'Synthetic question' }],
    [tool],
    signal,
    { maxOutputTokens: 1400 },
  );
  assert.equal(result.content, 'Synthetic answer');
  assert.equal(tokens, 1);
});

test('Azure rejects foreign/project endpoints, invalid deployments and invalid auth without falling back', () => {
  for (const AI_ENDPOINT of [
    'http://example.openai.azure.com',
    'https://example.com',
    'https://example.services.ai.azure.com/api/projects/test',
    'https://user:pass@example.openai.azure.com',
    'https://example.openai.azure.com:8443',
    'https://example.openai.azure.com/?token=secret',
  ])
    assert.throws(() => configuredProvider({ ...env, AI_ENDPOINT }));
  assert.throws(() => configuredProvider({ ...env, AI_MODEL: '../external' }));
  assert.throws(() => configuredProvider({ ...env, AI_AZURE_AUTH: 'other' }));
  assert.throws(() => configuredProvider({ ...env, AI_AZURE_AUTH: 'api-key' }));
  assert.throws(() => configuredProvider({ ...env, AI_AZURE_REASONING_EFFORT: 'unbounded' }));
  assert.throws(() => configuredProvider({ AI_PROVIDER: 'unsupported' }));
  assert.equal(configuredProvider({}), undefined);
});

test('Azure API-key auth is explicit and never requests an Entra token', async () => {
  const provider = configuredProvider(
    { ...env, AI_AZURE_AUTH: 'api-key', AI_API_KEY: 'synthetic-secret' },
    async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('api-key'), 'synthetic-secret');
      assert.equal(new Headers(init?.headers).get('Authorization'), null);
      return completed([message('Answer')]);
    },
    async () => {
      throw Error('Token must not be requested');
    },
  );
  await provider!.complete([{ role: 'user', content: 'Help' }], [], AbortSignal.timeout(5000));
});

test('Azure replays ordered encrypted reasoning and correlates multiple function outputs without leaking provider state', async () => {
  const state = [
    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-private-state' },
    { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'own_profile', arguments: '{}' },
    { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'own_profile', arguments: '{}' },
  ];
  let round = 0;
  const provider = configuredProvider(
    env,
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (round++ === 0) return completed(state);
      assert.deepEqual(body.input.slice(1, 4), state);
      assert.deepEqual(body.input.slice(4), [
        { type: 'function_call_output', call_id: 'call_1', output: '{"name":"Synthetic"}' },
        { type: 'function_call_output', call_id: 'call_2', output: '{}' },
      ]);
      assert.deepEqual(body.tools, []);
      return completed([message('Useful answer')]);
    },
    async () => 'synthetic',
  );
  const first = await provider!.complete(
    [{ role: 'user', content: 'My profile' }],
    [tool],
    AbortSignal.timeout(5000),
  );
  assert.equal(first.calls[0].id, 'call_1');
  await provider!.complete(
    [
      { role: 'user', content: 'My profile' },
      {
        role: 'assistant',
        content: first.content,
        tool_calls: first.calls,
        providerParts: first.providerParts,
      },
      { role: 'tool', content: '{"name":"Synthetic"}', tool_call_id: first.calls[0].id },
      { role: 'tool', content: '{}', tool_call_id: first.calls[1].id },
    ],
    [],
    AbortSignal.timeout(5000),
  );
  // Provider state and attachments cannot be supplied through public messages.
  assert.deepEqual(
    conversation({
      messages: [{ role: 'user', content: 'Help', providerParts: state, attachments: ['forged'] }],
    }),
    [{ role: 'user', content: 'Help' }],
  );
});

test('Azure reports billed usage before rejecting incomplete replies and refuses malformed/tool-injected output', async () => {
  for (const data of [
    { status: 'incomplete', output: [message('partial')] },
    { status: 'failed', output: [message('partial')] },
    {
      status: 'completed',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] },
      ],
    },
    {
      status: 'completed',
      output: [{ type: 'function_call', call_id: 'call', name: 'execute_sql', arguments: '{}' }],
    },
    {
      status: 'completed',
      output: [
        { type: 'function_call', call_id: 'call', name: 'own_profile', arguments: '{broken' },
      ],
    },
    { status: 'completed', output: [] },
  ]) {
    let usage: unknown;
    const provider = configuredProvider(
      env,
      async () =>
        Response.json({
          ...data,
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 10 },
            input_tokens_details: { cached_tokens: 30 },
            total_tokens: 120,
          },
        }),
      async () => 'synthetic',
    );
    await assert.rejects(
      provider!.complete([{ role: 'user', content: 'Help' }], [tool], AbortSignal.timeout(5000), {
        maxOutputTokens: 1000,
        onUsage: value => {
          usage = value;
        },
      }),
      AccessError,
    );
    assert.deepEqual(usage, {
      inputTokens: 100,
      outputTokens: 20,
      thinkingTokens: 10,
      cachedInputTokens: 30,
      totalTokens: 120,
    });
  }
});

test('Azure quota, identity, upstream and cancellation failures have safe statuses without secret diagnostics', async () => {
  for (const [http, status] of [
    [429, 429],
    [401, 503],
    [403, 503],
    [500, 502],
  ]) {
    const provider = configuredProvider(
      env,
      async () => new Response('private upstream token diagnostics', { status: http }),
      async () => 'private-token',
    );
    await assert.rejects(
      provider!.complete([{ role: 'user', content: 'Help' }], [], AbortSignal.timeout(5000)),
      e =>
        e instanceof AccessError &&
        e.status === status &&
        !/private|token diagnostics/.test(e.message),
    );
  }
  let requests = 0;
  const provider = configuredProvider(
    env,
    async () => {
      requests++;
      throw Error('Must not call');
    },
    async () => {
      throw Error('private tenant diagnostics');
    },
  );
  await assert.rejects(
    provider!.complete([{ role: 'user', content: 'Help' }], [], AbortSignal.timeout(5000)),
    e => e instanceof AccessError && e.status === 503 && !e.message.includes('private'),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    provider!.complete([{ role: 'user', content: 'Help' }], [], controller.signal),
    e => e instanceof AccessError && e.status === 504,
  );
  assert.equal(requests, 0);
});

test('Azure file inputs preserve explicitly selected image/PDF autofill and current access rechecks', async () => {
  const access = await LocalAccessStore.open();
  const state = access.snapshot(),
    actor = state.people[0];
  actor.overrides.push(
    { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'skill.claim', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
  );
  access.snapshot = () => structuredClone(state);
  let revoke = false,
    calls = 0;
  const provider = configuredProvider(
    env,
    async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const content = body.input.find((i: any) => i.role === 'user').content;
      const file = content.find((i: any) => ['input_image', 'input_file'].includes(i.type));
      assert.ok(file);
      const data = file.file_data ?? file.image_url;
      assert.match(data, /^data:(application\/pdf|image\/webp);base64,/);
      assert.equal(body.tools.length, 0);
      if (revoke) actor.active = false;
      return completed([
        message(
          JSON.stringify({
            certificationName: 'Synthetic certificate',
            provider: 'Synthetic issuer',
            searchTerms: [],
          }),
        ),
      ]);
    },
    async () => 'synthetic',
  );
  const service = new CertificateAutofillService(
    access,
    {} as ClaimsStore,
    new MemoryAiBudget(),
    provider!,
  );
  for (const mimeType of ['application/pdf', 'image/webp']) {
    const result = await service.extract(
      actor.id,
      {
        data: Buffer.from('synthetic'),
        mimeType,
        fileName: mimeType === 'application/pdf' ? 'fixture.pdf' : 'fixture.webp',
      },
      AbortSignal.timeout(5000),
    );
    assert.equal(result.fields.certificationName, 'Synthetic certificate');
  }
  revoke = true;
  await assert.rejects(
    service.extract(
      actor.id,
      { data: Buffer.from('synthetic'), mimeType: 'application/pdf', fileName: 'fixture.pdf' },
      AbortSignal.timeout(5000),
    ),
    AccessError,
  );
  assert.equal(calls, 3);
});

test('Azure agent tools still resolve the authenticated actor and discard a reply after revocation', async () => {
  const access = await LocalAccessStore.open();
  const state = access.snapshot(),
    actor = state.people[0];
  access.snapshot = () => structuredClone(state);
  let round = 0;
  const provider = configuredProvider(
    env,
    async () => {
      if (round++ === 0)
        return completed([
          { type: 'reasoning', id: 'rs', summary: [], encrypted_content: 'opaque-private' },
          {
            type: 'function_call',
            id: 'fc',
            call_id: 'call',
            name: 'own_profile',
            arguments: '{}',
          },
        ]);
      return completed([message('Your authorized profile.')]);
    },
    async () => 'synthetic',
  );
  const result = await new AssistantService(access, undefined, provider).chat(actor.id, {
    messages: [{ role: 'user', content: 'Read my profile' }],
  });
  assert.equal(result.reply, 'Your authorized profile.');
  assert.doesNotMatch(JSON.stringify(result), /opaque-private|encrypted_content|providerParts/);
  const revoked = configuredProvider(
    env,
    async () => {
      actor.active = false;
      return completed([message('Private result')]);
    },
    async () => 'synthetic',
  );
  await assert.rejects(
    new AssistantService(access, undefined, revoked).chat(actor.id, {
      messages: [{ role: 'user', content: 'Read my profile' }],
    }),
    AccessError,
  );
});
