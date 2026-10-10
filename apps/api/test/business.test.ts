import { AccessError } from '../src/shared/errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { unzipSync, strFromU8 } from 'fflate';
import {
  normalizeBusinessAdministration,
  normalizeBusinessCollections,
  businessQuery,
  businessChange,
  previewBusiness,
  type BusinessContext,
  type BusinessDashboard,
  type BusinessStore,
} from '../src/modules/business/business.js';
import { businessWorkflow } from '../src/modules/business/workflows.js';
import { assertBusinessScope, SqlBusinessStore } from '../src/modules/business/sql-store.js';
import { businessCsv, businessXlsx } from '../src/modules/business/export.js';
import {
  effectiveAccess,
  workspaceFor,
  type AccessStore,
  type LocalAccessState,
} from '../src/modules/access/index.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import { readSqlJson } from '../src/shared/sql-json.js';
import { createApp } from '../src/create-app.js';
const actor = '00000000-0000-4000-8000-000000000001',
  scope = '00000000-0000-4000-8000-000000000002',
  person = '00000000-0000-4000-8000-000000000003';
const context = (): BusinessContext => ({
  actorId: actor,
  revision: 1,
  asOf: '2026-10-10T00:00:00Z',
  canView: true,
  canExport: true,
  canManage: true,
  canAmend: true,
  personalBaseline: true,
  scopes: [
    {
      id: scope,
      kind: 'PROJECT',
      label: 'Project A',
      scopeId: scope,
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
  ],
});
const dashboard = (): BusinessDashboard => ({
  context: context(),
  summary: { employees: 2, certified: 1, skilled: 1, pending: 1, expired: 1, expiring: 0 },
  coverage: [],
  distribution: [],
  expiry: [],
  activity: [],
  rows: [
    {
      id: person,
      employee: ' =HYPERLINK("evil")',
      employeeCode: 'QA',
      name: 'Approved but expired',
      status: 'APPROVED',
      validity: 'EXPIRED',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
});
const state = (): LocalAccessState => ({
  revision: 1,
  roles: [{ id: 'renamed', name: 'A misleading title', permissions: [] }],
  people: [
    {
      id: actor,
      displayName: 'QA Actor',
      employeeCode: 'QA',
      active: true,
      roleIds: ['renamed'],
      overrides: [],
      business: {
        personalBaseline: true,
        systemAdmin: false,
        view: true,
        export: true,
        manage: true,
        amend: true,
        demandView: true,
        demandCreate: true,
        matchingView: true,
        matchingRun: true,
        shortlist: true,
        scopes: [
          {
            ...context().scopes[0],
            kind: 'PROJECT',
            effect: 'ALLOW',
            bundle: 'BUSINESS_OPERATIONS',
            validUntil: null,
            reason: 'QA scope',
          },
        ],
      },
    },
  ],
  audit: [],
});
test('business filters are bounded, reject forged authority, invalid dates and impossible rank windows', () => {
  assert.equal(businessQuery({}).maxRank, 5);
  for (const q of [
    { actorId: person },
    { scopeId: 'ORGANIZATION' },
    { from: '2026-02-30' },
    { from: '2026-10-11', to: '2026-10-01' },
    { page: 0 },
    { minRank: 4, maxRank: 2 },
    { dataset: 'private-drafts' },
    { validity: 'tomorrow' },
  ])
    assert.throws(() => businessQuery(q));
  assert.equal(businessQuery({ validity: '15_30', minRank: 3, maxRank: 3 }).validity, '15_30');
});
test('personal baseline survives title/role changes; denies and inactive status still win', () => {
  const s = state(),
    p = s.people[0];
  p.roleIds = [];
  p.business!.view = false;
  for (const action of ['profile.view', 'skill.claim', 'learning.manage', 'request.create'])
    assert.equal(effectiveAccess(s, p, action, 'OWN').allowed, true);
  assert.equal(effectiveAccess(s, p, 'skill.view', 'WORKSPACE').allowed, true);
  p.overrides.push({ permission: 'skill.claim', scope: 'OWN', effect: 'DENY' });
  assert.equal(effectiveAccess(s, p, 'skill.claim').allowed, false);
  p.active = false;
  assert.equal(effectiveAccess(s, p, 'profile.view').allowed, false);
});
test('business responsibility never grants review; legacy organization allowances do not create scoped access', () => {
  const s = state(),
    p = s.people[0];
  assert.equal(workspaceFor(s, p).capabilities.businessOperations, true);
  assert.equal(effectiveAccess(s, p, 'skill.verify', 'DIRECT_REPORTS').allowed, false);
  assert.equal(effectiveAccess(s, p, 'reports.view', 'WORKSPACE').allowed, true);
  p.overrides.push({ permission: 'reports.view', scope: 'ORGANIZATION', effect: 'DENY' });
  assert.equal(effectiveAccess(s, p, 'reports.view', 'WORKSPACE').reasonCode, 'EXPLICIT_DENY');
  delete p.business;
  p.overrides = [{ permission: 'reports.view', scope: 'ORGANIZATION', effect: 'ALLOW' }];
  assert.equal(effectiveAccess(s, p, 'reports.view', 'WORKSPACE').allowed, false);
});
test('explicit System Admin responsibility respects bundle and individual deny', () => {
  const s = state(),
    p = s.people[0];
  p.business!.systemAdmin = true;
  assert.equal(effectiveAccess(s, p, 'permissions.manage', 'WORKSPACE').allowed, true);
  p.business!.adminDenied = true;
  assert.equal(effectiveAccess(s, p, 'permissions.manage', 'WORKSPACE').allowed, false);
  p.business!.adminDenied = false;
  p.overrides.push({ permission: 'audit.view', scope: 'ORGANIZATION', effect: 'DENY' });
  assert.equal(effectiveAccess(s, p, 'audit.view', 'WORKSPACE').allowed, false);
});
test('previews validate current bound records and reject stale, foreign and unsupported assignments', () => {
  const current = {
    revision: 1,
    projects: [{ id: scope, name: 'A', active: true }],
    people: [{ id: person, name: 'QA', active: true }],
    nodes: [],
    memberships: [],
    responsibilities: [],
  };
  const input = {
    revision: 1,
    kind: 'MEMBERSHIP',
    id: scope,
    payload: { personId: person, projectId: scope, active: true, reason: 'QA' },
  };
  const preview = previewBusiness(actor, current, businessChange(input));
  assert.ok(preview.receipt);
  assert.equal(preview.before, null);
  assert.deepEqual(preview.impact.actions, ['No new authority']);
  assert.throws(() => previewBusiness(actor, { ...current, revision: 2 }, businessChange(input)));
  assert.throws(() =>
    previewBusiness(
      actor,
      current,
      businessChange({ ...input, payload: { ...input.payload, personId: actor } }),
    ),
  );
  assert.throws(() =>
    businessChange({
      ...input,
      kind: 'RESPONSIBILITY',
      payload: {
        personId: person,
        bundle: 'SYSTEM_ADMIN',
        kind: 'PROJECT',
        scopeId: scope,
        effect: 'ALLOW',
        active: true,
        reason: 'QA',
      },
    }),
  );
  assert.throws(() =>
    businessChange({
      ...input,
      kind: 'RESPONSIBILITY',
      payload: {
        personId: person,
        bundle: 'BUSINESS_OPERATIONS',
        kind: 'PROJECT',
        scopeId: scope,
        effect: 'DENY',
        active: true,
        reason: 'QA',
      },
    }),
  );
});
test('delivery rechecks reject expired/revoked scope, changed revision and revoked export', () => {
  assertBusinessScope(context(), context());
  assert.throws(() => assertBusinessScope(context(), { ...context(), canView: false }));
  assert.throws(() => assertBusinessScope(context(), { ...context(), scopes: [] }));
  assert.throws(() => assertBusinessScope(context(), { ...context(), revision: 2 }));
  assert.throws(() => assertBusinessScope(context(), { ...context(), canExport: false }, true));
});
test('CSV and XLSX export every supplied row, preserve metadata and protect formulas', () => {
  const d = dashboard(),
    q = businessQuery({ dataset: 'certifications', scopeId: scope }),
    csv = businessCsv(d, q);
  assert.match(csv, /2026-10-10T00:00:00Z/);
  assert.match(csv, /' =HYPERLINK/);
  assert.match(csv, /APPROVED/);
  assert.match(csv, /EXPIRED/);
  const xlsx = unzipSync(businessXlsx(d, q));
  assert.ok(xlsx['xl/worksheets/sheet2.xml']);
  const sheet = strFromU8(xlsx['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /inlineStr/);
  assert.doesNotMatch(sheet, /<f>/);
  assert.match(sheet, /&apos; =HYPERLINK/);
  d.context.scopes[0].label = ' =HYPERLINK("scope")\u0001';
  assert.match(businessCsv(d, q), /"Scope","' =HYPERLINK/);
  const contextSheet = strFromU8(unzipSync(businessXlsx(d, q))['xl/worksheets/sheet2.xml']);
  assert.match(contextSheet, /&apos; =HYPERLINK/);
  assert.doesNotMatch(contextSheet, /\u0001/);
});
test('SQL JSON timestamps remain UTC and GUID normalization never changes ordinary names', () => {
  const row = readSqlJson<Record<string, string>>(
    '{"id":"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA","name":"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA","asOf":"2026-10-10T12:00:00.123","expiry":"2026-10-10"}',
  );
  assert.equal(row.asOf, '2026-10-10T12:00:00.123Z');
  assert.equal(row.id, row.name.toLowerCase());
  assert.equal(row.expiry, '2026-10-10');
});
test('responsibility expiry is canonical UTC so SQL and preview agree on its instant', () => {
  const change = {
    revision: 1,
    kind: 'RESPONSIBILITY',
    id: scope,
    payload: {
      personId: person,
      bundle: 'BUSINESS_OPERATIONS',
      kind: 'PROJECT',
      scopeId: scope,
      effect: 'DENY',
      active: true,
      reason: 'Temporary exception',
      validUntil: '2099-01-01T12:30:00+05:30',
    },
  };
  assert.equal(businessChange(change).payload.validUntil, '2099-01-01T07:00:00.000Z');
  assert.throws(() =>
    businessChange({
      ...change,
      payload: { ...change.payload, validUntil: '2099-01-01T12:30:00' },
    }),
  );
});
test('demand and amendment commands reject actor selectors, duplicate criteria and missing canonical requirements', () => {
  assert.throws(() => businessWorkflow('MATCHES', { id: scope, actorId: person }));
  assert.throws(() =>
    businessWorkflow('SAVE_DEMAND', {
      id: scope,
      revision: 1,
      scopeId: scope,
      title: 'QA',
      requirements: { skills: [], certifications: [] },
    }),
  );
  assert.throws(() =>
    businessWorkflow('SAVE_DEMAND', {
      id: scope,
      revision: 1,
      scopeId: scope,
      title: 'QA',
      requirements: {
        skills: [
          { id: scope, minRank: 2 },
          { id: scope, minRank: 3 },
        ],
        certifications: [],
      },
    }),
  );
  const command = businessWorkflow('PROPOSE', {
    id: scope,
    revision: 1,
    type: 'SKILL',
    name: 'QA',
    category: 'Cloud',
    description: 'QA',
    reason: 'QA',
    criteria: ['1', '2', '3', '4', '5'],
  });
  assert.equal((command.payload.definition as { levels: unknown[] }).levels.length, 5);
});
test('HTTP preview and execution bind actor and reject forged receipts and changed current access', async t => {
  let current = context(),
    saved = 0;
  const s = state(),
    access: AccessStore = {
      snapshot: () => structuredClone(s),
      person: () => s.people[0],
      save: async () => s,
    };
  const business: BusinessStore = {
    context: async id => {
      assert.equal(id, actor);
      return structuredClone(current);
    },
    dashboard: async () => dashboard(),
    administration: async () => ({
      revision: current.revision,
      projects: [],
      people: [],
      nodes: [],
      memberships: [],
      responsibilities: [],
      personalBaseline: true,
      baselineAffectedPeople: 1,
    }),
    change: async () => {
      saved++;
    },
    workflow: async () => ({}),
  };
  const server = createApp({
    verify: async h => {
      if (h !== 'Bearer trusted') throw Error();
      return { tenantId: actor, objectId: actor };
    },
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access,
    business,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/business`,
    headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' };
  assert.equal((await fetch(root + '/context')).status, 401);
  for (const path of ['/workflow/preview', '/workflow'])
    assert.equal(
      (await fetch(root + path, { method: 'POST', headers })).status,
      400,
      'Empty bodies must be validation errors, not crashes.',
    );
  const body = {
    revision: 1,
    kind: 'PERSONAL_BASELINE',
    id: scope,
    payload: { enabled: true, reason: 'QA baseline' },
  };
  const preview = await fetch(root + '/administration/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).then(r => r.json());
  assert.equal(
    (
      await fetch(root + '/administration', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, previewReceipt: 'forged' }),
      })
    ).status,
    409,
  );
  assert.equal(saved, 0);
  assert.equal(
    (
      await fetch(root + '/administration', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, previewReceipt: preview.receipt }),
      })
    ).status,
    200,
  );
  assert.equal(saved, 1);
  for (const command of [
    {
      operation: 'SAVE_DEMAND',
      payload: {
        id: scope,
        revision: 1,
        scopeId: scope,
        title: 'QA',
        requirements: { skills: [], certifications: [person] },
      },
    },
    { operation: 'SHORTLIST', payload: { id: scope, revision: 1, personId: person, note: 'QA' } },
    { operation: 'APPROVE_AMENDMENT', payload: { id: scope, revision: 1, note: 'QA' } },
  ])
    assert.equal(
      (
        await fetch(root + '/workflow/preview', {
          method: 'POST',
          headers,
          body: JSON.stringify(command),
        })
      ).status,
      403,
      'General view/manage access must not advertise an individually denied action',
    );
  current = { ...current, canView: false, canManage: false, canAmend: false };
  assert.equal((await fetch(root + '/dashboard', { headers })).status, 403);
});
test('AI business tools bind actor, reject scope-forging arguments and discard mid-read revocation', async () => {
  const s = state(),
    access: AccessStore = {
      snapshot: () => structuredClone(s),
      person: () => s.people[0],
      save: async () => s,
    };
  const business: BusinessStore = {
    context: async () => context(),
    dashboard: async id => {
      assert.equal(id, actor);
      s.people[0].business!.view = false;
      return dashboard();
    },
    administration: async () => ({}),
    change: async () => {},
    workflow: async () => ({}),
  };
  const registry = new ToolRegistry(
    access,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    business,
  );
  assert.ok(registry.available(s, s.people[0]).some(t => t.function.name === 'credential_expiry'));
  await assert.rejects(
    registry.execute(actor, 'business_insights', { personId: person }, AbortSignal.timeout(1000)),
  );
  await assert.rejects(registry.execute(actor, 'business_insights', {}, AbortSignal.timeout(1000)));
});

test('business AI separates aggregate facts from paginated people and cannot override its dataset', async () => {
  const s = state();
  const access: AccessStore = {
    snapshot: () => structuredClone(s),
    person: () => s.people[0],
    save: async () => s,
  };
  let reads = 0;
  const business: BusinessStore = {
    context: async () => context(),
    dashboard: async (id, query) => {
      assert.equal(id, actor);
      assert.equal(query.dataset, 'people');
      assert.equal(query.scopeId, scope);
      reads++;
      return dashboard();
    },
    administration: async () => ({}),
    change: async () => {},
    workflow: async () => ({}),
  };
  const registry = new ToolRegistry(
    access,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    business,
  );
  const signal = AbortSignal.timeout(1000);
  for (const invalid of [
    { dataset: 'certifications' },
    { sort: 'employee_desc' },
    { actorId: person },
  ])
    await assert.rejects(registry.execute(actor, 'business_insights', invalid, signal));
  assert.equal(reads, 0);
  const insights = (await registry.execute(actor, 'business_insights', { scopeId: scope }, signal))
    .data as Record<string, unknown>;
  assert.ok(insights.summary);
  assert.equal(
    insights.rows,
    undefined,
    'Aggregate tool must not send individual records to the model.',
  );
  const people = (await registry.execute(actor, 'business_people', { scopeId: scope }, signal))
    .data as Record<string, unknown>;
  assert.deepEqual(people.rows, dashboard().rows);
  assert.equal(people.coverage, undefined, 'Roster tools must omit unrelated chart payloads.');
});

test('business AI produces only human-review drafts and never invokes writes', async () => {
  for (const kind of ['amendment_draft', 'demand_draft'] as const) {
    const s = state(),
      access: AccessStore = {
        snapshot: () => structuredClone(s),
        person: () => s.people[0],
        save: async () => {
          throw Error('No writes');
        },
      };
    const result = await new AssistantService(access, undefined, {
      name: 'synthetic',
      complete: async () => ({
        content: '',
        calls: [
          {
            id: 'draft',
            type: 'function',
            function: {
              name: 'present_output',
              arguments: JSON.stringify({
                kind,
                title: 'Cloud delivery',
                summary: 'Proposal for review',
                body: 'Reviewed capability requirements',
                steps: [],
                questions: [],
              }),
            },
          },
        ],
      }),
    }).chat(actor, {
      messages: [{ role: 'user', content: 'Prepare a ' + kind.replace('_', ' ') }],
    });
    assert.equal(result.artifact?.kind, kind);
    assert.equal(result.mode, 'read-only');
  }
});
test('business AI discards a reply when scope membership changes while permission remains allowed', async () => {
  const s = state(),
    access: AccessStore = {
      snapshot: () => structuredClone(s),
      person: () => s.people[0],
      save: async () => s,
    };
  await assert.rejects(
    new AssistantService(access, undefined, {
      name: 'synthetic',
      complete: async () => {
        s.people[0].business!.scopes[0].scopeId = person;
        return { content: 'Facts from the former scope', calls: [] };
      },
    }).chat(actor, {
      messages: [{ role: 'user', content: 'Summarize current business analytics' }],
    }),
    /scope changed|Access changed/,
  );
});
test('business read pagination rejects invalid pages and retains bounded literal search', () => {
  for (const page of [0, -1, 'bad', 10001])
    assert.throws(() => businessWorkflow('MASTERS', { page }));
  assert.equal(businessWorkflow('MASTERS', { page: 2, search: 'Cloud' }).payload.search, 'Cloud');
  assert.throws(() => businessWorkflow('MASTERS', { includeInactive: 'invented' }));
});

test('business discovery hides unavailable modules and denied profile prerequisites', () => {
  const s = state(),
    p = s.people[0];
  p.overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
  assert.equal(workspaceFor(s, p).capabilities.businessOperations, false);
  assert.equal(workspaceFor(s, p).capabilities.amendments, false);
  assert.equal(workspaceFor(s, p).capabilities.businessAdministration, false);
  delete p.business;
  p.overrides = [];
  s.roles[0].permissions = [
    { permission: 'permissions.manage', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'users.manage', scope: 'ORGANIZATION', effect: 'ALLOW' },
    { permission: 'audit.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
  ];
  assert.equal(workspaceFor(s, p).capabilities.businessAdministration, false);
});

test('HTTP recovers an exact committed command without a second write and still denies revoked access', async t => {
  let current = { ...context(), canDemandCreate: true },
    writes = 0,
    committed: string | undefined;
  const s = state();
  const access: AccessStore = {
    snapshot: () => structuredClone(s),
    person: () => s.people[0],
    save: async () => s,
  };
  const business: BusinessStore = {
    context: async () => structuredClone(current),
    dashboard: async () => dashboard(),
    administration: async () => ({}),
    change: async () => {},
    workflow: async (_actor, _operation, payload) => {
      writes++;
      const { accessRevision: _access, ...command } = payload;
      committed = JSON.stringify(command);
      current.revision++;
      return { saved: true };
    },
    recoverWorkflow: async (_actor, _operation, payload) => {
      if (!current.canDemandCreate) throw new AccessError(403, 'Revoked');
      return JSON.stringify(payload) === committed ? { saved: true, replayed: true } : null;
    },
  };
  const server = createApp({
    verify: async () => ({ tenantId: actor, objectId: actor }),
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access,
    business,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/business`,
    headers = { Authorization: 'Bearer trusted', 'Content-Type': 'application/json' };
  const command = {
    operation: 'SAVE_DEMAND',
    payload: {
      id: scope,
      revision: 1,
      scopeId: scope,
      title: 'Retry fixture',
      requirements: { skills: [], certifications: [person] },
    },
  };
  const preview = await fetch(root + '/workflow/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify(command),
  }).then(r => r.json());
  const body = JSON.stringify({ ...command, previewReceipt: preview.receipt });
  assert.equal((await fetch(root + '/workflow', { method: 'POST', headers, body })).status, 200);
  const retry = await fetch(root + '/workflow', { method: 'POST', headers, body });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).replayed, true);
  assert.equal(writes, 1);
  const altered = JSON.stringify({
    ...command,
    payload: { ...command.payload, title: 'Changed' },
    previewReceipt: preview.receipt,
  });
  assert.equal(
    (await fetch(root + '/workflow', { method: 'POST', headers, body: altered })).status,
    409,
  );
  current.canDemandCreate = false;
  assert.equal((await fetch(root + '/workflow', { method: 'POST', headers, body })).status, 403);
  assert.equal(writes, 1);
});

test('Organization responsibilities are server-account bound and reject a supplied resource binding', () => {
  const input = {
    revision: 1,
    kind: 'RESPONSIBILITY',
    id: scope,
    payload: {
      personId: person,
      bundle: 'BUSINESS_OPERATIONS',
      kind: 'ORGANIZATION',
      effect: 'ALLOW',
      active: true,
      validUntil: null,
      reason: 'Organization reporting',
    },
  };
  assert.equal(businessChange(input).payload.scopeId, null);
  assert.equal(
    businessChange({ ...input, payload: { ...input.payload, scopeId: null } }).payload.scopeId,
    null,
  );
  for (const scopeId of [scope, '', 'another-account'])
    assert.throws(
      () => businessChange({ ...input, payload: { ...input.payload, scopeId } }),
      e => e instanceof AccessError && e.status === 400,
    );
  assert.throws(() => businessQuery({ accountId: scope }), AccessError);
  assert.throws(() => businessQuery({ actorId: person }), AccessError);
});

test('newly activated business administration returns empty collections without masking malformed data', () => {
  const source = { revision: 1, personalBaseline: true, people: [{ id: actor }], projects: null };
  const result = normalizeBusinessAdministration(source);
  for (const key of [
    'projects',
    'memberships',
    'responsibilities',
    'nodes',
    'historicalGrantsForReview',
  ])
    assert.deepEqual(result[key], []);
  assert.deepEqual(result.people, source.people);
  assert.equal(source.projects, null);
  for (const value of ['[]', {}, 0])
    assert.throws(
      () => normalizeBusinessAdministration({ responsibilities: value }),
      e => e instanceof AccessError && e.status === 503,
    );
});

test('empty business scope, dashboard and workflow collections retain their array contracts', () => {
  for (const keys of [
    ['scopes'],
    ['coverage', 'distribution', 'categories', 'comparisons', 'expiry', 'activity', 'rows'],
    ['providers', 'certifications', 'skills'],
    ['rows'],
  ]) {
    const source: Record<string, unknown> = { revision: 184, total: 0, [keys[0]]: null };
    const result = normalizeBusinessCollections(source, keys);
    for (const key of keys) assert.deepEqual(result[key], []);
    assert.equal(source[keys[0]], null);
    assert.equal(result.total, 0);
    const existing = [{ id: actor }];
    assert.deepEqual(
      normalizeBusinessCollections({ [keys[0]]: existing }, keys)[keys[0]],
      existing,
    );
    for (const malformed of ['[]', {}, 1, false])
      assert.throws(
        () => normalizeBusinessCollections({ [keys[0]]: malformed }, keys),
        e => e instanceof AccessError && e.status === 503,
      );
  }
});

test('SQL business adapter normalizes empty reads before delivering them to web and AI consumers', async () => {
  const store = new SqlBusinessStore(actor);
  const emptyContext = { ...context(), scopes: undefined };
  Object.defineProperty(store, 'execute', {
    value: async (_actor: string, procedure: string) => {
      if (procedure === 'dbo.BusinessContext') return { ...emptyContext };
      if (procedure === 'dbo.BusinessDashboard')
        return {
          context: { ...emptyContext },
          summary: { employees: 0 },
          total: 0,
          page: 1,
          pageSize: 25,
        };
      return { revision: 1, total: 0 };
    },
  });
  assert.deepEqual((await store.context(actor)).scopes, []);
  const empty = await store.dashboard(actor, businessQuery({ search: 'no matching people' }));
  for (const key of [
    'coverage',
    'distribution',
    'categories',
    'comparisons',
    'expiry',
    'activity',
    'rows',
  ] as const)
    assert.deepEqual(empty[key], []);
  assert.deepEqual(empty.context.scopes, []);
  const masters = await store.workflow(actor, 'MASTERS', { page: 1 });
  for (const key of ['providers', 'certifications', 'skills']) assert.deepEqual(masters[key], []);
  for (const operation of ['AMENDMENTS', 'DEMANDS', 'MATCHES'])
    assert.deepEqual((await store.workflow(actor, operation, { page: 1 })).rows, []);
  const admin = await store.administration(actor);
  for (const key of ['projects', 'memberships', 'responsibilities'])
    assert.deepEqual(admin[key], []);
});
