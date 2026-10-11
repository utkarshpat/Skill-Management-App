import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';
import type { CertificationStore } from '../src/modules/skills/index.js';

test('certification context is actor-bound, paginated, separates expiry and review and rechecks DENY', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0];
  access.snapshot = () => structuredClone(state);
  actor.overrides.push({ permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' });
  let reads = 0,
    revoke = false;
  const certifications: CertificationStore = {
    read: async (id, query) => {
      assert.equal(id, actor.id);
      assert.deepEqual(query, { view: 'mine', page: 2, search: 'Azure' });
      reads++;
      if (revoke) actor.overrides.push({ permission: 'skill.view', scope: 'OWN', effect: 'DENY' });
      return {
        total: 31,
        records: [
          {
            id: 'test',
            revision: 1,
            personId: id,
            name: actor.displayName,
            employeeCode: actor.employeeCode,
            certificationName: 'Azure',
            provider: 'Test issuer',
            category: 'Cloud',
            status: 'APPROVED',
            certificationDate: '2020-01-01',
            expiryDate: '2020-02-01',
            credentialId: '',
            credentialUrl: '',
            notes: 'Private note excluded',
            feedback: 'Private feedback excluded',
          },
        ],
      };
    },
    get: async () => {
      throw Error('Not used');
    },
    change: async () => {
      throw Error('No AI writes');
    },
    notifications: async () => [],
  };
  const registry = new ToolRegistry(
    access,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    certifications,
  );
  const signal = new AbortController().signal;
  await assert.rejects(
    registry.execute(actor.id, 'my_certifications', { personId: 'other' }, signal),
  );
  assert.equal(reads, 0);
  const result = await registry.execute(
    actor.id,
    'my_certifications',
    { page: 2, search: 'Azure' },
    signal,
  );
  const data = result.data as {
    total: number;
    records: { reviewStatus: string; validity: string }[];
  };
  assert.equal(data.total, 31);
  assert.equal(data.records[0].reviewStatus, 'APPROVED');
  assert.equal(data.records[0].validity, 'Expired');
  assert.doesNotMatch(JSON.stringify(data), /Private note|Private feedback/);
  revoke = true;
  await assert.rejects(
    registry.execute(actor.id, 'my_certifications', { page: 2, search: 'Azure' }, signal),
    /permission/,
  );
});

test('personal certification readers cannot discover assigned review tools', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0];
  actor.hasDirectReports = false;
  state.reporting = [];
  actor.roleIds = [];
  actor.overrides = [
    { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' },
  ];
  const registry = new ToolRegistry(
    access,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as CertificationStore,
  );
  const names = registry.available(state, actor).map(t => t.function.name);
  assert.ok(names.includes('my_certifications'));
  assert.ok(!names.includes('assigned_certification_reviews'));
});
