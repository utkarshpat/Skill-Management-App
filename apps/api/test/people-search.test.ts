import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleSearchQuery } from '../src/modules/business/people-search.js';
import { SqlBusinessStore } from '../src/modules/business/sql-store.js';
import type { BusinessContext } from '../src/modules/business/business.js';

const actor = '00000000-0000-4000-8000-000000000001';
const skill = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = { skills: [{ id: skill, minRank: 2 }], certifications: [] };

test('people search rejects malformed explicit scopes rather than searching the authorized union', () => {
  for (const scopeId of ['', null, false, 0, [], {}, 'unknown'])
    assert.throws(() => peopleSearchQuery({ ...input, scopeId }));
  assert.equal(peopleSearchQuery(input).scopeId, undefined);
  assert.equal(peopleSearchQuery({ ...input, scopeId: skill.toUpperCase() }).scopeId, skill);
});

test('people search bounds requirements and rejects forged authority and normalized duplicates', () => {
  for (const extra of [{ actorId: actor }, { personId: actor }, { purpose: 'admin' }])
    assert.throws(() => peopleSearchQuery({ ...input, ...extra }));
  for (const minRank of [0, 5, 2.5, '2'])
    assert.throws(() => peopleSearchQuery({ ...input, skills: [{ id: skill, minRank }] }));
  assert.throws(() => peopleSearchQuery({ skills: [], certifications: [] }));
  assert.throws(() => peopleSearchQuery({ ...input, page: 0 }));
  assert.throws(() => peopleSearchQuery({ ...input, headcount: 10001 }));
  assert.throws(() => peopleSearchQuery({ ...input, onlyEligible: 'true' }));
  assert.throws(() =>
    peopleSearchQuery({
      ...input,
      skills: [...input.skills, { id: skill.toUpperCase(), minRank: 3 }],
    }),
  );
  assert.throws(() =>
    peopleSearchQuery({ ...input, certifications: [skill, skill.toUpperCase()] }),
  );
});

test('people search withholds retrieved results after matching, export or workspace access changes', async () => {
  const context: BusinessContext = {
    revision: 1,
    asOf: '2026-10-14T00:00:00Z',
    canView: true,
    canMatch: true,
    canExport: true,
    canManage: false,
    canAmend: false,
    personalBaseline: true,
    scopes: [],
  };
  const store = new SqlBusinessStore(actor);
  let fresh = { ...context };
  Object.defineProperty(store, 'execute', {
    value: async (id: string, procedure: string) => {
      assert.equal(id, actor);
      if (procedure === 'dbo.BusinessContext') return fresh;
      assert.equal(procedure, 'dbo.BusinessPeopleSearch');
      return {
        context: { ...context },
        total: 0,
        eligibleTotal: 0,
        required: 1,
        page: 1,
        pageSize: 25,
      };
    },
  });
  const query = peopleSearchQuery(input);
  const result = await store.peopleSearch(actor, query);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.requirements, []);
  assert.deepEqual(result.query, query);
  for (const change of [{ canMatch: false }, { canView: false }, { revision: 2 }]) {
    fresh = { ...context, ...change };
    await assert.rejects(store.peopleSearch(actor, query), /changed/);
  }
  fresh = { ...context, canExport: false };
  await assert.rejects(store.peopleSearch(actor, query, true), /changed/);
});
