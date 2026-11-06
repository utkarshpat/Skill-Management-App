import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  organizationChange,
  reportingChain,
  type OrganizationState,
} from '../src/modules/organization/organization.js';
import { createApp } from '../src/create-app.js';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import express from 'express';
import { registerRoutes } from '../src/modules/organization/routes.js';

const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
const third = '10000000-0000-4000-8000-000000000003';
const state = (): OrganizationState => ({
  revision: 1,
  nodes: [],
  people: [first, second, third].map((id, index) => ({
    id,
    displayName: `Person ${index}`,
    employeeCode: String(index),
    active: true,
  })),
  assignments: [
    { personId: first, teamId: null, managerId: second },
    { personId: second, teamId: null, managerId: third },
  ],
});

test('reporting levels follow people edges and fail closed on broken, inactive or circular chains', () => {
  const source = state();
  assert.deepEqual(
    reportingChain(source, first).map(person => person.id),
    [second, third],
  );
  assert.deepEqual(reportingChain(source, third), []);
  source.assignments.push({ personId: third, teamId: null, managerId: first });
  assert.throws(() => reportingChain(source, first), /attention/);
  const inactive = state();
  inactive.people[1].active = false;
  assert.throws(() => reportingChain(inactive, first), /attention/);
  const missing = state();
  missing.people.pop();
  assert.throws(() => reportingChain(missing, first), /attention/);
  const ambiguous = state();
  ambiguous.assignments.push({ ...ambiguous.assignments[0] });
  assert.throws(() => reportingChain(ambiguous, first), /Ambiguous/);
});

test('organization input rejects missing parents, arbitrary IDs and untrusted hierarchy fields', () => {
  assert.throws(
    () =>
      organizationChange({ kind: 'node', type: 'TEAM', name: 'Team', active: true, revision: 1 }),
    /parent/,
  );
  assert.throws(
    () => organizationChange({ kind: 'assignment', personId: 'outside', revision: 1 }),
    /valid/,
  );
  assert.throws(
    () =>
      organizationChange({
        kind: 'node',
        type: 'DELIVERY_UNIT',
        name: 'Unit',
        active: true,
        revision: 1,
        parentId: first,
      }),
    /parent/,
  );
  const change = organizationChange({
    kind: 'assignment',
    personId: first,
    teamId: null,
    managerId: second,
    revision: 1,
    actorId: third,
    role: 'Super Admin',
    reportingLevel: 200,
  });
  assert.deepEqual(change.payload, { teamId: null, departmentId: null, managerId: second });
  assert.equal(change.targetId, first);
  assert.throws(
    () =>
      organizationChange({
        kind: 'assignment',
        personId: first,
        teamId: second,
        departmentId: third,
        revision: 1,
      }),
    /either/,
  );
  assert.equal(
    organizationChange({ kind: 'assignment', personId: first, departmentId: second, revision: 1 })
      .payload.departmentId,
    second,
  );
});

test('organization endpoints bind actor to Microsoft identity and require current people administration', async () => {
  const store = await LocalAccessStore.open();
  const admin = store.snapshot().people[0].id;
  let calls = 0;
  let actor = '';
  const server = createApp({
    verify: async header => {
      if (header !== 'Bearer owner') throw new Error();
      return { tenantId: 'tenant', objectId: 'owner' };
    },
    profile: async () => undefined,
    access: store,
    resolveAccess: async () => admin,
    organization: {
      snapshot: async () => state(),
      save: async id => {
        calls++;
        actor = id;
      },
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/access/organization`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
    assert.equal((await fetch(url, { headers })).status, 200);
    const change = {
      kind: 'assignment',
      revision: 1,
      personId: first,
      teamId: null,
      departmentId: null,
      managerId: third,
      actorId: 'attacker',
    };
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body: JSON.stringify(change) })).status,
      409,
    );
    const preview = await (
      await fetch(url + '/preview', { method: 'POST', headers, body: JSON.stringify(change) })
    ).json();
    assert.equal(calls, 0);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...change, previewReceipt: preview.receipt }),
        })
      ).status,
      200,
    );
    assert.equal(actor, admin);
    const denied = store.snapshot();
    denied.people[0].overrides.push({
      permission: 'users.manage',
      scope: 'ORGANIZATION',
      effect: 'DENY',
    });
    store.snapshot = () => structuredClone(denied);
    assert.equal((await fetch(url, { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('organization module fails closed if mounted without access authentication middleware', async () => {
  let calls = 0;
  const app = express();
  registerRoutes(app, {
    organization: {
      snapshot: async () => {
        calls++;
        return state();
      },
      save: async () => {
        calls++;
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/access/organization`;
  try {
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { method: 'POST' })).status, 403);
    assert.equal(calls, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('organization preview preserves broken or inactive placement on manager-only change and rejects unchanged assignments', async () => {
  const { previewOrganization } = await import('../src/modules/organization/preview.js');
  const broken: OrganizationState = {
    ...state(),
    nodes: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        kind: 'TEAM',
        name: 'Inactive Team',
        parentId: null,
        active: false,
      },
    ],
    assignments: [
      {
        personId: first,
        teamId: '30000000-0000-4000-8000-000000000001',
        departmentId: null,
        managerId: second,
      },
    ],
  };
  assert.throws(
    () =>
      previewOrganization(broken, first, {
        kind: 'assignment',
        revision: 1,
        personId: first,
        teamId: '30000000-0000-4000-8000-000000000001',
        departmentId: null,
        managerId: second,
      }),
    /Change the organization placement or reporting manager before previewing/,
  );
  const managerOnly = previewOrganization(broken, first, {
    kind: 'assignment',
    revision: 1,
    personId: first,
    teamId: '30000000-0000-4000-8000-000000000001',
    departmentId: null,
    managerId: third,
  });
  assert.ok(managerOnly.receipt);
});

test('demo organization routes enforce Origin checks across lowercase and mixed-case URLs', async () => {
  const store = await LocalAccessStore.open();
  const admin = store.snapshot().people[0].id;
  let saves = 0;
  const server = createApp(
    {
      verify: async () => {
        throw new Error('unexpected bearer verification');
      },
      profile: async () => undefined,
      organization: {
        snapshot: async () => state(),
        save: async () => {
          saves++;
        },
      },
    },
    { developmentStore: store },
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const change = {
    kind: 'assignment',
    revision: 1,
    personId: first,
    teamId: null,
    departmentId: null,
    managerId: third,
  };
  try {
    const loginRes = await fetch(`${origin}/api/dev-login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId: admin }),
    });
    assert.equal(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';
    assert.ok(cookieHeader);

    for (const path of [
      '/api/dev-access/organization/preview',
      '/API/DEV-ACCESS/organization/preview',
      '/api/dev-access/organization',
      '/API/DEV-ACCESS/organization',
    ]) {
      const missingOrigin = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      });
      assert.equal(missingOrigin.status, 403, `Expected 403 without Origin for ${path}`);
      const wrongOrigin = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          Origin: 'http://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(change),
      });
      assert.equal(wrongOrigin.status, 403, `Expected 403 with cross-origin for ${path}`);
    }
    assert.equal(saves, 0);

    const previewRes = await fetch(`${origin}/API/DEV-ACCESS/organization/preview`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(change),
    });
    assert.equal(previewRes.status, 200);
    const preview = await previewRes.json();
    const saveRes = await fetch(`${origin}/API/DEV-ACCESS/organization`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...change, previewReceipt: preview.receipt }),
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saves, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

