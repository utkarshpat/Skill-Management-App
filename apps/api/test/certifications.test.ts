import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore, type LocalPerson } from '../src/modules/access/local-access-store.js';
import {
  certificationAccess,
  certificationChange,
  certificationQuery,
  type Certification,
  type CertificationStore,
} from '../src/modules/skills/certifications.js';

const fields = {
  certificationName: 'Azure Fundamentals',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-01',
  expiryDate: '2026-09-01',
  credentialId: 'cert-1',
  credentialUrl: 'https://issuer.example/badge',
  notes: 'Issuer transcript available.',
};
test('certification input rejects forged owners, review status, unsafe URLs and invalid dates', () => {
  const change = { action: 'SAVE_SUBMIT', id: randomUUID(), revision: 0, fields };
  assert.equal(certificationChange(change).action, 'SAVE_SUBMIT');
  for (const patch of [
    { personId: randomUUID() },
    { reviewerId: randomUUID() },
    { verified: true },
    { status: 'APPROVED' },
    { revision: -1 },
    { action: 'DELETE' },
  ])
    assert.throws(() => certificationChange({ ...change, ...patch }));
  for (const patch of [
    { certificationDate: '2026-02-30' },
    { certificationDate: '2099-01-01' },
    { expiryDate: '2025-01-01' },
    { credentialUrl: 'javascript:alert(1)' },
    { credentialUrl: 'https://user:pass@issuer.example/' },
    { provider: '' },
    { certificationName: 'x'.repeat(201) },
    { evidenceUrl: 'https://forged.example' },
  ])
    assert.throws(() => certificationChange({ ...change, fields: { ...fields, ...patch } }));
  assert.throws(() =>
    certificationChange({ action: 'APPROVE', id: change.id, revision: 1, feedback: '' }),
  );
  assert.throws(() =>
    certificationChange({
      action: 'SUBMIT',
      id: change.id,
      revision: 1,
      feedback: 'Forged approval',
    }),
  );
  assert.throws(() => certificationQuery({ view: 'directory' }));
  assert.throws(() => certificationQuery({ view: 'queue', personId: change.id }));
  assert.throws(() => certificationQuery({ page: ['1'] }));
});

async function fixture() {
  const store = await LocalAccessStore.open(),
    state = store.snapshot();
  const person = (name: string): LocalPerson => ({
    id: randomUUID(),
    displayName: name,
    employeeCode: randomUUID(),
    active: true,
    roleIds: [],
    overrides: [
      { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'skill.claim', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
    ],
  });
  const owner = person('Employee'),
    manager = person('Manager'),
    unrelated = person('Unrelated');
  state.people = [owner, manager, unrelated];
  state.roles = [];
  state.reporting = [
    { personId: owner.id, managerId: manager.id },
    { personId: manager.id, managerId: null },
    { personId: unrelated.id, managerId: null },
  ];
  store.snapshot = () => structuredClone(state);
  const record: Certification = {
    ...fields,
    id: randomUUID(),
    revision: 1,
    personId: owner.id,
    reviewerId: manager.id,
    name: owner.displayName,
    employeeCode: owner.employeeCode,
    status: 'SUBMITTED',
    feedback: '',
  };
  return { store, state, owner, manager, unrelated, record };
}
test('certification actions require exact assigned current manager and lock approved records', async () => {
  const { state, owner, manager, unrelated, record } = await fixture();
  assert.equal(certificationAccess(state, manager, record).canReview, true);
  assert.equal(certificationAccess(state, owner, record).canReview, false);
  assert.equal(certificationAccess(state, unrelated, record).canReview, false);
  assert.equal(certificationAccess(state, owner, { ...record, status: 'APPROVED' }).canEdit, false);
  assert.equal(
    certificationAccess(state, owner, { ...record, status: 'APPROVED' }).canSubmit,
    false,
  );
  assert.equal(
    certificationAccess(state, owner, { ...record, status: 'CHANGES_REQUESTED' }).canEdit,
    true,
  );
  assert.equal(certificationAccess(state, owner, { ...record, status: 'DRAFT' }).canSubmit, true);
  assert.equal(
    certificationAccess(state, manager, { ...record, reviewerId: unrelated.id }).canReview,
    false,
  );
  manager.overrides.push({ permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'DENY' });
  assert.equal(certificationAccess(state, manager, record).canReview, false);
  assert.equal(certificationAccess(state, owner, { ...record, status: 'DRAFT' }).canSubmit, false);
  manager.overrides.pop();
  owner.active = false;
  assert.equal(certificationAccess(state, manager, record).canReview, false);
  owner.active = true;
  state.reporting![0].managerId = unrelated.id;
  assert.equal(certificationAccess(state, manager, record).canReview, false);
});

test('HTTP binds certification owner, gates renamed roles, rechecks retrieval and preserves SQL conflicts', async () => {
  const f = await fixture();
  let actor = f.owner.id,
    writes = 0,
    revokeOnRead = false;
  const certs: CertificationStore = {
    read: async (id, query) => {
      assert.equal(id, actor);
      if (revokeOnRead)
        f.owner.overrides.push({ permission: 'skill.view', scope: 'OWN', effect: 'DENY' });
      return { records: query.view === 'mine' ? [f.record] : [f.record], total: 1 };
    },
    get: async () => f.record,
    change: async () => {
      writes++;
    },
    notifications: async () => [],
  };
  const app = createApp({
    verify: async () => ({ tenantId: randomUUID(), objectId: randomUUID() }),
    resolveAccess: async () => actor,
    access: f.store,
    profile: async () => undefined,
    certifications: certs,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const root = `http://127.0.0.1:${address.port}/api/certifications`;
  const post = (body: object) =>
    fetch(root, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(root)).status, 200);
    assert.equal((await fetch(root + '?view=queue')).status, 403);
    assert.equal(
      (await post({ action: 'APPROVE', id: f.record.id, revision: 1, feedback: 'Self review' }))
        .status,
      403,
    );
    actor = f.unrelated.id;
    assert.equal(
      (await post({ action: 'SAVE', id: f.record.id, revision: 1, fields })).status,
      403,
    );
    actor = f.manager.id;
    assert.equal((await fetch(root + '?view=queue')).status, 200);
    assert.equal(
      (
        await post({
          action: 'APPROVE',
          id: f.record.id,
          revision: 1,
          feedback: 'Checked issuer transcript',
        })
      ).status,
      200,
    );
    assert.equal(writes, 1);
    f.record.status = 'APPROVED';
    actor = f.owner.id;
    assert.equal(
      (await post({ action: 'SAVE', id: f.record.id, revision: 1, fields })).status,
      403,
    );
    assert.equal(writes, 1);
    revokeOnRead = true;
    assert.equal((await fetch(root)).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
  }
});

test('certification migration includes actor-bound transactions, immutable approved state and audit without proficiency writes', async () => {
  const source = await readFile(
    new URL('../../../database/migrations/053_certification_records.sql', import.meta.url),
    'utf8',
  );
  assert.match(source, /AccessRuntimeAccount/);
  assert.match(source, /UPDLOCK,HOLDLOCK/);
  assert.match(source, /CertificationCanReview/);
  assert.match(source, /@owner<>@actor_id/);
  assert.match(source, /@revision<>@expected/);
  assert.match(source, /@status NOT IN\('DRAFT','CHANGES_REQUESTED','REJECTED'\)/);
  assert.match(source, /INSERT dbo.AccessAudit/);
  assert.doesNotMatch(source, /(?:UPDATE|INSERT|DELETE) dbo.SkillClaimDraft/);
  assert.doesNotMatch(source, /active\s*=\s*1/i);
});
