import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { rolePresets } from '../src/modules/access/role-presets.js';
import { assistantCapabilities, capabilityGreeting } from '../src/modules/ai/capabilities.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';

test('assistant greeting and navigation use effective grants, not editable role names', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    person = state.people[0];
  const admin = assistantCapabilities(state, person);
  assert.match(capabilityGreeting(admin), /People/);
  assert.doesNotMatch(capabilityGreeting(admin), /My skills|Draft your own skill/);
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  state.roles[0].name = 'Super Admin';
  const employee = assistantCapabilities(state, person);
  assert.match(capabilityGreeting(employee), /My skills|Draft your own skill/);
  assert.doesNotMatch(capabilityGreeting(employee), /People|Organization|Roles & permissions/);
  state.roles[0].name = 'Manager';
  assert.deepEqual(assistantCapabilities(state, person), employee);
  person.overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
  assert.equal(assistantCapabilities(state, person).canDraftOwnSkill, false);
  state.roles[0].permissions.forEach(grant => {
    grant.validUntil = '2020-01-01T00:00:00Z';
  });
  assert.equal(assistantCapabilities(state, person).canManagePermissions, false);
});

test('greetings are permission-specific and every model request receives fresh capability context', async () => {
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
      return { content: 'I can guide you through your permitted pages.', calls: [] };
    },
  });
  assert.match(
    (await service.chat(person.id, { messages: [{ role: 'user', content: 'hello' }] })).reply,
    /People/,
  );
  assert.equal(modelCalls, 0);
  person.overrides.push({ permission: 'users.manage', scope: 'ORGANIZATION', effect: 'DENY' });
  assert.doesNotMatch(
    (await service.chat(person.id, { messages: [{ role: 'user', content: 'hi' }] })).reply,
    /People/,
  );
  await service.chat(person.id, { messages: [{ role: 'user', content: 'What can you do?' }] });
  assert.equal(modelCalls, 1);
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
