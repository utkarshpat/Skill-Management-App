// Loopback-only synthetic UI fixture. No SQL, model, real identities or durable data.
// Build web first, then: node --import tsx apps/api/test/certification-ui-preview.ts
import express from 'express';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { prepareCertificateFile } from '../src/modules/skills/evidence.js';
const app = express();
app.use(express.json());
const actor = randomUUID();
const fields = {
  certificationName: 'Azure Fundamentals',
  provider: 'Microsoft',
  category: 'Cloud',
  certificationDate: '2026-01-01',
  expiryDate: '2026-09-01',
  credentialId: 'PREVIEW-ONLY',
  credentialUrl: 'https://example.com/badge',
  notes: 'Synthetic preview credential.',
};
const records = [
  {
    ...fields,
    id: randomUUID(),
    personId: actor,
    reviewerId: randomUUID(),
    revision: 1,
    name: 'Preview Employee',
    employeeCode: 'PREVIEW',
    status: 'APPROVED',
    canEdit: false,
    canSubmit: false,
    canReview: false,
    feedback: 'Reviewed the issuer transcript. Expiry remains unchanged.',
    reviewedBy: 'Preview Manager',
    reviewedAt: '2026-09-01T00:00:00Z',
  },
  {
    ...fields,
    certificationName: 'AWS Cloud Practitioner',
    provider: 'Amazon Web Services',
    expiryDate: null,
    id: randomUUID(),
    personId: actor,
    revision: 1,
    name: 'Preview Employee',
    employeeCode: 'PREVIEW',
    status: 'DRAFT',
    canEdit: true,
    canSubmit: true,
    canReview: false,
    feedback: '',
  },
];
app.get('/api/dev-login', (_req, res) =>
  res.json({ mode: 'local-demo', signedIn: true, people: [] }),
);
app.get('/api/workspace', (_req, res) =>
  res.json({
    person: { id: actor, displayName: 'Preview Employee', employeeCode: 'PREVIEW', roles: [] },
    capabilities: {
      ownProfile: true,
      ownSkills: true,
      certifications: true,
      administration: false,
      learning: false,
      requests: false,
      catalogue: false,
      reviewSkills: true,
    },
    authentication: 'local-demo',
    upcoming: [],
  }),
);
app.get('/api/notifications', (_req, res) => res.json({ personId: actor, items: [] }));
app.get('/api/assistant/navigation', (_req, res) =>
  res.json({ status: { configured: false, mode: 'read-only' }, pages: [], suggestions: [] }),
);
const pendingCredential = {
  ...records[0],
  id: randomUUID(),
  name: 'Preview Direct Report',
  status: 'SUBMITTED',
  submittedAt: '2026-10-09T06:00:00Z',
  feedback: '',
  canReview: true,
};
const pendingSkill = {
  id: randomUUID(),
  personId: randomUUID(),
  personName: 'Preview Direct Report',
  revision: 1,
  skillId: randomUUID(),
  skillName: 'Cloud architecture',
  category: 'Cloud',
  definitionRevision: 1,
  rank: 3,
  levelName: 'Practitioner',
  experienceMonths: 24,
  description: 'Synthetic review only',
  status: 'SUBMITTED',
  updatedAt: '2026-10-09T05:00:00Z',
  reviewAccess: {
    allowed: true,
    reasonCode: 'REPORTING_POLICY',
    summaryOnly: false,
    resource: { type: 'SKILL_CLAIM', id: 'preview', revision: 1 },
    resolvedScope: { kind: 'DIRECT_REPORTS', actorId: actor },
    constraints: ['CURRENT_DIRECT_MANAGER', 'ASSIGNED_REVIEWER'],
    sources: [
      {
        kind: 'REPORTING_POLICY',
        label: 'Current direct manager',
        effect: 'ALLOW',
        scope: 'DIRECT_REPORTS',
      },
    ],
  },
};
app.get('/api/skill-reviews', (req, res) => {
  const matches = (pendingSkill.skillName + pendingSkill.personName)
    .toLowerCase()
    .includes(String(req.query.search ?? '').toLowerCase());
  res.json({
    claims: matches && Number(req.query.page ?? 1) === 1 ? [pendingSkill] : [],
    total: matches ? 1 : 0,
    pageSize: 25,
    canReadHistory: true,
  });
});
app.get('/api/skill-reviews/:id', (_req, res) =>
  res.json({
    claim: pendingSkill,
    reviewAccess: pendingSkill.reviewAccess,
    history: [],
    total: 0,
    pageSize: 25,
  }),
);
app.get('/api/assistant', (_req, res) => res.json({ configured: false }));
app.get('/api/skill-reviews/:id/evidence', (_req, res) =>
  res.json({ revision: 1, canUpload: false, items: [] }),
);
app.post('/api/skill-reviews/decision', (_req, res) =>
  res
    .status(503)
    .json({ error: { message: 'Synthetic review failure. Your note is still here.' } }),
);
app.get('/api/certifications', (req, res) => {
  const query = String(req.query.search ?? '').toLowerCase();
  const matches = (req.query.view === 'queue' ? [pendingCredential] : records).filter(r =>
    (r.certificationName + r.provider + r.name).toLowerCase().includes(query),
  );
  res.json({
    records:
      Number(req.query.page ?? 1) === 1
        ? matches.map(r => ({
            ...r,
            hasImage: images.has(r.id),
            canSubmit: r.canSubmit && images.has(r.id),
          }))
        : [],
    total: matches.length,
    page: 1,
    pageSize: 25,
    canManage: true,
    canSubmitNew: true,
    canReview: true,
    canUploadImage: true,
  });
});
app.post('/api/certifications', (req, res) => {
  if (['SUBMIT', 'SAVE_SUBMIT'].includes(req.body.action) && !images.has(req.body.id)) {
    res.status(400).json({ error: { message: 'Attach a certificate file before submitting.' } });
    return;
  }
  if (req.body.fields?.certificationName === 'Fail preview') {
    res
      .status(503)
      .json({ error: { message: 'Synthetic save failure. Your entries are still here.' } });
    return;
  }
  let record = records.find(r => r.id === req.body.id);
  if (!record) {
    record = { ...records[1], ...req.body.fields, id: req.body.id, revision: 0 };
    records.push(record!);
  }
  Object.assign(record!, req.body.fields, {
    revision: Number(req.body.revision) + 1,
    status: req.body.action === 'SAVE_SUBMIT' ? 'SUBMITTED' : 'DRAFT',
  });
  res.json({ saved: true, revision: record!.revision });
});
const images = new Map<
  string,
  {
    id: string;
    data: Buffer;
    mimeType: string;
    fileName: string;
    width: number | null;
    height: number | null;
  }
