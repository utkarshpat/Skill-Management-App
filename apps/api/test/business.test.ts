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

test('credential mapping proposals accept canonical skill IDs and reject duplicate, forged or wrong-master inputs', () => {
  const command = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    type: 'CERTIFICATION',
    name: 'Oracle Database SQL',
    category: 'Oracle Platform',
    providerId: '22222222-2222-4222-8222-222222222222',
    reason: 'Catalogue mapping',
    relatedSkillIds: ['33333333-3333-4333-8333-333333333333'],
  };
  assert.deepEqual(
    (businessWorkflow('PROPOSE', command).payload.definition as any).relatedSkillIds,
    command.relatedSkillIds,
  );
  assert.throws(() => businessWorkflow('PROPOSE', { ...command, relatedSkillIds: ['invalid'] }));
  assert.throws(() =>
    businessWorkflow('PROPOSE', {
      ...command,
      relatedSkillIds: [...command.relatedSkillIds, ...command.relatedSkillIds],
    }),
  );
  assert.throws(() =>
    businessWorkflow('PROPOSE', {
      ...command,
      relatedSkillIds: Array(21).fill(command.relatedSkillIds[0]),
    }),
  );
  assert.throws(() => businessWorkflow('PROPOSE', { ...command, type: 'PROVIDER' }));
});
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
  assert.equal(businessQuery({}).maxRank, 4);
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
test('template module settings have independent, receipt-bound previews', t => {
  const originalFlag = process.env.PHASE_TWO_ENABLED;
  t.after(() => {
    if (originalFlag === undefined) delete process.env.PHASE_TWO_ENABLED;
    else process.env.PHASE_TWO_ENABLED = originalFlag;
  });
  process.env.PHASE_TWO_ENABLED = 'false';
  const current = { revision: 1, baselineAffectedPeople: 12, templateFeatures: [] };
  const input = {
    kind: 'TEMPLATE_FEATURES',
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    payload: { template: 'EMPLOYEE', learning: true, requests: false, reason: 'Enable learning' },
  };
  const reviewed = previewBusiness(actor, current, businessChange(input));
  assert.deepEqual(reviewed.before, { template: 'EMPLOYEE', learning: false, requests: false });
  assert.equal(reviewed.impact.baselineAffectedPeople, 12);
  const scoped = businessChange({
    ...input,
    payload: { ...input.payload, template: 'SYSTEM_ADMIN' },
  });
  const scopedPreview = previewBusiness(actor, current, scoped);
  assert.notEqual(scopedPreview.receipt, reviewed.receipt);
  assert.equal(scopedPreview.impact.baselineAffectedPeople, undefined);
  process.env.PHASE_TWO_ENABLED = 'true';
  const employeeCutover = previewBusiness(actor, current, businessChange(input));
  assert.deepEqual(employeeCutover.before, {
    template: 'EMPLOYEE',
    learning: true,
    requests: true,
  });
  const scopedCutover = previewBusiness(actor, current, scoped);
  assert.equal(scopedCutover.impact.baselineAffectedPeople, 12);
  assert.match(scopedCutover.warnings.join(' '), /first save replaces workspace-wide/);
  assert.notEqual(scopedCutover.receipt, scopedPreview.receipt);
  const configured = { ...current, templateFeatures: [employeeCutover.before] };
  assert.doesNotMatch(previewBusiness(actor, configured, scoped).warnings.join(' '), /first save/);
  assert.throws(() => previewBusiness(actor, { ...current, revision: 2 }, scoped), { status: 409 });
  assert.throws(
    () => businessChange({ ...input, payload: { ...input.payload, template: 'MANAGER' } }),
    { status: 400 },
  );
});

test('workspace exposes each template module only when its effective availability allows it', () => {
  const current = state();
  const viewer = current.people[0];
  viewer.business = { ...viewer.business!, learningEnabled: true, requestsEnabled: false };
  assert.equal(workspaceFor(current, viewer).capabilities.learning, true);
  assert.equal(workspaceFor(current, viewer).capabilities.requests, false);
  viewer.business = { ...viewer.business, learningEnabled: false, requestsEnabled: true };
  assert.equal(workspaceFor(current, viewer).capabilities.learning, false);
  assert.equal(workspaceFor(current, viewer).capabilities.requests, true);
});

