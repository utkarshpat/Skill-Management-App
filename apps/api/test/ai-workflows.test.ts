import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { rolePresets } from '../src/modules/access/role-presets.js';
import { ToolRegistry } from '../src/modules/ai/tool-registry.js';
import { AssistantService } from '../src/modules/ai/assistant.js';
import type { WorkflowStore } from '../src/modules/workflows/index.js';

test('workflow AI action notes require current record authority and reject stale or revoked drafts', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  access.snapshot = () => structuredClone(state);
  const id = 'bb123456-1234-1234-1234-123456789abc';
  let revision = 2,
    allowed = true,
    after: 'stable' | 'revoke' | 'change' = 'stable',
    calls = 0;
  const workflows: WorkflowStore = {
    options: async () => ({ canRequest: true, canIncident: true, recipients: [] }),
    list: async () => ({ items: [], total: 0, page: 1, pageSize: 10 }),
    detail: async who => {
      assert.equal(who, actor);
      return {
        record: {
          id,
          kind: 'REQUEST',
          title: '\u0001'.repeat(160),
          description: '\u0001'.repeat(500),
          priority: 'NORMAL',
          status: 'IN_PROGRESS',
          revision,
          requesterId: actor,
          requesterName: 'Requester',
          recipientId: actor,
          recipientName: 'Recipient',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          canComment: true,
          canCancel: false,
          canResolve: allowed,
        },
        events: [],
      };
    },
    change: async () => {
      throw Error('Drafts never write');
    },
    notifications: async () => [],
  };
  const provider = {
    name: 'fixture',
    complete: async () => {
      calls++;
      if (after === 'revoke') allowed = false;
      if (after === 'change') revision++;
      return {
        content: '',
        calls: [
          {
            id: 'note',
            type: 'function' as const,
            function: {
              name: 'present_output',
              arguments: JSON.stringify({
                kind: 'task_draft',
                title: 'Resolution note',
                summary: 'Review',
                body: 'Completed the user-supplied work.',
                steps: [],
                questions: [],
              }),
            },
          },
        ],
      };
    },
  };
  const service = new AssistantService(
    access,
    undefined,
    provider,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    workflows,
  );
  const input = { id, revision: 2, action: 'RESOLVE', notes: 'Completed the requested work.' };
  await assert.rejects(
    service.workflowDraft(actor, { ...input, actorId: 'other' }, AbortSignal.timeout(5000)),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    service.workflowDraft(actor, { ...input, revision: 1 }, AbortSignal.timeout(5000)),
    /Reload/,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await service.workflowDraft(actor, input, AbortSignal.timeout(5000))).body,
    'Completed the user-supplied work.',
  );
  for (const notes of ['x'.repeat(500), '"'.repeat(500), '\u0001'.repeat(500)])
    assert.equal(
      (await service.workflowDraft(actor, { ...input, notes }, AbortSignal.timeout(5000))).body,
      'Completed the user-supplied work.',
    );
  await assert.rejects(
    service.chat(
      actor,
      { messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
      AbortSignal.timeout(5000),
    ),
    /2,000/,
  );
  after = 'revoke';
  await assert.rejects(
    service.workflowDraft(actor, input, AbortSignal.timeout(5000)),
    /permission changed/,
  );
  allowed = true;
  after = 'change';
  await assert.rejects(
    service.workflowDraft(actor, input, AbortSignal.timeout(5000)),
    /record changed/,
  );
});

test('workflow AI tools bind the actor, reject selectors and suppress results after revocation', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  access.snapshot = () => structuredClone(state);
  let calls = 0,
    revoke = false;
  const workflows: WorkflowStore = {
    list: async (id, page, inbox, filters) => {
      assert.equal(id, actor);
      assert.equal(page, 1);
      assert.equal(inbox, true);
      assert.equal(filters?.query, 'help');
      calls++;
      if (revoke)
        state.people[0].overrides.push(
          { permission: 'request.view', scope: 'OWN', effect: 'DENY' },
          { permission: 'incident.view', scope: 'OWN', effect: 'DENY' },
        );
      return { items: [], total: 0, page: 1, pageSize: 10 };
    },
    options: async id => {
      assert.equal(id, actor);
      return { canRequest: true, canIncident: true, recipients: [] };
    },
    detail: async () => {
      throw Error();
    },
    change: async () => {
      throw Error('AI must not write');
    },
    notifications: async () => [],
  };
  const registry = new ToolRegistry(access, undefined, undefined, undefined, undefined, workflows);
  await registry.execute(
    actor,
    'my_requests',
    { inbox: true, search: 'help' },
    AbortSignal.timeout(5000),
  );
  for (const args of [
    { actorId: 'other' },
    { inbox: 'true' },
    { search: 'x'.repeat(81) },
    { page: 0 },
  ])
    await assert.rejects(registry.execute(actor, 'my_requests', args, AbortSignal.timeout(5000)));
  assert.equal(calls, 1);
  await assert.rejects(
    registry.execute(
      actor,
      'request_recipients',
      { accountId: 'other' },
      AbortSignal.timeout(5000),
    ),
  );
  await assert.rejects(
    registry.execute(actor, 'permission_design_options', {}, AbortSignal.timeout(5000)),
  );
  state.people[0].overrides.push({
    permission: 'permissions.manage',
    scope: 'ORGANIZATION',
    effect: 'ALLOW',
  });
  const design = await registry.execute(
    actor,
    'permission_design_options',
    {},
    AbortSignal.timeout(5000),
  );
  assert.match(JSON.stringify(design.data), /request.create/);
  state.people[0].overrides.push(
    { permission: 'permissions.manage', scope: 'OWN', effect: 'DENY' },
    { permission: 'permissions.manage', scope: 'ORGANIZATION', effect: 'DENY' },
  );
  await assert.rejects(
    registry.execute(actor, 'permission_design_options', {}, AbortSignal.timeout(5000)),
    /permission/,
  );
  revoke = true;
  await assert.rejects(
    registry.execute(
      actor,
      'my_requests',
      { inbox: true, search: 'help' },
      AbortSignal.timeout(5000),
    ),
    /permission/,
  );
});

test('request draft output is permission bound, opens a review suggestion and performs no writes', async () => {
  const access = await LocalAccessStore.open(),
    state = access.snapshot(),
    actor = state.people[0].id;
  state.roles[0].permissions = structuredClone(rolePresets[0].permissions);
  state.roles[0].name = 'Super Admin';
  access.snapshot = () => structuredClone(state);
  const provider = {
    name: 'fixture',
    complete: async () => ({
      content: '',
      calls: [
        {
          id: 'draft',
          type: 'function' as const,
          function: {
            name: 'present_output',
            arguments: JSON.stringify({
              kind: 'request_draft',
              title: 'Learning guidance',
              summary: 'Review this request before sending.',
              body: 'I need guidance for a backend learning plan.',
              steps: [],
              questions: [],
            }),
          },
        },
      ],
    }),
  };
  const service = new AssistantService(access, undefined, provider);
  const output = await service.chat(actor, { message: 'Draft a learning request' });
  assert.equal(output.artifact?.kind, 'request_draft');
  const nav = await service.navigation(actor);
  assert.ok('pages' in nav && nav.pages?.some(p => p.url === '/requests'));
  state.people[0].overrides.push({ permission: 'request.create', scope: 'OWN', effect: 'DENY' });
  await assert.rejects(service.chat(actor, { message: 'Draft a learning request' }), /permissions/);
  const denied = await service.navigation(actor);
  assert.ok(
    'suggestions' in denied && !denied.suggestions?.some(s => s.label === 'Draft a request'),
  );
});
