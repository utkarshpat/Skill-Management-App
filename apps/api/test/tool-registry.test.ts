import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import type { ClaimsStore } from '../src/modules/skills/claims.js';

test('typed own-skills tools bind the actor, label unverified drafts and reject write/foreign arguments', async () => {
  const access = await LocalAccessStore.open(),
    id = access.snapshot().people[0].id;
  let actor = '';
  const state = access.snapshot();
  state.people[0].overrides.push({ permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' });
  access.snapshot = () => structuredClone(state);
  const claims: ClaimsStore = {
    read: async current => {
      actor = current;
      return {
        total: 1,
        page: 1,
        pageSize: 25,
        canClaim: false,
        claims: [
          {
            id: 'claim',
            revision: 1,
            skillId: 'skill',
            skillName: 'TypeScript',
            category: 'Engineering',
            definitionRevision: 1,
            rank: 1,
            levelName: 'Foundation',
            levelDescription: 'Criteria',
            experienceMonths: 6,
            description: 'Private narrative',
            status: 'DRAFT',
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    },
    options: async () => {
      throw Error('Not a tool');
    },
    save: async () => {
      throw Error('Writes are forbidden');
    },
  };
  const registry = new ToolRegistry(access, undefined, claims),
    signal = AbortSignal.timeout(5000);
  assert.ok(
    registry
      .available(access.snapshot(), access.snapshot().people[0])
      .some(tool => tool.function.name === 'my_skills'),
  );
  const result = await registry.execute(id, 'my_skills', {}, signal);
  assert.equal(actor, id);
  assert.match(JSON.stringify(result), /UNVERIFIED/);
  assert.doesNotMatch(JSON.stringify(result), /Private narrative/);
  await assert.rejects(registry.execute(id, 'my_skills', { personId: 'other' }, signal));
  await assert.rejects(registry.execute(id, 'save_claim', {}, signal));
  let rounds = 0;
  const assistant = new AssistantService(
    access,
    undefined,
    {
      name: 'test',
      complete: async messages => {
        rounds++;
        if (rounds === 1)
          return {
            content: '',
            calls: [
              { id: 'call', type: 'function', function: { name: 'my_skills', arguments: '{}' } },
            ],
          };
        assert.ok(
          messages.some(
            message => message.role === 'tool' && message.content.includes('UNVERIFIED'),
          ),
        );
        return { content: 'Your TypeScript draft is self-assessed.', calls: [] };
      },
    },
    claims,
  );
  const reply = await assistant.chat(id, {
    messages: [{ role: 'user', content: 'What skills have I added?' }],
  });
  assert.equal(reply.sources[0].url, '/my-skills');
});

test('policy gateway rechecks permissions after retrieval and blocks revoked skill context', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    id = state.people[0].id;
  access.snapshot = () => structuredClone(state);
  state.people[0].overrides.push({ permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' });
  const claims: ClaimsStore = {
    read: async () => {
      state.people[0].overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
      return { claims: [], total: 0, page: 1, pageSize: 25, canClaim: false };
    },
    options: async () => {
      throw Error();
    },
    save: async () => {
      throw Error();
    },
  };
  await assert.rejects(
    new ToolRegistry(access, undefined, claims).execute(
      id,
      'my_skills',
      {},
      AbortSignal.timeout(5000),
    ),
    /permission/,
  );
});
