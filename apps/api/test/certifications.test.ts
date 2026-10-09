import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/create-app.js';
import {
  effectiveAccess,
  workspaceFor,
  type LocalAccessState,
} from '../src/modules/access/index.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import {
  certificationChange,
  certificationFields,
  certificationQuery,
  certificationReviewAccess,
  type CertificationStore,
} from '../src/modules/skills/certifications.js';

const manager = '00000000-0000-4000-8000-000000000001';
const employee = '00000000-0000-4000-8000-000000000002';
const recordId = '00000000-0000-4000-8000-000000000003';
const fields = {
  certificationName: 'Cloud credential',
  provider: 'Issuer',
  category: 'Cloud',
  certificationDate: '2025-01-01',
  expiryDate: '2027-01-01',
  credentialId: 'TEST',
  credentialUrl: 'https://issuer.example/credential/123',
};
function fixture(): LocalAccessState {
  return {
    revision: 1,
    audit: [],
    roles: [
      {
        id: 'personal',
        name: 'Arbitrary renamed template',
        permissions: [
          { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
          { permission: 'certification.view', scope: 'OWN', effect: 'ALLOW' },
          { permission: 'certification.manage', scope: 'OWN', effect: 'ALLOW' },
        ],
      },
    ],
    people: [
      {
        id: manager,
        displayName: 'Same Name',
        employeeCode: 'M',
        active: true,
        roleIds: ['personal'],
        overrides: [],
      },
      {
        id: employee,
        displayName: 'Same Name',
        employeeCode: 'E',
        active: true,
        roleIds: ['personal'],
        overrides: [],
      },
    ],
    reporting: [{ personId: employee, managerId: manager }],
  };
}
test('credential input accepts factual manual values and rejects forged authority, invalid dates and URLs', () => {
  assert.deepEqual(certificationFields(fields, true), fields);
  assert.equal(certificationFields({ ...fields, expiryDate: null }, true).expiryDate, null);
  assert.equal(certificationFields({ ...fields, credentialUrl: '' }, false).credentialUrl, '');
  assert.equal(
    certificationFields(
      { ...fields, credentialUrl: 'HTTPS://ISSUER.EXAMPLE?recipient=user@example.test' },
      true,
    ).credentialUrl,
    'https://issuer.example/?recipient=user@example.test',
  );
  assert.throws(() => certificationQuery({ page: ['1'] }));
  for (const extra of [
    { provider: '' },
    { category: '' },
    { certificationName: ' ' },
    { personId: employee },
    { active: 'Y' },
    { verified: true },
    { status: 'APPROVED' },
    { reviewerId: manager },
    { certificationDate: '2025-02-30' },
    { certificationDate: '2100-01-01' },
    { expiryDate: '2024-01-01' },
    { expiryDate: '' },
    { credentialUrl: '' },
    { credentialUrl: 'javascript:alert(1)' },
    { credentialUrl: 'http://issuer.example' },
    { credentialUrl: 'https://user:password@issuer.example' },
    { category: 'a'.repeat(101) },
  ])
    assert.throws(() => certificationFields({ ...fields, ...extra }, true));
});
test('actions preserve revision contracts; routing and decisions cannot mutate submitted fields', () => {
  const input = { id: recordId, revision: 0, action: 'SUBMIT', fields };
  assert.equal(certificationChange(input).action, 'SUBMIT');
  assert.equal(
    certificationChange({ id: recordId, revision: 2, action: 'REROUTE' }).action,
    'REROUTE',
  );
  for (const extra of [
    { revision: -1 },
    { revision: 1.2 },
    { actorId: manager },
    { action: 'APPROVED' },
    { feedback: 'forged' },
  ])
    assert.throws(() => certificationChange({ ...input, ...extra }));
  for (const action of ['CHANGES_REQUESTED', 'REJECTED'])
    assert.throws(() => certificationChange({ id: recordId, revision: 1, action, feedback: ' ' }));
  assert.throws(() =>
    certificationChange({ id: recordId, revision: 1, action: 'REROUTE', fields }),
  );
  assert.throws(() =>
    certificationChange({ id: recordId, revision: 1, action: 'APPROVED', fields }),
  );
});
test('own actions require explicit grants; role labels and unrelated catalogue/admin grants confer no credential authority', () => {
  const s = fixture(),
    actor = s.people[0];
  assert.equal(workspaceFor(s, actor).capabilities.manageCertifications, true);
  s.roles[0].permissions = [
    { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
    { permission: 'permissions.manage', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'skill.catalogue.manage', scope: 'ORGANIZATION', effect: 'ALLOW' },
  ];
  s.roles[0].name = 'Capability Lead Administrator';
  assert.equal(workspaceFor(s, actor).capabilities.certificationDirectory, false);
  assert.equal(workspaceFor(s, s.people[1]).capabilities.ownCertifications, false);
  assert.equal(workspaceFor(s, actor).capabilities.exportCertifications, false);
  actor.overrides = [
    { permission: 'certification.export', scope: 'ORGANIZATION', effect: 'ALLOW' },
  ];
  assert.equal(effectiveAccess(s, actor, 'certification.export', 'WORKSPACE').allowed, false);
  actor.overrides.push({
    permission: 'certification.directory',
    scope: 'ORGANIZATION',
    effect: 'ALLOW',
  });
  assert.equal(effectiveAccess(s, actor, 'certification.export', 'WORKSPACE').allowed, true);
});
test('current assigned direct manager policy blocks self, obsolete assignment, changed manager, inactive status and scoped denies', () => {
  const s = fixture(),
    actor = s.people[0];
  const record = { personId: employee, reviewerId: manager, status: 'SUBMITTED' as const };
  assert.equal(certificationReviewAccess(s, actor, record).allowed, true);
  assert.equal(effectiveAccess(s, actor, 'certification.verify', 'WORKSPACE').allowed, false);
  assert.equal(
    certificationReviewAccess(s, actor, { ...record, personId: manager }).allowed,
    false,
  );
  assert.equal(
    certificationReviewAccess(s, actor, { ...record, reviewerId: employee }).allowed,
    false,
  );
  assert.equal(
    certificationReviewAccess(s, actor, { ...record, status: 'APPROVED' }).allowed,
    false,
  );
  actor.overrides = [{ permission: 'certification.verify', scope: 'OWN', effect: 'DENY' }];
  assert.equal(certificationReviewAccess(s, actor, record).allowed, true);
  actor.overrides = [{ permission: 'certification.verify', scope: 'ORGANIZATION', effect: 'DENY' }];
  assert.equal(certificationReviewAccess(s, actor, record).reasonCode, 'EXPLICIT_DENY');
  actor.overrides[0].validUntil = '2000-01-01T00:00:00Z';
  assert.equal(certificationReviewAccess(s, actor, record).allowed, true);
  actor.active = false;
  assert.equal(certificationReviewAccess(s, actor, record).allowed, false);
  actor.active = true;
  actor.overrides = [];
  s.people[1].active = false;
  assert.equal(certificationReviewAccess(s, actor, record).allowed, false);
  s.people[1].active = true;
  s.reporting![0].managerId = employee;
  assert.equal(certificationReviewAccess(s, actor, record).allowed, false);
});
test('ambiguous/cyclic reporting cannot grant certification review', () => {
  const s = fixture(),
    record = { personId: employee, reviewerId: manager, status: 'SUBMITTED' as const };
  s.reporting!.push({ personId: manager, managerId: employee });
  assert.equal(certificationReviewAccess(s, s.people[0], record).allowed, false);
  s.people.push({ ...s.people[1], id: recordId });
  s.reporting = [
    { personId: recordId, managerId: manager },
    { personId: employee, managerId: manager },
    { personId: employee, managerId: manager },
  ];
  assert.equal(
    effectiveAccess(s, s.people[0], 'certification.verify', 'DIRECT_REPORTS').allowed,
    true,
  );
  assert.equal(certificationReviewAccess(s, s.people[0], record).allowed, false);
  s.reporting = [
    { personId: employee, managerId: manager },
    { personId: employee, managerId: manager },
  ];
  assert.equal(certificationReviewAccess(s, s.people[0], record).allowed, false);
});
test('certification discovery preserves trusted actor projections without expanding exact review authority', () => {
  const s = fixture();
  const compact: LocalAccessState = LocalAccessStore.fromState(s).actorSnapshot(manager);
  assert.equal(compact.reporting, undefined);
  assert.equal(workspaceFor(compact, compact.people[0]).capabilities.reviewCertifications, true);
  assert.equal(
    certificationReviewAccess(compact, compact.people[0], {
      personId: employee,
      reviewerId: manager,
      status: 'SUBMITTED',
    }).allowed,
    false,
  );
  delete compact.people[0].hasDirectReports;
  assert.equal(workspaceFor(compact, compact.people[0]).capabilities.reviewCertifications, false);
});
test('query validation bounds pages, selectors and filters without accepting actor/scope inputs', () => {
  assert.equal(
    certificationQuery({ view: 'directory', du: 'Unit A', category: 'Cloud', active: 'Y' }).du,
    'Unit A',
  );
  for (const extra of [
    { personId: employee },
    { scope: 'ORGANIZATION' },
    { view: 'all' },
    { page: 0 },
    { page: 10001 },
    { active: 'true' },
    { search: ['one', 'two'] },
    { id: 'not-id' },
  ])
    assert.throws(() => certificationQuery(extra));
});
test('certification HTTP binds authenticated actor, rejects spoofing and rechecks revoked grants and missing persistence', async () => {
  const state = fixture();
  const actors: string[] = [];
  let mutateDuringRead = false,
    writes = 0;
  const store: CertificationStore = {
    read: async actor => {
      actors.push(actor);
      if (mutateDuringRead) state.revision++;
      return { items: [], total: 0 };
    },
    change: async (actor, input) => {
      actors.push(actor);
      writes++;
      return { saved: true, id: input.id };
    },
  };
  const access = {
    snapshot: () => structuredClone(state),
    person: () => undefined,
    save: async () => state,
  };
  const dependencies = {
    verify: async (header: string | undefined) => {
      if (header !== 'Bearer test-credential') throw Error('Unauthorized');
      return { tenantId: 'tenant', objectId: 'object' };
    },
    profile: async () => undefined,
    resolveAccess: async () => manager,
    access,
    certifications: store,
  };
  const server = createApp(dependencies).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/certifications`;
  const headers = { Authorization: 'Bearer test-credential', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal((await fetch(url + '?view=queue', { headers })).status, 200);
    assert.equal((await fetch(url + '?personId=' + employee, { headers })).status, 400);
    assert.equal((await fetch(url + '?view=directory', { headers })).status, 403);
    assert.equal((await fetch(url + '/export?view=directory', { headers })).status, 403);
    const body = { id: recordId, revision: 0, action: 'SAVE', fields };
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, actorId: employee }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })).status,
      200,
    );
    assert.equal(writes, 1);
    mutateDuringRead = true;
    assert.equal((await fetch(url, { headers })).status, 409);
    mutateDuringRead = false;
    state.people[0].overrides.push({
      permission: 'certification.manage',
      scope: 'OWN',
      effect: 'DENY',
    });
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })).status,
      403,
    );
    assert.equal(writes, 1);
    assert.ok(actors.every(actor => actor === manager));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  const unconfigured = createApp({ ...dependencies, certifications: undefined }).listen(
    0,
    '127.0.0.1',
  );
  await once(unconfigured, 'listening');
  const other = unconfigured.address();
  assert.ok(other && typeof other !== 'string');
  try {
    assert.equal(
      (await fetch(`http://127.0.0.1:${other.port}/api/certifications`, { headers })).status,
      503,
    );
  } finally {
    await new Promise<void>(resolve => unconfigured.close(() => resolve()));
  }
});
test('SQL migration independently scopes records, rechecks revisions, audits transactions and excludes private drafts', async () => {
  const sql = await readFile(
    new URL('../../../database/migrations/053_employee_certifications.sql', import.meta.url),
    'utf8',
  );
  for (const pattern of [
    /AccessRuntimeAccount/,
    /AccessReportingValid/,
    /@actor=@owner/,
    /@reviewer<>@actor/,
    /@view='mine' AND c\.person_id=@actor_id/,
    /@view='directory' AND c\.status<>'DRAFT'/,
    /@status NOT IN\('DRAFT','CHANGES_REQUESTED','REJECTED'\)/,
    /@revision<>@current/,
    /UPDLOCK,HOLDLOCK/,
    /INSERT dbo\.CertificationEvent/,
    /INSERT dbo\.AccessAudit/,
    /c\.expiry_date>=@today/,
    /@action='EXPORT'.*>5000/,
    /@action='REROUTE'/,
  ])
    assert.match(sql, pattern);
  assert.doesNotMatch(sql, /INSERT dbo\.(?:AccountRolePermission|AccessPersonOverride)/);
});