test('employee permission edits preserve required profile and change only the baseline grant', () => {
  const current = state();
  const viewer = current.people[0];
  const payload = {
    enabled: true,
    employeePermissions: ['profile.view', 'skill.view'],
    reason: 'Remove default claims',
  };
  const input = { kind: 'PERSONAL_BASELINE', id: scope, revision: 1, payload };
  const change = businessChange(input);
  const reviewed = previewBusiness(
    actor,
    {
      revision: 1,
      personalBaseline: true,
      employeePermissions: ['profile.view', 'skill.view', 'skill.claim'],
    },
    change,
  );
  assert.deepEqual(reviewed.impact.actions, ['Remove Submit skill and certification claims']);
  for (const employeePermissions of [
    [],
    ['profile.view', 'users.manage'],
    ['profile.view', 'profile.view'],
  ])
    assert.throws(
      () => businessChange({ ...input, payload: { ...payload, employeePermissions } }),
      { status: 400 },
    );
  assert.equal(workspaceFor(current, viewer).capabilities.claimSkills, true);
  viewer.business!.employeePermissions = payload.employeePermissions;
  assert.equal(effectiveAccess(current, viewer, 'profile.view').allowed, true);
  assert.equal(effectiveAccess(current, viewer, 'skill.claim').allowed, false);
  viewer.overrides = [{ permission: 'skill.claim', effect: 'ALLOW', scope: 'OWN' }];
  assert.equal(effectiveAccess(current, viewer, 'skill.claim').allowed, true);
});

