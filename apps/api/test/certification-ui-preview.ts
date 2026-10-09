// Loopback-only synthetic UI fixture. No SQL, model, real identities or durable data.
// Build web first, then: node --import tsx apps/api/test/certification-ui-preview.ts
import express from 'express';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
      reviewSkills: false,
    },
    authentication: 'local-demo',
    upcoming: [],
  }),
);
app.get('/api/notifications', (_req, res) => res.json({ personId: actor, items: [] }));
app.get('/api/assistant/navigation', (_req, res) =>
  res.json({ status: { configured: false, mode: 'read-only' }, pages: [], suggestions: [] }),
);
app.get('/api/certifications', (req, res) => {
  const query = String(req.query.search ?? '').toLowerCase();
  res.json({
    records:
      req.query.view === 'queue'
        ? []
        : records.filter(r => (r.certificationName + r.provider).toLowerCase().includes(query)),
    total: records.length,
    page: 1,
    pageSize: 25,
    canManage: true,
    canSubmitNew: true,
    canReview: false,
  });
});
app.post('/api/certifications', (req, res) => {
  if (req.body.fields?.certificationName === 'Fail preview') {
    res
      .status(503)
      .json({ error: { message: 'Synthetic save failure. Your entries are still here.' } });
    return;
  }
  res.json({ saved: true });
});
app.use(express.static(fileURLToPath(new URL('../../web/dist/', import.meta.url))));
app.get('/{*path}', (_req, res) =>
  res.sendFile(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url))),
);
app.listen(5185, '127.0.0.1', () =>
  console.log('Synthetic certification preview: http://127.0.0.1:5185/certifications'),
);
