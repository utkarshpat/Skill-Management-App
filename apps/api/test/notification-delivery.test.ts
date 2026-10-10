import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { createApp } from '../src/create-app.js';
import type { WorkflowStore } from '../src/modules/workflows/workflows.js';

test('notification delivery rechecks active status, effective permissions and access revision', async () => {
  for (const change of ['stable', 'inactive', 'revoke', 'revoke-skill', 'revision'] as const) {
    const access = await LocalAccessStore.open(),
      state = access.snapshot(),
      actor = state.people[0];
    actor.active = true;
    actor.overrides.push(
      { permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' },
      { permission: 'skill.view', scope: 'OWN', effect: 'ALLOW' },
    );
    access.snapshot = () => structuredClone(state);
    const workflows: WorkflowStore = {
      options: async () => ({ canRequest: false, canIncident: false, recipients: [] }),
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 10 }),
      detail: async () => {
        throw Error('Unused');
      },
      change: async () => {
        throw Error('No writes');
      },
      notifications: async () => {
        if (change === 'inactive') actor.active = false;
        if (change === 'revoke')
          actor.overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'DENY' });
        if (change === 'revoke-skill')
          actor.overrides.push({ permission: 'skill.view', scope: 'OWN', effect: 'DENY' });
        if (change === 'revision') state.revision++;
        return [
          {
            id: 'private-event',
            at: '2026-10-10T12:00:00Z',
            title: 'Private',
            body: 'Private content',
            href: '/requests',
          },
        ];
      },
    };
    const server = createApp({
      access,
      resolveAccess: async () => actor.id,
      verify: async () => ({ tenantId: 'fixture', objectId: 'fixture' }),
      profile: async () => undefined,
      workflows,
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/api/notifications`,
        { headers: { Authorization: 'Bearer fixture' } },
      );
      const body = await response.json();
      assert.equal(response.status, change === 'stable' ? 200 : 403, change);
      if (change === 'stable')
        assert.ok(body.items.some((item: { id: string }) => item.id === 'private-event'));
      else assert.equal(body.items, undefined);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
