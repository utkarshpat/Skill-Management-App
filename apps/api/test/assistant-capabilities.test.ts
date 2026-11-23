import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { rolePresets } from '../src/modules/access/role-presets.js';
import { assistantCapabilities } from '../src/modules/ai/capabilities.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';

test('announcement guidance is an app workflow and navigation never grants publishing access', async () => {
  const store = await LocalAccessStore.open();
  const state = store.snapshot();
  const person = state.people[0];
  store.snapshot = () => structuredClone(state);
  let modelCalls = 0;
  const service = new AssistantService(store, undefined, {
    name: 'fixture',
    complete: async () => {
      modelCalls++;
      return { content: 'Unexpected model call', calls: [] };
    },
  });
  const reply = await service.chat(person.id, {
    messages: [{ role: 'user', content: 'announcement banane me help kar sakte ho?' }],
  });
  assert.match(reply.reply, /Design & preview/);
  assert.equal(modelCalls, 0);
  const navigation = await service.navigation(person.id);
  assert.ok(navigation.pages?.some(page => page.url === '/announcements'));
  assert.deepEqual(
    await service.navigation(person.id, { action: 'open_page', destination: '/announcements' }),
    { destination: '/announcements', label: 'Announcements' },
  );
  person.overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
  await assert.rejects(service.navigation(person.id), /Assistant access is not assigned/);
});

test('assistant capabilities and navigation use effective grants, not editable role names', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    person = state.people[0];
  const admin = assistantCapabilities(state, person);
  assert.equal(admin.canManagePeople, true);
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  state.roles[0].name = 'Super Admin';
  const employee = assistantCapabilities(state, person);
  assert.equal(employee.canDraftOwnSkill, true);
  assert.equal(employee.canManagePeople, false);
  state.roles[0].name = 'Manager';
  assert.deepEqual(assistantCapabilities(state, person), employee);
  person.overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
  assert.equal(assistantCapabilities(state, person).canDraftOwnSkill, false);
  state.roles[0].permissions.forEach(grant => {
    grant.validUntil = '2020-01-01T00:00:00Z';
  });
  assert.equal(assistantCapabilities(state, person).canManagePermissions, false);
});

test('permissions overview gives the model fresh effective capabilities', async () => {
  const store = await LocalAccessStore.open();
  const state = store.snapshot();
  const person = state.people[0];
  store.snapshot = () => structuredClone(state);
  person.business = {
    personalBaseline: false,
    systemAdmin: false,
    view: true,
    export: false,
    manage: false,
    amend: false,
    scopes: Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      bundle: 'BUSINESS_OPERATIONS',
      kind: 'PROJECT',
      scopeId: String(index),
      label: 'Test project ' + index,
      effect: 'ALLOW',
      validUntil: null,
      reason: 'Assigned project scope for the synthetic permissions overview fixture.',
    })),
  };
  let modelCalls = 0;
  const service = new AssistantService(store, undefined, {
    name: 'fixture',
    complete: async messages => {
      modelCalls++;
      const context = JSON.parse(messages[0].content.split('Effective capability context: ')[1]);
      return {
        content: context.canManagePeople
          ? 'People & Access is available to you.'
          : 'People & Access is not available to you.',
        calls: [],
      };
    },
  });
  const { suggestions } = await service.navigation(person.id);
  const prompt = suggestions!.find(suggestion => suggestion.label === 'What can I do?')!.prompt;
  const result = await service.chat(person.id, { message: prompt });
  assert.match(result.reply, /People & Access/);
  assert.equal(result.usage.modelCalls, 1);
  assert.ok(result.conversationId);

  person.overrides.push({ permission: 'users.manage', scope: 'ORGANIZATION', effect: 'DENY' });
  const revised = await service.chat(person.id, {
    message: 'What can I do?',
    conversationId: result.conversationId,
  });
  assert.doesNotMatch(revised.reply, /People & Access/);
  assert.equal(revised.usage.modelCalls, 1);
  assert.equal(modelCalls, 2);

  person.overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
  await assert.rejects(
    service.chat(person.id, { message: prompt }),
    /Assistant access is not assigned/,
  );
});

test('greetings use the model and every request receives fresh capability context', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    person = state.people[0];
  store.snapshot = () => structuredClone(state);
  let modelCalls = 0;
  const service = new AssistantService(store, undefined, {
    name: 'fixture',
    complete: async messages => {
      modelCalls++;
      const context = JSON.parse(messages[0].content.split('\nEffective capability context:')[1]);
      assert.equal(context.canManagePeople, false);
      assert.ok(!context.pages.some((page: { label: string }) => page.label === 'People'));
      return { content: 'I can guide you through the pages available to you.', calls: [] };
    },
  });
  assert.match(
    (await service.chat(person.id, { messages: [{ role: 'user', content: 'hello' }] })).reply,
    /pages available/,
  );
  assert.equal(modelCalls, 1);
  person.overrides.push({ permission: 'users.manage', scope: 'ORGANIZATION', effect: 'DENY' });
  assert.doesNotMatch(
    (await service.chat(person.id, { messages: [{ role: 'user', content: 'hi' }] })).reply,
    /pages available/,
  );
  assert.equal(modelCalls, 2);
  await service.chat(person.id, { messages: [{ role: 'user', content: 'What can you do?' }] });
  assert.equal(modelCalls, 3);
});

test('personal skill tool and draft are blocked without effective personal skill permission', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    person = state.people[0];
  const registry = new ToolRegistry(store, undefined, {
    read: async () => {
      throw Error('Unauthorized retrieval');
    },
    options: async () => {
      throw Error();
    },
    save: async () => {
      throw Error();
    },
  });
  assert.ok(!registry.available(state, person).some(tool => tool.function.name === 'my_skills'));
  const service = new AssistantService(store, undefined, {
    name: 'fixture',
    complete: async () => ({
      content: '',
      calls: [
        {
          id: 'card',
          type: 'function',
          function: {
            name: 'present_output',
            arguments: JSON.stringify({
              kind: 'skill_draft',
              title: 'Skill',
              summary: 'Draft',
              body: 'Experience',
              steps: [],
              questions: [],
            }),
          },
        },
      ],
    }),
  });
  await assert.rejects(
    service.chat(person.id, {
      messages: [{ role: 'user', content: 'Create a personal skill draft' }],
    }),
    /personal skill draft/,
  );
});
