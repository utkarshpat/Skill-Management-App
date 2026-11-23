import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssistantService,
  configuredProvider,
  type Provider,
} from '../src/modules/ai/assistant.js';
import {
  hasUnsupportedCodeOutput,
  workflowOnlyInstructions,
} from '../src/modules/ai/workflow-chat-policy.js';
import { coreInstructions } from '../src/modules/ai/context.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import type { AiBudget } from '../src/modules/ai/budget.js';

test('language policy follows the latest message and falls back to English', () => {
  assert.match(coreInstructions, /language of the latest user message/);
  assert.match(coreInstructions, /if unclear, use English/);
  assert.match(workflowOnlyInstructions, /latest user message/);
  assert.match(workflowOnlyInstructions, /use English/);
});

test('model identity is answered with configured provider metadata in the user language', async () => {
  const store = await LocalAccessStore.open(),
    actor = store.snapshot().people[0].id;
  let instructions = '';
  const provider: Provider = {
    name: 'azure',
    deployment: 'team-deployment',
    complete: async messages => {
      instructions = messages[0].content;
      return { content: 'Configured deployment team-deployment hai.', calls: [] };
    },
  };
  const service = new AssistantService(store, undefined, provider);
  const identity = await service.chat(actor, { message: 'konsa ai model se response kr rhe ho' });
  assert.match(identity.reply, /team-deployment/);
  assert.match(instructions, /deployment=team-deployment/);
  assert.match(instructions, /latest user message language/);
  const azure = configuredProvider({
    AI_PROVIDER: 'azure',
    AI_MODEL: 'team-deployment',
    AI_ENDPOINT: 'https://team.services.ai.azure.com/openai/v1',
    AI_AZURE_AUTH: 'api-key',
    AI_API_KEY: 'test-only',
  });
  assert.equal(azure?.deployment, 'team-deployment');
  assert.equal(
    configuredProvider({ AI_PROVIDER: 'ollama', AI_MODEL: 'local-deployment' })?.deployment,
    'local-deployment',
  );
});

test('code guard detects generated code while allowing ordinary workflow guidance', () => {
  for (const content of [
    '```js\nfunction factorial(n) {}\n```',
    'function factorial(n) { return n; }',
    'Here is the query:\nSELECT name FROM employees',
    'const result = 5;',
  ])
    assert.equal(hasUnsupportedCodeOutput(content), true);
  for (const content of [
    'Open Requests, choose New request, then review the recipient before submitting.',
    'Select a person from People & Access, then preview the change.',
  ])
    assert.equal(hasUnsupportedCodeOutput(content), false);
});

test('unsupported generated code is replaced by a model response in the latest user language', async () => {
  const store = await LocalAccessStore.open(),
    actor = store.snapshot().people[0].id;
  const prompts: string[] = [];
  const service = new AssistantService(store, undefined, {
    name: 'test',
    complete: async messages => {
      prompts.push(messages[0].content);
      return prompts.length === 1
        ? { content: '```js\nconst x = 1;\n```', calls: [] }
        : { content: 'Is app mein main sirf available workflows mein madad kar sakta hoon.', calls: [] };
    },
  });
  const result = await service.chat(actor, {
    message: 'mujhe JavaScript code likh do',
  });
  assert.match(result.reply, /sirf available workflows/);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /latest user message language/);
});

test('in-scope chat retains authorization and server tools while instructing the model to match language', async () => {
  const store = await LocalAccessStore.open(),
    actor = store.snapshot().people[0].id;
  let instructions = '';
  const service = new AssistantService(store, undefined, {
    name: 'test',
    complete: async messages => {
      instructions = messages[0].content;
      return { content: 'I can help with your current skill claims.', calls: [] };
    },
  });
  await service.chat(actor, { message: 'Help me review my current skill claims' });
  assert.match(instructions, /implemented workflows only/);
  assert.match(instructions, /server-authorized tools/);
  assert.match(instructions, /latest user message/);
});

test('ordinary and identity responses use the model budget, and inactive users remain blocked', async () => {
  const store = await LocalAccessStore.open(),
    actor = store.snapshot().people[0].id;
  let generations = 0,
    reservations = 0;
  const provider: Provider = {
    name: 'azure',
    deployment: 'team-deployment',
    complete: async () => {
      generations++;
      return { content: 'A model response.', calls: [] };
    },
  };
  const budget: AiBudget = {
    acquire: async () => {
      reservations++;
      return async () => {};
    },
  };
  const service = new AssistantService(
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
  await service.chat(actor, { message: 'konsa ai model se response kr rhe ho' });
  await service.chat(actor, { message: 'Show my current skill claims' });
  assert.equal(generations, 2);
  assert.equal(reservations, 2);
  const state = store.snapshot();
  state.people[0].active = false;
  store.snapshot = () => structuredClone(state);
  await assert.rejects(service.chat(actor, { message: 'write JavaScript code' }), { status: 403 });
});