>();
app.get('/api/certifications/:id/image', (req, res) => {
  const image = images.get(req.params.id),
    record = records.find(r => r.id === req.params.id);
  res.json({
    revision: record?.revision ?? 1,
    canUpload: true,
    items: image
      ? [
          {
            id: image.id,
            bytes: image.data.length,
            width: image.width,
            height: image.height,
            mimeType: image.mimeType,
            fileName: image.fileName,
          },
        ]
      : [],
  });
});
app.get('/api/certifications/:id/image/:image', (req, res) => {
  const image = images.get(req.params.id);
  if (!image || image.id !== req.params.image) {
    res.sendStatus(404);
    return;
  }
  res.type(image.mimeType).send(image.data);
});
app.post(
  '/api/certifications/:id/image',
  express.raw({ type: () => true, limit: 5 * 1024 * 1024 }),
  async (req, res) => {
    const record = records.find(r => r.id === req.params.id);
    if (!record) {
      res.sendStatus(404);
      return;
    }
    const file = await prepareCertificateFile(
      req.body,
      String(req.headers['content-type'] ?? '')
        .split(';')[0]
        .trim(),
      decodeURIComponent(String(req.headers['x-certificate-file-name'] ?? 'certificate')),
    );
    images.set(req.params.id, { id: randomUUID(), ...file });
    record.revision++;
    res.json({ revision: record.revision });
  },
);
app.delete('/api/certifications/:id/image', (req, res) => {
  images.delete(req.params.id);
  const record = records.find(r => r.id === req.params.id);
  if (record) record.revision++;
  res.json({ revision: record?.revision });
});
app.use(express.static(fileURLToPath(new URL('../../web/dist/', import.meta.url))));
app.get('/{*path}', (_req, res) =>
  res.sendFile(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))),
);
const previewPort = Number(process.env.PREVIEW_PORT ?? 5185);
app.listen(previewPort, '127.0.0.1', () =>
  console.log(`Synthetic certification preview: http://127.0.0.1:${previewPort}/certifications`),
);
