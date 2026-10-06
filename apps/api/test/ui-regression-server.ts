// Explicit local-only browser regression fixture. Uses synthetic data, no database/model.
// Build web, then run: node --import tsx apps/api/test/ui-regression-server.ts
import express from 'express';
import { fileURLToPath } from 'node:url';
const app = express();
app.use(express.json());
let workspaceFailure = false;
app.post('/qa/workspace-failure', (req, res) => {
  workspaceFailure = Boolean(req.body.enabled);
  res.json({ enabled: workspaceFailure });
});
app.use('/api/workspace', (_req, res, next) => {
  if (workspaceFailure) {
    res.sendStatus(503);
    return;
  }
  next();
});
const actor = '00000000-0000-4000-8000-000000000001';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
app.get('/api/dev-login', (_req, res) =>
  res.json({ mode: 'local-demo', signedIn: true, people: [] }),
);
app.get('/api/workspace', (_req, res) =>
  res.json({
    person: { id: actor, displayName: 'Regression Fixture', employeeCode: 'QA-LOCAL', roles: [] },
    authentication: 'local-demo',
    capabilities: {
      ownProfile: true,
      ownSkills: true,
      claimSkills: true,
      catalogue: true,
      administration: false,
      learning: true,
      requests: true,
    },
    upcoming: [],
  }),
);
app.get('/api/notifications', (_req, res) =>
  res.json({
    personId: actor,
    partial: true,
    failedSources: ['reviews'],
    items: [
      {
        id: 'qa-note',
        at: '2026-10-05T10:00:00Z',
        title: 'Local regression notification',
        body: 'This source remains available.',
        href: '/profile',
      },
    ],
  }),
);
app.get('/api/dashboard', (_req, res) =>
  res.json({
    revision: 1,
    actorId: actor,
    ai: true,
    actions: [],
    cards: [
      {
        id: 'learning',
        title: 'Today’s learning',
        description: 'Synthetic regression data',
        endpoint: '/api/dashboard/learning',
        scope: { kind: 'OWN', actorId: actor },
      },
    ],
  }),
);
app.get('/api/dashboard/learning', async (_req, res) => {
  await delay(1500);
  res.json({
    total: 0,
    activePlans: 0,
    completed: 0,
    progress: 0,
    overdue: 0,
    today: 0,
    loggedMinutes: 0,
    nextTask: null,
    canManage: true,
  });
});
app.get('/api/learning', (_req, res) => res.json({ plans: [], canManage: true }));
app.get('/api/recommendations', (_req, res) =>
  res.json({ items: [], total: 0, page: 1, pageSize: 20 }),
);
app.get('/api/skills', (req, res) => {
  const search = String(req.query.search ?? ''),
    page = Number(req.query.page ?? 1);
  console.log('Skill query:', JSON.stringify({ search, page }));
  const rows = Array.from({ length: 503 }, (_, i) => ({
    id: String(i + 1),
    name:
      i === 502 ? 'Rare skill beyond old page limit' : 'Skill ' + String(i + 1).padStart(3, '0'),
  })).filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  res.json({ skills: rows.slice((page - 1) * 20, page * 20), total: rows.length, pageSize: 20 });
});
app.get('/api/assistant/navigation', (_req, res) =>
  res.json({
    status: { configured: true, provider: 'regression-stub', mode: 'read-only' },
    pages: [],
    canReviewOwnSkill: false,
    suggestions: [],
  }),
);
app.get('/api/assistant/conversations', (_req, res) =>
  res.json({
    conversations: [
      {
        id: 'old-chat',
        title: 'Old saved fixture conversation',
        updatedAt: '2026-10-05T10:00:00Z',
      },
    ],
  }),
);
app.get('/api/assistant/conversations/old-chat', async (_req, res) => {
  await delay(2500);
  res.json({ messages: [{ role: 'assistant', content: 'STALE HISTORY MUST NOT REAPPEAR' }] });
});
const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => res.sendFile(dist + 'index.html'));
app.listen(5181, '127.0.0.1', () =>
  console.log('Local synthetic regression UI: http://127.0.0.1:5181/workspace'),
);