test('template module switches agree across direct API access, Genie actions and notifications', async t => {
  const originalFlag = process.env.PHASE_TWO_ENABLED;
  t.after(() => {
    if (originalFlag === undefined) delete process.env.PHASE_TWO_ENABLED;
    else process.env.PHASE_TWO_ENABLED = originalFlag;
  });
  process.env.PHASE_TWO_ENABLED = 'false';
  const current = state();
  const viewer = current.people[0];
  const access = {
    snapshot: () => structuredClone(current),
    person: () => viewer,
    save: async () => current,
  };
  const notification = (id: string, href: string) => ({
    id,
    href,
    at: '2026-11-26T10:00:00Z',
    title: id,
    body: id,
  });
  const server = createApp({
    verify: async () => ({ tenantId: actor, objectId: actor }),
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access,
    assistant: new AssistantService(access, undefined, undefined),
    learning: {
      read: async () => ({ plans: [], canManage: true }),
      change: async () => assert.fail('Learning should never write in this test.'),
    },
    workflows: {
      options: async () => ({
        canRequest: true,
        canIncident: true,
        categories: [],
        recipients: [],
      }),
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
      detail: async () => assert.fail('Workflow detail should not be called.'),
      notifications: async () => [notification('workflow', '/requests')],
      change: async () => assert.fail('Workflow should never write in this test.'),
    },
    recommendations: {
      read: async () => [],
      options: async () => [],
      send: async () => assert.fail('Learning recommendation should not be sent.'),
      respond: async () => assert.fail('Learning recommendation should not be changed.'),
      notifications: async () => [notification('learning', '/learning')],
    },
    certificationRecommendations: {
      read: async () => [],
      people: async () => [],
      send: async () => assert.fail('Certification recommendation should not be sent.'),
      respond: async () => assert.fail('Certification recommendation should not be changed.'),
      analytics: async () => ({}),
      notifications: async () => [notification('certificate', '/my-skills')],
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const get = (path: string) =>
    fetch(root + path, { headers: { Authorization: 'Bearer trusted' } });
  for (const [learningEnabled, requestsEnabled] of [
    [true, false],
    [false, true],
    [undefined, undefined],
  ]) {
    viewer.business = { ...viewer.business!, learningEnabled, requestsEnabled };
    const [workspace, learning, requests, assistant, notifications, effective, certificates] =
      await Promise.all(
        [
          '/workspace',
          '/learning',
          '/workflows/options',
          '/assistant/navigation',
          '/notifications',
          '/effective-access',
          '/certification-recommendations',
        ].map(get),
      );
    assert.equal(learning.status, learningEnabled ? 200 : 403);
    assert.equal(requests.status, requestsEnabled ? 200 : 403);
    assert.equal(workspace.status, 200);
    const { capabilities } = await workspace.json();
    assert.equal(capabilities.learning, !!learningEnabled);
    assert.equal(capabilities.requests, !!requestsEnabled);
    assert.equal(effective.status, 200);
    assert.equal(certificates.status, 200);
    const { decisions } = await effective.json();
    for (const [action, enabled] of [
      ['learning.view', learningEnabled],
      ['learning.manage', learningEnabled],
      ['request.view', requestsEnabled],
      ['incident.create', requestsEnabled],
    ]) {
      const decision = decisions.find((entry: { action: string }) => entry.action === action);
      assert.equal(decision.allowed, !!enabled, String(action));
      if (!enabled) assert.equal(decision.reasonCode, 'UNAVAILABLE');
    }
    assert.equal(assistant.status, 200);
    const navigation = await assistant.json();
    assert.equal(navigation.canManageLearning, !!learningEnabled);
    assert.equal(navigation.canDraftRequest, !!requestsEnabled);
    assert.equal(navigation.canDraftIncident, !!requestsEnabled);
    assert.equal(notifications.status, 200);
    const { items } = await notifications.json();
    assert.deepEqual(items.map((item: { id: string }) => item.id).sort(), [
      'certificate',
      ...(learningEnabled ? ['learning'] : []),
      ...(requestsEnabled ? ['workflow'] : []),
    ]);
  }
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
test('executive report fetch enforces fresh export access and excludes private row data', async t => {
  const s = state();
  let current = context(),
    revokeDuringRead = false,
    exporting: boolean | undefined;
  const business = {
    context: async () => structuredClone(current),
    dashboard: async (_actor: string, _query: unknown, exportMode: boolean) => {
      exporting = exportMode;
      const value = dashboard();
      value.context = structuredClone(current);
      if (revokeDuringRead) current = { ...current, canExport: false };
      return value;
    },
  } as unknown as BusinessStore;
  const server = createApp({
    verify: async () => ({ tenantId: actor, objectId: actor }),
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access: { snapshot: () => structuredClone(s), person: () => s.people[0], save: async () => s },
    business,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/business/report?dataset=people`;
  const headers = { Authorization: 'Bearer trusted' };
  const allowed = await fetch(url, { headers });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await allowed.json()).rows, []);
  assert.equal(exporting, true);
  revokeDuringRead = true;
  assert.equal((await fetch(url, { headers })).status, 403);
  revokeDuringRead = false;
  assert.equal((await fetch(url, { headers })).status, 403);
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

test('large complete Analytics CSV streams bytes and still rejects export revocation before delivery', async t => {
  const s = state();
  let current = context(),
    revoke = false;
  const data = dashboard();
  data.rows = Array.from({ length: 50000 }, (_, i) => ({
    employee: `Synthetic ${i}`,
    employeeCode: `QA-${i}`,
    skill: 'SQL',
    description: 'x'.repeat(200),
  }));
  data.total = data.rows.length;
  const business = {
    context: async () => structuredClone(current),
    dashboard: async () => {
      const value = { ...data, context: structuredClone(current) };
      if (revoke) current = { ...current, canExport: false };
      return value;
    },
  } as unknown as BusinessStore;
  const server = createApp({
    verify: async () => ({ tenantId: actor, objectId: actor }),
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access: { snapshot: () => structuredClone(s), person: () => s.people[0], save: async () => s },
    business,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/business/export?dataset=skills&format=csv`;
  const headers = { Authorization: 'Bearer trusted' };
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('transfer-encoding'), 'chunked');
  const csv = Buffer.from(await response.arrayBuffer());
  assert.ok(csv.length > 4.5 * 1024 * 1024);
  assert.ok(csv.equals(Buffer.from(businessCsv(data, businessQuery({ dataset: 'skills' })))));
  revoke = true;
  assert.equal((await fetch(url, { headers })).status, 403);
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
    criteria: ['1', '2', '3', '4'],
  });
  assert.equal((command.payload.definition as { levels: unknown[] }).levels.length, 4);
});
test('HTTP scoped files bind authenticated actor, conceal Blob keys and reject forced records', async t => {
  const s = state();
  const item = {
    id: person,
    blobName: 'private-storage-key',
    bytes: 3,
    mimeType: 'application/pdf',
    fileName: 'credential.pdf',
  };
  const business = {
    context: async () => context(),
    recordFiles: async (caller: string, kind: string, id: string) => {
      assert.equal(caller, actor);
      assert.equal(kind, 'certifications');
      if (id !== scope) throw new AccessError(403, 'Outside scope');
      return { revision: 1, workspaceRevision: 1, references: '', items: [item] };
    },
    file: async (caller: string, kind: string, id: string, fileId: string) => {
      assert.equal(caller, actor);
      assert.equal(kind, 'certifications');
      if (id !== scope || fileId !== person) throw new AccessError(403, 'Outside scope');
      return { item, data: Buffer.from('pdf') };
    },
  } as unknown as BusinessStore;
  const server = createApp({
    verify: async h => {
      if (h !== 'Bearer trusted') throw Error();
      return { tenantId: actor, objectId: actor };
    },
    resolveAccess: async () => actor,
    profile: async () => undefined,
    access: { snapshot: () => structuredClone(s), person: () => s.people[0], save: async () => s },
    business,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/business/records/certifications/`,
    headers = { Authorization: 'Bearer trusted' };
  assert.equal((await fetch(root + scope + '/files')).status, 401);
  const metadata = await fetch(root + scope + '/files?actorId=' + person, { headers });
  assert.equal(metadata.headers.get('cache-control'), 'no-store');
  const publicData = await metadata.json();
  assert.equal(publicData.items[0].blobName, undefined);
  assert.equal(publicData.items[0].fileName, 'credential.pdf');
  assert.equal((await fetch(root + person + '/files', { headers })).status, 403);
  const file = await fetch(root + scope + '/files/' + person, { headers });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-disposition')!, /attachment/);
  assert.equal(await file.text(), 'pdf');
  assert.equal((await fetch(root + person + '/files/' + person, { headers })).status, 403);
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
    workflow: async (_actor, operation) =>
      operation === 'AMENDMENT' ? { targetChanged: true, status: 'SUBMITTED' } : {},
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
  const proposal = {
    operation: 'PROPOSE',
    payload: {
      id: scope,
      revision: 1,
      type: 'PROVIDER',
      name: 'QA provider',
      reason: 'Regression fixture',
      active: true,
    },
  };
  const proposedPreviewResponse = await fetch(root + '/workflow/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify(proposal),
  });
  assert.equal(proposedPreviewResponse.status, 200);
  const proposedPreview = await proposedPreviewResponse.json();
  assert.deepEqual(proposedPreview.command, proposal);
  assert.equal(
    (
      await fetch(root + '/workflow', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...proposedPreview.command,
          previewReceipt: proposedPreview.receipt,
        }),
      })
    ).status,
    200,
    'The exact preview response must be confirmable without accepting SQL-only caller fields.',
  );
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
  current = { ...current, canApprove: true };
  const direct = {
    operation: 'SAVE_MASTER',
    payload: {
      id: scope,
      revision: 1,
      type: 'CERTIFICATION',
      name: 'QA credential',
      category: 'QA',
      providerName: 'QA issuer',
      relatedSkillIds: [],
    },
  };
  const directPreviewResponse = await fetch(root + '/workflow/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify(direct),
  });
  assert.equal(directPreviewResponse.status, 200);
  const directPreview = await directPreviewResponse.json();
  assert.equal(directPreview.details.definition.providerName, 'QA issuer');
  current = { ...current, canApprove: false };
  assert.equal(
    (
      await fetch(root + '/workflow', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...direct, previewReceipt: directPreview.receipt }),
      })
    ).status,
    403,
  );
  current = { ...current, canApprove: true };
  assert.equal(
    (
      await fetch(root + '/workflow', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...direct, previewReceipt: directPreview.receipt }),
      })
    ).status,
    200,
  );

  for (const [operation, status] of [
    ['APPROVE_AMENDMENT', 409],
    ['REJECT_AMENDMENT', 200],
  ] as const) {
    assert.equal(
      (
        await fetch(root + '/workflow/preview', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            operation,
            payload: { id: scope, revision: 1, note: 'Catalogue changed; submit a fresh request.' },
          }),
        })
      ).status,
      status,
    );
  }
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
    const reply = new AssistantService(access, undefined, {
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
                summary: 'Proposal for approval',
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
    if (kind === 'demand_draft') {
      await assert.rejects(reply, { status: 403 });
      continue;
    }
    const result = await reply;
    assert.equal(result.artifact?.kind, kind);
    assert.equal(result.mode, 'read-only');
  }
});

test('business AI keeps analytics totals within context and aborts when the authorized revision changes', async () => {
  for (const mode of ['reuse', 'revision change', 'aggregate fallback', 'filtered page']) {
    const s = state();
    const access: AccessStore = {
      snapshot: () => structuredClone(s),
      person: () => s.people[0],
      save: async () => s,
    };
    let rounds = 0;
    let reads = 0;
    const coverage = Array.from({ length: 140 }, (_, index) => ({
      id: String(index),
      label: 'Skill '.repeat(mode === 'aggregate fallback' ? 4000 : 35) + index,
      holders: 1,
      rank: 2,
    }));
    const business: BusinessStore = {
      context: async () => context(),
      dashboard: async (_actor, query) => {
        reads++;
        if (mode === 'filtered page') {
          assert.equal(query.scopeId, scope);
          assert.equal(query.hierarchyId, person);
          assert.equal(query.dataset, 'certifications');
          assert.equal(query.issuer, 'Oracle');
          assert.equal(query.validity, 'EXPIRED');
          assert.equal(query.status, 'APPROVED');
          assert.equal(query.search, 'Aditi');
          assert.equal(query.from, '2026-10-01');
          assert.equal(query.to, '2026-11-01');
        }
        const result = dashboard();
        return {
          ...result,
          coverage,
          coverageComplete: true,
          context: {
            ...result.context,
            hierarchy: Array.from({ length: 170 }, (_, index) => ({
              id: index === 0 ? person : String(index),
              kind: 'PROJECT',
              name: 'Placement '.repeat(14) + index,
              parentId: null,
            })),
          },
        };
      },
      administration: async () => ({}),
      change: async () => {},
      workflow: async () => ({}),
    };
    const service = new AssistantService(
      access,
      undefined,
      {
        name: 'synthetic',
        complete: async (messages, tools) => {
          rounds++;
          if (mode === 'filtered page') {
            assert.equal(tools.length, 0);
            const facts = messages[0].content
              .split('Analytics data: ')[1]
              .split('\nEffective capability')[0];
            const result = JSON.parse(facts);
            assert.equal(result.total, dashboard().total);
            assert.equal(result.scopeLabel, 'Project A');
            assert.equal(result.filters.issuer, 'Oracle');
            return { content: 'Here are the authorized filtered totals.', calls: [] };
          }
          if (rounds > 1) {
            const result = JSON.parse(messages.find(message => message.role === 'tool')!.content);
            assert.equal(result.scopeLabel, 'Project A');
            assert.equal(result.asOf, context().asOf);
            assert.deepEqual(result.summary, dashboard().summary);
            if (mode === 'aggregate fallback') {
              assert.equal(result.coverage, undefined);
              assert.match(result.limits[0], /Aggregate totals only/);
              return { content: 'Here are the current authorized totals.', calls: [] };
            }
            assert.equal(result.coverageComplete, false);
            assert.deepEqual(result.coverage[0], coverage[0]);
            assert.equal(result.coverage.length + result.contextOmitted.coverage, coverage.length);
            assert.ok(result.contextOmitted.authorizedHierarchy > 0);
          }
          if (rounds === 2 && mode === 'revision change') s.revision++;
          if (rounds > 2) return { content: 'Here is the current business summary.', calls: [] };
          return {
            content: '',
            calls: [
              {
                id: 'lookup-' + rounds,
                type: 'function',
                function: {
                  name: 'business_insights',
                  arguments: JSON.stringify({ scopeId: scope }),
                },
              },
            ],
          };
        },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      business,
    );
    const reply = service.chat(
      actor,
      mode === 'filtered page'
        ? {
            message: 'Summarize the records matching my current Analytics filters.',
            currentPage: '/business?view=records',
            analyticsFilters: {
              scopeId: scope,
              hierarchyId: person,
              dataset: 'certifications',
              issuer: 'Oracle',
              validity: 'EXPIRED',
              status: 'APPROVED',
              search: 'Aditi',
              from: '2026-10-01',
              to: '2026-11-01',
            },
          }
        : { messages: [{ role: 'user', content: 'Summarize business analytics' }] },
    );
    if (mode === 'revision change') await assert.rejects(reply, { status: 403 });
    else await reply;
    assert.equal(reads, 1);
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

test('credential follow-up tools return scoped records and unambiguous responsibility IDs with fresh access checks', async () => {
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
      assert.equal(query.dataset, 'certifications');
      assert.equal(query.status, 'APPROVED');
      assert.equal(query.validity, 'EXPIRED');
      assert.equal(query.scopeId, scope);
      reads++;
      const result = dashboard();
      result.context.scopes[0].scopeId = person; // resource UUID differs from responsibility UUID
      result.rows = [
        {
          id: person,
          name: 'Azure Fundamentals',
          issuer: 'Microsoft',
          status: 'APPROVED',
          validity: 'EXPIRED',
        },
      ];
      return result;
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
  assert.ok(
    registry
      .available(s, s.people[0])
      .some(tool => tool.function.name === 'business_certifications'),
  );
  await assert.rejects(
    registry.execute(actor, 'business_certifications', { personId: person }, signal),
  );
  assert.equal(reads, 0);
  const result = (
    await registry.execute(
      actor,
      'business_certifications',
      { scopeId: scope, status: 'APPROVED', validity: 'EXPIRED' },
      signal,
    )
  ).data as any;
  assert.equal(result.rows[0].name, 'Azure Fundamentals');
  assert.deepEqual(result.authorizedScopes, [{ id: scope, kind: 'PROJECT', label: 'Project A' }]);
  assert.equal(result.coverage, undefined);
  assert.equal(result.hasMore, false);
  s.people[0].business!.view = false;
  await assert.rejects(
    registry.execute(actor, 'business_certifications', {}, signal),
    /permission/,
  );
  assert.equal(reads, 1, 'Revocation must stop the next record read');
});

test('skill amendment criteria are common and certification associations remain optional, bounded and skill-specific', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const command = {
    id,
    revision: 1,
    type: 'SKILL',
    name: 'SQL',
    category: 'Data',
    description: 'Query data',
    criteria: ['One', 'Two', 'Three', 'Four'],
    reason: 'Catalogue improvement',
  };
  const definition = businessWorkflow('PROPOSE', { ...command, relatedCertificationIds: [id] })
    .payload.definition as any;
  assert.equal(
    definition.levels[0].description,
    'Understands fundamentals and completes routine work with guidance.',
  );
  assert.deepEqual(definition.relatedCertificationIds, [id]);
  assert.equal(
    'relatedCertificationIds' in (businessWorkflow('PROPOSE', command).payload.definition as any),
    false,
  );
  for (const relatedCertificationIds of [
    null,
    'invalid',
    ['invalid'],
    [id, id],
    Array(21).fill(id),
  ])
    assert.throws(() => businessWorkflow('PROPOSE', { ...command, relatedCertificationIds }));
  assert.throws(() =>
    businessWorkflow('PROPOSE', { ...command, type: 'PROVIDER', relatedCertificationIds: [] }),
  );
});

test('direct catalogue commands support an inline issuer but never guess, mix or forward unsupported fields', () => {
  const base = {
    id: scope,
    revision: 1,
    type: 'CERTIFICATION',
    name: 'QA certification',
    category: 'QA',
    providerName: ' Oracle ',
    relatedSkillIds: [],
  };
  const definition = businessWorkflow('SAVE_MASTER', base).payload.definition as Record<
    string,
    unknown
  >;
  assert.equal(definition.providerName, 'Oracle');
  assert.equal(definition.description, '');
  assert.throws(() => businessWorkflow('SAVE_MASTER', { ...base, providerId: person }));
  assert.throws(() => businessWorkflow('SAVE_MASTER', { ...base, providerName: '' }));
  assert.throws(() => businessWorkflow('SAVE_MASTER', { ...base, type: 'SKILL' }));
  assert.throws(() => businessWorkflow('PROPOSE', base));
  assert.throws(() => businessWorkflow('SAVE_MASTER', { ...base, actorId: actor }));
  const { providerName: _unused, ...existing } = base;
  assert.equal(
    (businessWorkflow('SAVE_MASTER', { ...existing, providerId: person }).payload.definition as any)
      .providerId,
    person,
  );
});
