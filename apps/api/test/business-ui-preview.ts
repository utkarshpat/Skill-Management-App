// Synthetic loopback acceptance fixture. No SQL, model, real identity or durable writes.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { businessQuery, type BusinessDashboard } from '../src/modules/business/business.js';
import { businessCsv, businessXlsx } from '../src/modules/business/export.js';
const app = express();
app.use(express.json());
const actor = randomUUID(),
  scopeA = randomUUID(),
  scopeB = randomUUID(),
  provider = randomUUID(),
  skill = randomUUID(),
  credential = randomUUID();
const context = {
  actorId: actor,
  revision: 1,
  asOf: new Date().toISOString(),
  canView: true,
  canManage: true,
  canExport: true,
  canAmend: true,
  canDemandView: true,
  canDemandCreate: true,
  canMatch: true,
  canShortlist: true,
  canApprove: true,
  personalBaseline: true,
  scopes: [
    {
      id: scopeA,
      scopeId: scopeA,
      label: 'Digital health',
      kind: 'PROJECT',
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
    {
      id: scopeB,
      scopeId: scopeB,
      label: 'Cloud delivery',
      kind: 'DEPARTMENT',
      effect: 'ALLOW',
      bundle: 'BUSINESS_OPERATIONS',
    },
  ],
};
app.get('/api/dev-login', (_req, res) =>
  res.json({ mode: 'local-demo', signedIn: true, people: [] }),
);
app.get('/api/workspace', (_req, res) =>
  res.json({
    person: { id: actor, displayName: 'Preview Lead', employeeCode: 'PREVIEW', roles: [] },
    businessPolicyRevision: 1,
    capabilities: {
      ownProfile: true,
      ownSkills: true,
      certifications: true,
      administration: false,
      learning: false,
      requests: false,
      catalogue: false,
      reviewSkills: false,
      businessOperations: true,
      businessAdministration: true,
      amendments: true,
    },
    authentication: 'local-demo',
    upcoming: [],
  }),
);
app.get('/api/notifications', (_req, res) => res.json({ personId: actor, items: [] }));
app.get('/api/assistant/navigation', (_req, res) =>
  res.json({ status: { configured: false, mode: 'read-only' }, pages: [], suggestions: [] }),
);
app.get('/api/business/context', (_req, res) => res.json(context));
const rows = [
  {
    id: randomUUID(),
    employee: 'Preview Alice',
    employeeCode: 'PREVIEW-A',
    name: 'Azure Fundamentals',
    issuer: 'Microsoft',
    category: 'Cloud',
    status: 'APPROVED',
    validity: 'EXPIRED',
    issued: '2026-01-01',
    expiry: '2026-10-08',
  },
  {
    id: randomUUID(),
    employee: 'Preview Bob',
    employeeCode: 'PREVIEW-B',
    name: 'AWS Cloud Practitioner',
    issuer: 'Amazon Web Services',
    category: 'Cloud',
    status: 'APPROVED',
    validity: 'CURRENT',
    issued: '2026-04-10',
    expiry: '2026-10-20',
  },
];
function dashboard(query: Record<string, unknown>): BusinessDashboard {
  const filtered = rows.filter(
    r =>
      (!query.validity || r.validity === query.validity) &&
      (!query.issuer || r.issuer === query.issuer) &&
      (!query.search ||
        (r.employee + ' ' + r.employeeCode)
          .toLowerCase()
          .includes(String(query.search).toLowerCase())),
  );
  return {
    context,
    summary: { employees: 24, certified: 15, skilled: 21, pending: 6, expired: 3, expiring: 4 },
    coverage: [1, 2, 3, 4, 5].flatMap(rank => [
      { id: skill, label: 'Cloud architecture', rank, holders: rank + 1 },
      { id: randomUUID(), label: 'API design', rank, holders: 6 - rank },
    ]),
    distribution: [
      { label: 'Microsoft', value: 9 },
      { label: 'Amazon Web Services', value: 7 },
      { label: 'Oracle', value: 3 },
    ],
    categories: [
      { label: 'Cloud', value: 16 },
      { label: 'Data / AI / ML', value: 3 },
    ],
    comparisons: [
      {
        id: scopeA,
        label: 'Digital health',
        kind: 'PROJECT',
        employees: 14,
        certified: 9,
        skilled: 12,
      },
      {
        id: scopeB,
        label: 'Cloud delivery',
        kind: 'DEPARTMENT',
        employees: 16,
        certified: 10,
        skilled: 15,
      },
    ],
    expiry: [
      { label: 'Expired', value: 3 },
      { label: '14 days', value: 2 },
      { label: '30 days', value: 2 },
      { label: '60 days', value: 3 },
      { label: 'No expiry', value: 9 },
    ],
    activity: [
      { label: '2026-07', submissions: 4, decisions: 3 },
      { label: '2026-08', submissions: 9, decisions: 7 },
      { label: '2026-09', submissions: 12, decisions: 10 },
      { label: '2026-10', submissions: 8, decisions: 5 },
    ],
    rows:
      query.dataset === 'people'
        ? filtered.map(r => ({
            id: r.id,
            employee: r.employee,
            employeeCode: r.employeeCode,
            reviewedSkills: 3,
            currentCertifications: r.validity === 'CURRENT' ? 1 : 0,
          }))
        : filtered,
    total: filtered.length,
    page: 1,
    pageSize: 25,
  };
}
app.get('/api/business/dashboard', async (req, res) => {
  await new Promise(resolve => setTimeout(resolve, 300));
  res.json(dashboard(req.query));
});
app.get('/api/business/export', (req, res) => {
  const { format, ...filters } = req.query;
  const q = businessQuery(filters),
    d = dashboard(q as unknown as Record<string, unknown>);
  res.setHeader('Content-Disposition', 'attachment; filename="preview.' + format + '"');
  res
    .type(
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
    )
    .send(format === 'xlsx' ? Buffer.from(businessXlsx(d, q)) : businessCsv(d, q));
});
const masters = {
  revision: 1,
  page: 1,
  pageSize: 25,
  providerTotal: 1,
  skillTotal: 1,
  certificationTotal: 1,
  providers: [{ id: provider, name: 'Microsoft', active: true }],
  skills: [
    {
      id: skill,
      name: 'Cloud architecture',
      category: 'Cloud',
      description: 'Architecture of resilient cloud services',
      active: true,
      levels: [1, 2, 3, 4, 5].map(rank => ({
        rank,
        description: 'Existing approved level ' + rank + ' criteria',
      })),
    },
  ],
  certifications: [
    {
      id: credential,
      name: 'Azure Fundamentals',
      providerId: provider,
      provider: 'Microsoft',
      category: 'Cloud',
      description: 'Canonical credential definition',
      active: true,
    },
  ],
};
const demand = randomUUID();
app.get('/api/business/workflow/masters', (_req, res) => res.json(masters));
app.get('/api/business/workflow/amendments', (_req, res) =>
  res.json({ revision: 1, canApprove: true, rows: [], total: 0, page: 1, pageSize: 25 }),
);
app.get('/api/business/workflow/demands', (_req, res) =>
  res.json({
    revision: 1,
    rows: [
      {
        id: demand,
        title: 'Cloud delivery',
        description: 'Explicit reviewed cloud criteria',
        revision: 1,
        scopeKind: 'PROJECT',
        requirements: { skills: [{ id: skill, minRank: 3 }], certifications: [credential] },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  }),
);
app.get('/api/business/workflow/matches', (_req, res) =>
  res.json({
    id: demand,
    revision: 1,
    asOf: context.asOf,
    required: 2,
    total: 2,
    page: 1,
    pageSize: 25,
    rows: rows.map((r, i) => ({
      id: r.id,
      employee: r.employee,
      employeeCode: r.employeeCode,
      matched: i ? 2 : 1,
      eligible: !!i,
      shortlisted: false,
      criteria: [
        {
          type: 'SKILL',
          id: skill,
          name: 'Cloud architecture',
          matched: true,
          criterion: 'Reviewed proficiency L3 or above',
        },
        {
          type: 'CERTIFICATION',
          id: credential,
          name: 'Azure Fundamentals',
          matched: !!i,
          criterion: 'Current manager-reviewed credential; expired credentials excluded',
        },
      ],
    })),
  }),
);
app.post('/api/business/workflow/preview', (req, res) =>
  res.json({ receipt: 'synthetic', command: req.body, details: req.body.payload, revision: 1 }),
);
app.post('/api/business/workflow', (_req, res) => res.json({ saved: true }));
app.get('/api/business/administration', (_req, res) =>
  res.json({
    revision: 1,
    personalBaseline: true,
    baselineAffectedPeople: 24,
    people: [{ id: actor, name: 'Preview Lead', employeeCode: 'PREVIEW', active: true }],
    nodes: [],
    projects: [{ id: scopeA, name: 'Digital health', departmentId: null, active: true }],
    memberships: [{ personId: actor, projectId: scopeA, active: true }],
    responsibilities: [
      {
        id: randomUUID(),
        personId: actor,
        bundle: 'BUSINESS_OPERATIONS',
        kind: 'PROJECT',
        scopeId: scopeA,
        effect: 'ALLOW',
        active: true,
        validUntil: null,
        reason: 'Synthetic preview',
      },
    ],
    historicalGrantsForReview: [],
  }),
);
app.post('/api/business/administration/preview', (req, res) =>
  res.json({
    receipt: 'synthetic',
    change: req.body,
    before: null,
    after: req.body.payload,
    impact: { actions: ['Scoped analytics', 'Human reviewed amendments'] },
    warnings: ['Preview fixture only'],
  }),
);
app.post('/api/business/administration', (_req, res) => res.json({ saved: true }));
app.use(express.static(fileURLToPath(new URL('../../web/dist/', import.meta.url))));
app.get('/{*path}', (_req, res) =>
  res.sendFile(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))),
);
app.listen(5188, '127.0.0.1', () =>
  console.log('Synthetic Business Operations preview: http://127.0.0.1:5188/business'),
);
