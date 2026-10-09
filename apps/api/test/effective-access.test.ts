import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import {
  LocalAccessStore,
  type LocalAccessState,
} from '../src/modules/access/local-access-store.js';
import {
  actionRegistry,
  effectiveAccess,
  effectiveAccessSummary,
  effectiveClaimReview,
} from '../src/modules/access/effective-access.js';
import { previewAccessChange, recheckAccessChange } from '../src/modules/access/access-preview.js';
import { createApp } from '../src/create-app.js';

const fixture = (): LocalAccessState => ({
  revision: 1,
  audit: [],
  roles: [
    {
      id: 'personal',
      name: 'Custom title',
      permissions: [{ permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' }],
    },
  ],
  people: [
    {
      id: 'actor',
      displayName: 'Person',
      employeeCode: 'EMP',
      active: true,
      hasDirectReports: true,
      roleIds: ['personal'],
      overrides: [],
    },
  ],
});
test('exact claim review resolves current relationship before scope and workflow decisions', () => {
  const state = fixture(),
    actor = state.people[0];
  state.people.push(
    {
      id: 'report',
      displayName: 'Report',
      employeeCode: 'R',
      active: true,
      roleIds: [],
      overrides: [],
    },
    {
      id: 'grandchild',
      displayName: 'Grandchild',
      employeeCode: 'G',
      active: true,
      roleIds: [],
      overrides: [],
    },
  );
  state.reporting = [
    { personId: 'report', managerId: actor.id },
    { personId: 'grandchild', managerId: 'report' },
  ];
  const claim = {
    id: 'claim',
    revision: 3,
    personId: 'report',
    reviewerId: actor.id,
    status: 'SUBMITTED',
  };
  const evaluate = (fields = {}) => effectiveClaimReview(state, actor, { ...claim, ...fields });
  assert.equal(evaluate().allowed, true);
  assert.equal(evaluate().summaryOnly, false);
  assert.equal(evaluate().resource.revision, 3);
  assert.equal(evaluate({ personId: 'grandchild' }).reasonCode, 'NOT_CURRENT_DIRECT_MANAGER');
  assert.equal(evaluate({ reviewerId: 'other' }).reasonCode, 'NOT_ASSIGNED_REVIEWER');
  assert.equal(evaluate({ personId: actor.id }).reasonCode, 'SELF_APPROVAL');
  assert.equal(evaluate({ status: 'APPROVED' }).reasonCode, 'NOT_AWAITING_REVIEW');
  assert.equal(evaluate({ personId: undefined }).reasonCode, 'UNRESOLVED_RESOURCE_SCOPE');
  actor.overrides.push({ permission: 'skill.verify', scope: 'OWN', effect: 'DENY' });
  assert.equal(evaluate().allowed, true);
  actor.overrides.push({
    permission: 'skill.verify',
    scope: 'ORGANIZATION',
    effect: 'DENY',
    validUntil: '2099-01-01',
  });
  assert.equal(evaluate().reasonCode, 'EXPLICIT_DENY');
  actor.overrides.at(-1)!.validUntil = '2000-01-01';
  assert.equal(evaluate().allowed, true);
  state.reporting.push({ personId: 'report', managerId: null });
  assert.equal(evaluate().allowed, false);
  state.reporting.pop();
  state.people[1].active = false;
  assert.equal(evaluate().allowed, false);
});
test('canonical decisions distinguish grants, reporting authority, scoped denies and unavailable actions', () => {
  const state = fixture(),
    person = state.people[0];
  assert.equal(effectiveAccess(state, person, 'profile.view').allowed, true);
  assert.equal(effectiveAccess(state, person, 'profile.view', 'WORKSPACE').allowed, false);
  const review = effectiveAccess(state, person, 'skill.verify', 'DIRECT_REPORTS');
  assert.equal(review.allowed, true);
  assert.equal(review.reasonCode, 'REPORTING_POLICY');
  assert.ok(review.constraints.includes('NO_SELF_REVIEW'));
  person.overrides.push({ permission: 'skill.verify', scope: 'OWN', effect: 'DENY' });
  assert.equal(effectiveAccess(state, person, 'skill.verify', 'DIRECT_REPORTS').allowed, true);
  person.overrides.push({ permission: 'skill.verify', scope: 'ORGANIZATION', effect: 'DENY' });
  assert.equal(
    effectiveAccess(state, person, 'skill.verify', 'DIRECT_REPORTS').reasonCode,
    'EXPLICIT_DENY',
  );
  person.overrides.at(-1)!.validUntil = '2020-01-01';
  assert.equal(effectiveAccess(state, person, 'skill.verify', 'DIRECT_REPORTS').allowed, true);
  person.hasDirectReports = undefined;
  assert.equal(effectiveAccess(state, person, 'skill.verify', 'DIRECT_REPORTS').allowed, false);
  person.hasDirectReports = true;
  assert.equal(
    effectiveAccess(state, person, 'permissions.manage', 'DIRECT_REPORTS').allowed,
    false,
  );
  person.overrides.push({ permission: 'reports.view', scope: 'ORGANIZATION', effect: 'ALLOW' });
  assert.equal(
    effectiveAccess(state, person, 'reports.view', 'WORKSPACE').reasonCode,
    'UNAVAILABLE',
  );
  assert.equal(effectiveAccessSummary(state, person).unsupportedAssignments.length, 2);
  person.active = false;
  assert.equal(effectiveAccess(state, person, 'profile.view').reasonCode, 'INACTIVE_ACTOR');
});
test('SQL assignability registry matches implemented service action/scope combinations', async () => {
  const source = await readFile(
    new URL('../../../database/migrations/031_effective_access_baseline.sql', import.meta.url),
    'utf8',
  );
  const increment = await readFile(
    new URL('../../../database/migrations/036_learning_recommendations.sql', import.meta.url),
    'utf8',
  );
  const certifications = await readFile(
    new URL('../../../database/migrations/053_employee_certifications.sql', import.meta.url),
    'utf8',
  );
  const values =
    source.split('INSERT dbo.AccessImplementedScope VALUES')[1].split(';')[0] +
    increment.split('INSERT dbo.AccessImplementedScope VALUES')[1].split(';')[0] +
    certifications
      .split('INSERT dbo.AccessImplementedScope(permission_code,scope_kind)')[1]
      .split(';')[0];
  const sql = [...values.matchAll(/\('([^']+)','([^']+)'\)/g)].map(m => m[1] + ':' + m[2]).sort();
  assert.deepEqual(
    sql,
    actionRegistry.flatMap(action => action.scopes.map(scope => action.code + ':' + scope)).sort(),
  );
});
test('trusted reporting scopes reject cycles, ambiguous edges and inactive ancestors', () => {
  const state = fixture(),
    manager = state.people[0];
  state.people.push({
    id: 'report',
    displayName: 'Report',
    employeeCode: 'R',
    active: true,
    roleIds: [],
    overrides: [],
  });
  state.reporting = [{ personId: 'report', managerId: manager.id }];
  assert.equal(effectiveAccess(state, manager, 'skill.verify', 'DIRECT_REPORTS').allowed, true);
  state.reporting.push({ personId: manager.id, managerId: 'report' });
  assert.equal(effectiveAccess(state, manager, 'skill.verify', 'DIRECT_REPORTS').allowed, false);
  state.reporting.pop();
  state.reporting.push({ personId: 'report', managerId: null });
  assert.equal(effectiveAccess(state, manager, 'skill.verify', 'DIRECT_REPORTS').allowed, false);
  state.reporting.pop();
  state.people[1].active = false;
  assert.equal(effectiveAccess(state, manager, 'skill.verify', 'DIRECT_REPORTS').allowed, false);
});
test('summaries include permission prerequisites rather than advertising unusable actions', () => {
  const state = fixture(),
    person = state.people[0];
  state.roles[0].permissions.push({ permission: 'skill.claim', scope: 'OWN', effect: 'ALLOW' });
  assert.equal(effectiveAccess(state, person, 'skill.claim').reasonCode, 'PREREQUISITE_DENIED');
  state.roles[0].permissions.push({
    permission: 'skill.view',
    scope: 'ORGANIZATION',
    effect: 'ALLOW',
  });
  assert.equal(effectiveAccess(state, person, 'skill.claim').allowed, true);
  person.overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
  assert.equal(effectiveAccess(state, person, 'skill.claim').reasonCode, 'PREREQUISITE_DENIED');
  assert.equal(effectiveAccess(state, person, 'skill.verify', 'DIRECT_REPORTS').allowed, false);
});
test('preview has no side effects, binds actor/revision/exact input and preserves unsupported historical grants', async () => {
  const store = await LocalAccessStore.open(),
    initial = store.snapshot(),
    actor = initial.people[0].id;
  const body = {
    kind: 'role',
    revision: initial.revision,
    name: 'Personal access',
    permissions: [{ permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' }],
  };
  const preview = await previewAccessChange(initial, actor, body);
  assert.deepEqual(store.snapshot(), initial);
  await recheckAccessChange(initial, actor, { ...body, previewReceipt: preview.receipt });
  await assert.rejects(
    recheckAccessChange(initial, actor, {
      ...body,
      name: 'Changed',
      previewReceipt: preview.receipt,
    }),
    /Preview/,
  );
  await store.save(actor, body);
  await assert.rejects(
    recheckAccessChange(store.snapshot(), actor, { ...body, previewReceipt: preview.receipt }),
    /changed/,
  );
  await assert.rejects(
    store.save(actor, {
      ...body,
      revision: store.snapshot().revision,
      name: 'Unavailable',
      permissions: [{ permission: 'reports.view', scope: 'ORGANIZATION', effect: 'ALLOW' }],
    }),
    /not implemented/,
  );
  const legacy = store.snapshot();
  legacy.roles.push({
    id: 'legacy',
    name: 'Legacy',
    permissions: [{ permission: 'reports.view', scope: 'ORGANIZATION', effect: 'ALLOW' }],
  });
  const legacyStore = LocalAccessStore.fromState(legacy);
  await legacyStore.save(actor, {
    ...legacy.roles.at(-1),
    kind: 'role',
    revision: legacy.revision,
    name: 'Legacy preserved',
  });
  assert.equal(
    legacyStore.snapshot().roles.find(role => role.id === 'legacy')!.permissions.length,
    1,
  );
  await assert.rejects(
    legacyStore.save(actor, {
      kind: 'person',
      revision: legacyStore.snapshot().revision,
      displayName: 'New person',
      employeeCode: 'NEW',
      active: true,
      roleIds: ['legacy'],
      overrides: [],
    }),
    /unsupported assignments/,
  );
});
test('new exceptions require documented future expiry; legacy exceptions may be retained', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    actor = state.people[0];
  const body = {
    ...actor,
    kind: 'person',
    revision: state.revision,
    overrides: [{ permission: 'profile.view', scope: 'OWN', effect: 'DENY' }],
  };
  await assert.rejects(store.save(actor.id, body), /reason and a future expiry/);
  await store.save(actor.id, {
    ...body,
    overrides: [
      { ...body.overrides[0], reason: 'Temporary restriction', validUntil: '2099-01-01T00:00:00Z' },
    ],
  });
  assert.equal(store.snapshot().people[0].overrides[0].reason, 'Temporary restriction');
});
test('person deactivation preview includes affected reporting-manager access without mutating stored grants', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    actor = state.people[0];
  state.people.push({
    id: 'report',
    displayName: 'Report',
    employeeCode: 'REPORT',
    active: true,
    hasDirectReports: false,
    roleIds: [],
    overrides: [],
  });
  state.reporting = [{ personId: 'report', managerId: actor.id }];
  actor.hasDirectReports = true;
  const preview = await previewAccessChange(state, actor.id, {
    ...state.people[1],
    kind: 'person',
    revision: state.revision,
    active: false,
  });
  const managerImpact = preview.impacts.find(item => item.personId === actor.id)!;
  assert.equal(managerImpact.changes.find(item => item.action === 'skill.verify')!.allowed, false);
  assert.equal(state.people[1].active, true);
  assert.equal(state.people[0].hasDirectReports, true);
});
test('HTTP own explanations reject actor impersonation and access saves require reviewed current changes', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    actor = state.people[0].id;
  const app = createApp({
    verify: async header => {
      if (header !== 'Bearer trusted') throw Error();
      return { tenantId: 'trusted', objectId: 'trusted' };
    },
    profile: async () => undefined,
    resolveAccess: async () => actor,
    access: store,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/api/effective-access')).status, 401);
    const own = await (
      await fetch(base + '/api/effective-access?actor=foreign', { headers })
    ).json();
    assert.equal(own.actorId, actor);
    assert.equal(own.summaryOnly, true);
    const body = {
      kind: 'role',
      revision: state.revision,
      name: 'Reviewed template',
      permissions: [],
    };
    assert.equal(
      (await fetch(base + '/api/access', { method: 'POST', headers, body: JSON.stringify(body) }))
        .status,
      409,
    );
    const preview = await (
      await fetch(base + '/api/access/preview', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    ).json();
    assert.equal(store.snapshot().revision, 1);
    assert.equal(
      (
        await fetch(base + '/api/access', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, previewReceipt: preview.receipt }),
        })
      ).status,
      200,
    );
    assert.equal(store.snapshot().audit.at(-1)!.actorId, actor);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
