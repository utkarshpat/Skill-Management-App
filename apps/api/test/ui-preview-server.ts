// Local-only visual preview fixture with rich synthetic data. No database/model.
// Build web, then run: node --import tsx apps/api/test/ui-preview-server.ts
import express from 'express';
import { fileURLToPath } from 'node:url';
const app = express();
app.use(express.json());
const actor = '00000000-0000-4000-8000-000000000002';
app.get('/api/dev-login', (_req, res) =>
  res.json({ mode: 'local-demo', signedIn: true, people: [] }),
);
app.get('/api/workspace', (_req, res) =>
  res.json({
    person: { id: actor, displayName: 'Preview Person', employeeCode: 'PV-100', roles: [] },
    authentication: 'local-demo',
    capabilities: {
      ownProfile: true,
      ownSkills: true,
      claimSkills: true,
      catalogue: false,
      administration: false,
      learning: true,
      requests: true,
      reviewSkills: false,
    },
    upcoming: [],
  }),
);
app.get('/api/notifications', (_req, res) =>
  res.json({
    personId: actor,
    items: [
      {
        id: 'pv-1',
        at: '2026-10-06T08:30:00Z',
        title: 'Skill claim approved',
        body: 'Your TypeScript claim was reviewed by your manager.',
        href: '/my-skills',
      },
      {
        id: 'pv-2',
        at: '2026-10-05T16:10:00Z',
        title: 'Request updated',
        body: 'Access to the analytics sandbox is in progress.',
        href: '/requests',
      },
      {
        id: 'pv-3',
        at: '2026-10-04T09:00:00Z',
        title: 'New recommendation',
        body: 'Your manager recommended a learning path for React.',
        href: '/learning',
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
        id: 'attention',
        title: 'Needs your attention',
        description: 'Assigned work and overdue learning',
        endpoint: '/api/dashboard/attention',
        priority: 1,
        size: 'wide',
        scope: { kind: 'OWN', actorId: actor },
      },
      {
        id: 'learning',
        title: 'Learning',
        description: 'Your plans and next task',
        endpoint: '/api/dashboard/learning',
        priority: 2,
        size: 'half',
        scope: { kind: 'OWN', actorId: actor },
      },
      {
        id: 'capability',
        title: 'Capability',
        description: 'Your skill claims and reviews',
        endpoint: '/api/dashboard/capability',
        priority: 3,
        size: 'half',
        scope: { kind: 'OWN', actorId: actor },
      },
      {
        id: 'requests',
        title: 'Requests & incidents',
        description: 'Status of what you raised',
        endpoint: '/api/dashboard/requests',
        priority: 4,
        size: 'half',
        scope: { kind: 'OWN', actorId: actor },
      },
    ],
  }),
);
app.get('/api/dashboard/attention', (_req, res) =>
  res.json({
    total: 3,
    groups: [
      {
        id: 'reviews',
        title: 'Reviews',
        description: 'Claims waiting on a decision',
        href: '/skill-reviews',
        label: 'Open reviews',
        tone: 'amber',
        count: 1,
      },
      {
        id: 'learning',
        title: 'Learning',
        description: 'Overdue learning tasks',
        href: '/learning?tab=backlog',
        label: 'Open learning',
        tone: 'red',
        count: 2,
      },
    ],
    items: [
      {
        id: 'a1',
        title: 'React hooks practice',
        description: 'Overdue by 2 days · Learning plan',
        href: '/learning',
        label: 'Open',
        priority: 100,
        urgency: 'Overdue',
      },
    ],
  }),
);
app.get('/api/dashboard/learning', (_req, res) =>
  res.json({
    total: 12,
    completed: 7,
    progress: 58,
    activePlans: 2,
    loggedMinutes: 345,
    overdue: 2,
    today: 1,
    canManage: true,
    nextTask: {
      id: 't1',
      planId: 'p1',
      title: 'Build a small hooks demo',
      planTitle: 'React deep dive',
      skillName: 'React',
      plannedDate: '2026-10-06',
      timezone: 'Asia/Kolkata',
      estimatedMinutes: 45,
      due: 'TODAY',
      daysOverdue: 0,
      planCompleted: 4,
      planTotal: 8,
      href: '/learning',
    },
  }),
);
app.get('/api/dashboard/capability', (_req, res) =>
  res.json({
    total: 14,
    verified: 9,
    pending: 2,
    draft: 3,
    changesRequested: 1,
    rejected: 0,
    canClaim: true,
    recentClaims: [
      {
        id: 'c1',
        skillName: 'TypeScript',
        category: 'Engineering',
        rank: 4,
        levelName: 'Advanced',
        status: 'APPROVED',
        updatedAt: '2026-10-03T10:00:00Z',
        href: '/my-skills?claim=c1',
      },
      {
        id: 'c2',
        skillName: 'Azure Functions',
        category: 'Cloud',
        rank: 2,
        levelName: 'Foundation',
        status: 'SUBMITTED',
        updatedAt: '2026-10-01T10:00:00Z',
        href: '/my-skills?claim=c2',
      },
    ],
    topSkills: [
      {
        id: 'c1',
        skillName: 'TypeScript',
        category: 'Engineering',
        rank: 4,
        levelName: 'Advanced',
        maxRank: 5,
      },
      {
        id: 'c3',
        skillName: 'React',
        category: 'Engineering',
        rank: 3,
        levelName: 'Practitioner',
        maxRank: 5,
      },
      { id: 'c4', skillName: 'SQL', category: 'Data', rank: 4, levelName: 'Advanced', maxRank: 5 },
      {
        id: 'c5',
        skillName: 'Azure',
        category: 'Cloud',
        rank: 2,
        levelName: 'Foundation',
        maxRank: 5,
      },
    ],
  }),
);
const records = [
  {
    id: 'r1',
    reference: 'REQ-1042',
    kind: 'REQUEST',
    title: 'Access to analytics sandbox',
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    recipientName: 'Platform Team',
    updatedAt: '2026-10-05T12:00:00Z',
  },
  {
    id: 'r2',
    reference: 'INC-1007',
    kind: 'INCIDENT',
    title: 'VPN drops every hour',
    status: 'SUBMITTED',
    priority: 'HIGH',
    recipientName: 'IT Service Desk',
    updatedAt: '2026-10-04T09:30:00Z',
  },
  {
    id: 'r3',
    reference: 'REQ-1031',
    kind: 'REQUEST',
    title: 'New monitor request',
    status: 'RESOLVED',
    priority: 'NORMAL',
    recipientName: 'Facilities',
    updatedAt: '2026-09-28T15:00:00Z',
  },
];
app.get('/api/dashboard/requests', (req, res) => {
  if (req.query.status !== undefined) {
    const status = String(req.query.status);
    const items = records.filter(r => r.status === status);
    res.json({ recentRecords: items, previewTotal: items.length });
    return;
  }
  res.json({
    total: 9,
    submitted: 3,
    inProgress: 2,
    resolved: 4,
    cancelled: 0,
    canCreate: true,
    recentRecords: records,
  });
});
app.get('/api/learning', (_req, res) => res.json({ plans: [], canManage: true }));
app.get('/api/recommendations', (_req, res) =>
  res.json({ items: [], total: 0, page: 1, pageSize: 20, canSend: false }),
);
app.get('/api/assistant/navigation', (_req, res) =>
  res.json({
    status: { configured: false, provider: 'none', mode: 'read-only' },
    pages: [],
    canReviewOwnSkill: false,
    suggestions: [],
  }),
);
const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => res.sendFile(dist + 'index.html'));
app.listen(5182, '127.0.0.1', () =>
  console.log('Local visual preview: http://127.0.0.1:5182/workspace'),
);
