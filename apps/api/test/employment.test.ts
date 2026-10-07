import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { employmentDetails } from '../src/modules/access/employment.js';
import { previewAccessChange, recheckAccessChange } from '../src/modules/access/access-preview.js';
import { effectiveAccessSummary } from '../src/modules/access/effective-access.js';
import { createApp } from '../src/create-app.js';

test('employment fields are optional, bounded and preserve omitted fields but clear explicit blanks/null', () => {
  assert.deepEqual(employmentDetails({}), { jobTitle: null, grade: null });
  assert.deepEqual(employmentDetails({ jobTitle: '  Engineer  ', grade: ' G4 ' }), {
    jobTitle: 'Engineer',
    grade: 'G4',
  });
  assert.deepEqual(employmentDetails({}, { jobTitle: 'Engineer', grade: 'G4' }), {
    jobTitle: 'Engineer',
    grade: 'G4',
  });
  assert.deepEqual(
    employmentDetails({ jobTitle: null, grade: '  ' }, { jobTitle: 'Engineer', grade: 'G4' }),
    { jobTitle: null, grade: null },
  );
  for (const body of [
    { jobTitle: 42 },
    { grade: [] },
    { jobTitle: 'x'.repeat(101) },
    { grade: 'x'.repeat(41) },
    { jobTitle: 'x'.repeat(5000) },
  ])
    assert.throws(() => employmentDetails(body), /valid|characters/);
  assert.equal(
    employmentDetails({ jobTitle: 'x'.repeat(100), grade: 'x'.repeat(40) }).grade?.length,
    40,
  );
});
test('employment preview binds exact values, preserves effective access, and audits saved changes', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    actor = state.people[0],
    body = {
      ...actor,
      kind: 'person',
      revision: state.revision,
      jobTitle: 'Department Head',
      grade: 'G8',
    };
  const original = effectiveAccessSummary(state, actor);
  const preview = await previewAccessChange(state, actor.id, body);
  assert.deepEqual(store.snapshot(), state);
  assert.equal(preview.impacts[0].changes.length, 0);
  assert.equal(
    preview.after && 'jobTitle' in preview.after ? preview.after.jobTitle : undefined,
    'Department Head',
  );
  await assert.rejects(
    recheckAccessChange(state, actor.id, { ...body, grade: 'G9', previewReceipt: preview.receipt }),
    /Preview/,
  );
  await recheckAccessChange(state, actor.id, { ...body, previewReceipt: preview.receipt });
  const saved = await store.save(actor.id, body),
    person = saved.people[0];
  assert.deepEqual(effectiveAccessSummary(saved, person).decisions, original.decisions);
  assert.equal(
    saved.audit[0].after && 'grade' in saved.audit[0].after
      ? saved.audit[0].after.grade
      : undefined,
    'G8',
  );
  const { jobTitle: _title, grade: _grade, ...legacy } = person;
  const retained = await store.save(actor.id, {
    ...legacy,
    kind: 'person',
    revision: saved.revision,
  });
  assert.equal(retained.people[0].jobTitle, 'Department Head');
  const cleared = await store.save(actor.id, {
    ...retained.people[0],
    jobTitle: ' ',
    grade: null,
    kind: 'person',
    revision: retained.revision,
  });
  assert.equal(cleared.people[0].jobTitle, null);
  assert.equal(cleared.people[0].grade, null);
  await assert.rejects(store.save(actor.id, body), /changed/);
});
test('people-edit authorization is unchanged and rejects missing user permission, deny and inactive actors', async () => {
  const store = await LocalAccessStore.open(),
    state = store.snapshot(),
    actor = state.people[0],
    body = {
      ...actor,
      kind: 'person',
      revision: state.revision,
      jobTitle: 'Administrator',
      grade: 'G10',
    };
  for (const variant of ['users-deny', 'permissions-deny', 'inactive'] as const) {
    const fixture = structuredClone(state),
      person = fixture.people[0];
    if (variant === 'inactive') person.active = false;
    else
      person.overrides.push({
        permission: variant === 'users-deny' ? 'users.manage' : 'permissions.manage',
        scope: 'ORGANIZATION',
        effect: 'DENY',
      });
    await assert.rejects(
      LocalAccessStore.fromState(fixture).save(actor.id, body),
      error => (error as { status: number }).status === 403,
    );
  }
});
test('demo own profile shows work information but forbids self-service writes or actor selectors', async () => {
  const store = await LocalAccessStore.open(),
    admin = store.snapshot().people[0];
  const state = await store.save(admin.id, {
    kind: 'person',
    revision: 1,
    displayName: 'Employee',
    employeeCode: 'EMP',
    jobTitle: 'Engineer',
    grade: 'G4',
    active: true,
    roleIds: [],
    overrides: [
      {
        permission: 'profile.view',
        scope: 'OWN',
        effect: 'ALLOW',
        reason: 'Own profile fixture',
        validUntil: '2099-01-01',
      },
    ],
  });
  const person = state.people.find(item => item.employeeCode === 'EMP')!;
  const server = createApp(undefined, { developmentStore: store }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(base + '/api/dev-login', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: person.id }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0],
      headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
    const result = await fetch(base + '/api/me?actorId=' + admin.id, { headers });
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const profile = (await result.json()).profile;
    assert.equal(profile.id, person.id);
    assert.equal(profile.jobTitle, 'Engineer');
    assert.equal(profile.grade, 'G4');
    assert.equal(
      (
        await fetch(base + '/api/dev-access/preview', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...person,
            jobTitle: 'Head',
            kind: 'person',
            revision: state.revision,
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + '/api/me', { method: 'POST', headers, body: '{"jobTitle":"Head"}' }))
        .status,
      401,
    );
    assert.equal(store.snapshot().people.find(item => item.id === person.id)!.jobTitle, 'Engineer');
    await store.save(admin.id, {
      ...person,
      kind: 'person',
      revision: state.revision,
      overrides: [],
    });
    assert.equal((await fetch(base + '/api/me', { headers })).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
test('Microsoft profile returns only verified own work values and does not accept selectors', async () => {
  const server = createApp({
    verify: async header => {
      if (header !== '******') throw Error();
      return { tenantId: 'trusted', objectId: 'trusted' };
    },
    profile: async identity => {
      assert.equal(identity.objectId, 'trusted');
      return {
        id: 'own',
        displayName: 'Employee',
        employeeCode: 'EMP',
        organization: 'Company',
        status: 'ACTIVE',
        roles: [],
        jobTitle: 'Engineer',
        grade: 'G4',
      };
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/me?personId=foreign&jobTitle=Head`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: '******' } });
    assert.equal(response.status, 200);
    const profile = (await response.json()).profile;
    assert.equal(profile.id, 'own');
    assert.equal(profile.jobTitle, 'Engineer');
    assert.equal(profile.grade, 'G4');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});
test('employment SQL preserves authorization, unbounded input checks, omission semantics and transactional audit', async () => {
  const source = await readFile(
    new URL('../../../database/migrations/045_person_employment.sql', import.meta.url),
    'utf8',
  );
  assert.match(source, /ADD job_title nvarchar\(100\) NULL,grade nvarchar\(40\) NULL/);
  for (const gate of [
    'AccessRuntimeAccount',
    "'permissions.manage'",
    "'users.manage'",
    'UPDLOCK,HOLDLOCK',
    '@revision<>@expected_revision',
    'at least one active access administrator',
    'INSERT dbo.AccessAudit',
    'ROLLBACK TRANSACTION',
    'AccessReportingValid',
  ])
    assert.ok(source.includes(gate));
  assert.match(source, /\[value\] nvarchar\(max\)/);
  assert.match(source, /DATALENGTH.*>200/);
  assert.match(source, /DATALENGTH.*>80/);
  assert.match(source, /HAVING COUNT\(\*\)>1/);
  assert.match(source, /\[type\] NOT IN \(0,1\)/);
  assert.match(source, /SELECT @title=job_title,@grade=grade/);
  assert.match(source, /IF EXISTS\(SELECT 1 FROM @employment WHERE \[key\]='jobTitle'\)/);
  assert.doesNotMatch(
    source,
    /CREATE OR ALTER FUNCTION|INSERT dbo\.AccessImplementedScope|UPDATE dbo\.SkillClaimDraft/,
  );
});
