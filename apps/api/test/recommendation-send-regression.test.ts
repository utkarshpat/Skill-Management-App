import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../src/create-app.js';
import type { LocalAccessState } from '../src/modules/access/index.js';

const manager = '00000000-0000-4000-8000-000000000001';
const report = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003';
const full: LocalAccessState = {
  revision: 1,
  audit: [],
  roles: [
    {
      id: 'member',
      name: 'Employee',
      permissions: [
        { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
        { permission: 'skill.view', scope: 'ORGANIZATION', effect: 'ALLOW' },
        { permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' },
      ],
    },
  ],
  people: [manager, report].map((id, i) => ({
    id,
    active: true,
    displayName: `Person ${i}`,
    employeeCode: `EMP${i}`,
    roleIds: ['member'],
    overrides: [],
    hasDirectReports: i === 0,
  })),
  reporting: [{ personId: report, managerId: manager }],
};
const projected = { ...full, people: [full.people[0]], reporting: undefined };

test('HTTP sends resolve recipients beyond the compact actor projection', async () => {
  let sends = 0;
  const backend = {
    send: async () => {
      sends++;
      return { saved: true };
    },
    read: async () => ({}),
    people: async () => ({ people: [{ id: report }] }),
    respond: async () => ({}),
    analytics: async () => ({}),
    notifications: async () => [],
  };
  const server = createApp({
    verify: async () => ({ tenantId: manager, objectId: manager }),
    profile: async () => undefined,
    resolveAccess: async () => manager,
    access: {
      snapshot: async () => structuredClone(full),
      actorSnapshot: async () => structuredClone(projected),
      person: async () => full.people[0],
      save: async () => full,
    },
    certificationRecommendations: backend,
    recommendations: backend as any,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  try {
    for (const [path, body] of [
      [
        '/api/certification-recommendations/send',
        {
          id,
          personId: report,
          certificationName: 'Cloud',
          provider: '',
          category: '',
          reason: 'Learning',
          credentialUrl: '',
        },
      ],
      [
        '/api/recommendations',
        { id, personId: report, skillId: id, rank: 3, reason: 'Learning', resource: '' },
      ],
    ] as const) {
      const r = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(r.status, 200, path);
    }
    assert.equal(sends, 2);
    for (const mutation of ['unrelated', 'inactive', 'denied'] as const) {
      if (mutation === 'unrelated') full.reporting = [];
      if (mutation === 'inactive') {
        full.reporting = [{ personId: report, managerId: manager }];
        full.people[1].active = false;
      }
      if (mutation === 'denied') {
        full.people[1].active = true;
        full.people[0].overrides = [
          { permission: 'learning.recommend', scope: 'ORGANIZATION', effect: 'DENY' },
        ];
      }
      for (const [path, body] of [
        [
          '/api/certification-recommendations/send',
          {
            id,
            personId: report,
            certificationName: 'Cloud',
            provider: '',
            category: '',
            reason: 'Learning',
            credentialUrl: '',
          },
        ],
        [
          '/api/recommendations',
          { id, personId: report, skillId: id, rank: 3, reason: 'Learning', resource: '' },
        ],
      ] as const) {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.equal(response.status, 403, mutation + path);
      }
    }
    assert.equal(sends, 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
