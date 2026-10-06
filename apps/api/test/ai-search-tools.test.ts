import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { rolePresets } from '../src/modules/access/role-presets.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import type { CatalogueStore, ClaimsStore } from '../src/modules/skills/index.js';
const skillId = '11111111-1111-4111-8111-111111111111';
const option = {
  id: skillId,
  name: 'TypeScript',
  category: 'Engineering',
  definitionRevision: 3,
  levels: [
    { rank: 1, name: 'Foundation', description: 'Explain types and write a typed function.' },
  ],
};
const signal = () => AbortSignal.timeout(5000);

test('published catalogue search binds actor, projects compact fields and rejects foreign selectors', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  access.snapshot = () => structuredClone(state);
  let calls = 0;
  const catalogue: CatalogueStore = {
    read: async (id, query) => {
      calls++;
      assert.equal(id, actor);
      assert.deepEqual(query, { search: 'Type Script', page: 2, status: 'PUBLISHED' });
      return {
        revision: 4,
        canManage: false,
        total: 26,
        page: 2,
        pageSize: 25,
        skills: [
          { ...option, description: 'Definition narrative', status: 'PUBLISHED' },
          {
            ...option,
            id: 'hidden',
            name: 'Hidden draft',
            description: 'Private draft',
            status: 'DRAFT',
          },
        ],
      };
    },
    save: async () => {
      throw Error('No writes');
    },
  };
  const registry = new ToolRegistry(access, undefined, undefined, catalogue);
  const result = await registry.execute(
    actor,
    'catalogue_search',
    { search: ' Type   Script ', page: 2 },
    signal(),
  );
  assert.match(JSON.stringify(result.data), /TypeScript/);
  assert.doesNotMatch(
    JSON.stringify(result.data),
    /Hidden draft|Private draft|Definition narrative|Explain types/,
  );
  for (const args of [
    { personId: 'other' },
    { accountId: 'other' },
    { status: 'DRAFT' },
    { url: 'https://invalid' },
    { page: 0 },
    { page: 101 },
    { search: 'x'.repeat(101) },
  ])
    await assert.rejects(registry.execute(actor, 'catalogue_search', args, signal()));
  assert.equal(calls, 1);
  state.people[0].overrides.push({
    permission: 'skill.view',
    scope: 'ORGANIZATION',
    effect: 'DENY',
  });
  await assert.rejects(registry.execute(actor, 'catalogue_search', {}, signal()), /permission/);
  assert.equal(calls, 1);
});

test('own claim choices expose full criteria only for a selected eligible option and reject revoked access', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  access.snapshot = () => structuredClone(state);
  let revoke = false;
  let calls = 0;
  const claims: ClaimsStore = {
    read: async () => {
      throw Error();
    },
    save: async () => {
      throw Error('No writes');
    },
    options: async (id, search, page) => {
      calls++;
      assert.equal(id, actor);
      assert.equal(search, 'TypeScript');
      assert.equal(page, 1);
      if (revoke)
        state.people[0].overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
      return { skills: [option], total: 1, page: 1, pageSize: 5 };
    },
  };
  const registry = new ToolRegistry(access, undefined, claims);
  const summary = await registry.execute(
    actor,
    'skill_claim_options',
    { search: 'TypeScript' },
    signal(),
  );
  assert.doesNotMatch(JSON.stringify(summary.data), /Explain types/);
  const detail = await registry.execute(
    actor,
    'skill_claim_options',
    { search: 'TypeScript', skillId },
    signal(),
  );
  assert.match(JSON.stringify(detail.data), /Explain types|definitionRevision/);
  await assert.rejects(
    registry.execute(
      actor,
      'skill_claim_options',
      { search: 'TypeScript', skillId: '22222222-2222-4222-8222-222222222222' },
      signal(),
    ),
    /unavailable/,
  );
  await assert.rejects(
    registry.execute(
      actor,
      'skill_claim_options',
      { search: 'TypeScript', skillId: 'not-an-id' },
      signal(),
    ),
  );
  assert.equal(calls, 3);
  revoke = true;
  await assert.rejects(
    registry.execute(actor, 'skill_claim_options', { search: 'TypeScript' }, signal()),
    /permission/,
  );
  assert.ok(
    !registry
      .available(state, state.people[0])
      .some(tool => tool.function.name === 'skill_claim_options'),
  );
});

test('workspace guide reflects current permissions and unconfigured or planned tools are absent', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  access.snapshot = () => structuredClone(state);
  const registry = new ToolRegistry(access);
  const admin = await registry.execute(actor, 'workspace_guide', {}, signal());
  assert.match(JSON.stringify(admin.data), /Access templates/);
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  state.roles[0].name = 'Super Admin';
  const employee = await registry.execute(actor, 'workspace_guide', {}, signal());
  assert.doesNotMatch(JSON.stringify(employee.data), /Access templates/);
  const names = registry.available(state, state.people[0]).map(tool => tool.function.name);
  for (const absent of [
    'catalogue_search',
    'skill_claim_options',
    'propose_own_skill',
    'execute_proposal',
    'read_assigned_review_queue',
  ])
    assert.ok(!names.includes(absent));
});

test('assistant catalogue discovery and selected proficiency retrieval continue through the bounded tool loop', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  access.snapshot = () => structuredClone(state);
  const catalogue: CatalogueStore = {
    read: async () => ({
      revision: 1,
      canManage: false,
      total: 1,
      page: 1,
      pageSize: 25,
      skills: [{ ...option, status: 'PUBLISHED', description: 'Definition' }],
    }),
    save: async () => {
      throw Error();
    },
  };
  const claims: ClaimsStore = {
    read: async () => {
      throw Error();
    },
    options: async () => ({ skills: [option], total: 1, page: 1, pageSize: 5 }),
    save: async () => {
      throw Error();
    },
  };
  let round = 0;
  const service = new AssistantService(
    access,
    undefined,
    {
      name: 'fixture',
      complete: async (messages, tools) => {
        const name = round++ === 0 ? 'catalogue_search' : 'skill_claim_options';
        if (round <= 2) {
          assert.ok(tools.some(tool => tool.function.name === name));
          return {
            content: '',
            calls: [
              {
                id: name,
                type: 'function',
                function: {
                  name,
                  arguments: JSON.stringify({
                    search: 'TypeScript',
                    ...(round === 2 ? { skillId } : {}),
                  }),
                },
              },
            ],
          };
        }
        assert.ok(
          messages.some(
            message => message.role === 'tool' && message.content.includes('Explain types'),
          ),
        );
        return {
          content:
            'These are the published Foundation criteria. Review your experience before saving a draft.',
          calls: [],
        };
      },
    },
    claims,
    undefined,
    catalogue,
  );
  const result = await service.chat(actor, {
    message: 'Find the TypeScript skill and explain its published proficiency criteria',
  });
  assert.equal(result.sources.length, 2);
  assert.equal(result.usage.modelCalls, 3);
  assert.equal(result.mode, 'read-only');
});
