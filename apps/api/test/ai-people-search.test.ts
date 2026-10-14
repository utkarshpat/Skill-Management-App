import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { rolePresets } from '../src/modules/access/role-presets.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';
import { peopleSearchQuery, type BusinessStore } from '../src/modules/business/index.js';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('conversational matching binds actor, supplies a server-backed result query and denies forged selectors', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    person = state.people[0];
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  person.business = {
    personalBaseline: true,
    systemAdmin: false,
    view: true,
    export: true,
    manage: false,
    amend: false,
    matchingView: true,
    matchingRun: true,
    scopes: [
      {
        id,
        bundle: 'BUSINESS_OPERATIONS',
        kind: 'ORGANIZATION',
        scopeId: null,
        label: 'Organization',
        effect: 'ALLOW',
        validUntil: null,
        reason: 'test',
      },
    ],
  };
  access.snapshot = () => structuredClone(state);
  let reads = 0;
  const query = peopleSearchQuery({ skills: [{ id, minRank: 2 }], certifications: [] });
  const business = {
    peopleSearch: async (actor: string, q: typeof query) => {
      assert.equal(actor, person.id);
      reads++;
      return {
        query: q,
        context: { asOf: '2026-10-14T00:00:00Z', scopes: [] },
        total: 0,
        eligibleTotal: 0,
        required: 1,
        page: 1,
        pageSize: 25,
        requirements: [],
        rows: [],
      };
    },
  } as unknown as BusinessStore;
  let rounds = 0;
  const provider = {
    name: 'fixture',
    complete: async () =>
      ++rounds === 1
        ? {
            content: '',
            calls: [
              {
                id: 'search',
                type: 'function' as const,
                function: { name: 'business_people_search', arguments: JSON.stringify(query) },
              },
            ],
          }
        : { content: 'No recorded matches meet these requirements.', calls: [] },
  };
  const service = new AssistantService(
    access,
    undefined,
    provider,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    business,
  );
  const reply = await service.chat(person.id, { message: 'Find people for audit log work' });
  assert.match(reply.reply, /people meet/);
  assert.ok('peopleSearch' in reply);
  assert.deepEqual(reply.peopleSearch, { query });
  assert.equal(reads, 1);
  const registry = new ToolRegistry(
    access,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    business,
  );
  await assert.rejects(
    registry.execute(
      person.id,
      'business_people_search',
      { ...query, personId: id },
      AbortSignal.timeout(5000),
    ),
  );
  person.business.matchingRun = false;
  await assert.rejects(
    registry.execute(person.id, 'business_people_search', query, AbortSignal.timeout(5000)),
    /permission/,
  );
  assert.equal(reads, 1);
});
