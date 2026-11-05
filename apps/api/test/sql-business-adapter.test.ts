import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sqlAdapterFixture } from './sql-adapter-fixture.js';
import { SqlBusinessStore } from '../src/modules/business/sql-store.js';
import { businessQuery } from '../src/modules/business/business.js';
import { peopleSearchQuery } from '../src/modules/business/people-search.js';
import { PrivateFileStorage } from '../src/shared/private-files.js';
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const context = {
  revision: 4,
  canView: true,
  canExport: true,
  canMatch: true,
  canManage: true,
  scopes: [{ id, kind: 'PROJECT', name: 'Customer Insights Modernisation' }],
};
test('business adapter rechecks scope on dashboards, people matching, configuration and workflow reads', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlBusinessStore(account),
    reply = (proc: string, value: unknown) => f.reply(proc, [{ json: JSON.stringify(value) }]),
    ctx = (value = context) => reply('dbo.BusinessContext', value);
  try {
    assert.throws(() => new SqlBusinessStore('other-workspace'));
    ctx();
    assert.equal((await store.context(actor)).revision, 4);
    reply('dbo.BusinessAdministration', { revision: 4 });
    ctx();
    assert.deepEqual((await store.administration(actor)).historicalGrantsForReview, []);
    reply('dbo.BusinessAdministration', { revision: 4 });
    ctx({ ...context, canManage: false });
    await assert.rejects(store.administration(actor), { status: 403 });
    reply('dbo.BusinessAdministration', { revision: 3 });
    ctx();
    await assert.rejects(store.administration(actor), { status: 409 });
    const query = businessQuery({ dataset: 'skills' });
    reply('dbo.BusinessDashboard', { context });
    ctx();
    assert.deepEqual((await store.dashboard(actor, query, true)).rows, []);
    assert.equal(f.calls.at(-2)?.inputs.export, true);
    reply('dbo.BusinessDashboard', { context });
    ctx({ ...context, revision: 5 });
    await assert.rejects(store.dashboard(actor, query), { status: 409 });
    const search = peopleSearchQuery({ skills: [{ id, minRank: 2 }] });
    reply('dbo.BusinessPeopleSearch', { context });
    ctx();
    assert.deepEqual((await store.peopleSearch(actor, search)).rows, []);
    reply('dbo.BusinessPeopleSearch', { context });
    ctx({ ...context, canMatch: false });
    await assert.rejects(store.peopleSearch(actor, search, true), { status: 403 });
    for (const operation of ['MASTERS', 'AMENDMENTS', 'AMENDMENT', 'DEMANDS', 'MATCHES']) {
      ctx();
      reply('dbo.BusinessWorkflow', {});
      ctx();
      const result = await store.workflow(actor, operation, { page: 1 });
      if (operation === 'MASTERS') assert.deepEqual(result.skills, []);
      if (operation === 'AMENDMENTS') assert.deepEqual(result.rows, []);
    }
    ctx();
    reply('dbo.BusinessWorkflow', {});
    ctx({ ...context, revision: 5 });
    await assert.rejects(store.workflow(actor, 'AMENDMENTS', {}), { status: 409 });
    reply('dbo.SaveCatalogueMaster', { saved: true });
    assert.equal((await store.workflow(actor, 'SAVE_MASTER', { id })).saved, true);
    for (const operation of ['SAVE_MASTER', 'AMENDMENT']) {
      ctx();
      reply(
        operation === 'SAVE_MASTER' ? 'dbo.SaveCatalogueMaster' : 'dbo.BusinessWorkflowRecovery',
        { id },
      );
      ctx();
      assert.deepEqual(await store.recoverWorkflow(actor, operation, { id }), { id });
    }
    ctx();
    reply('dbo.BusinessWorkflowRecovery', { id });
    ctx({ ...context, revision: 5 });
    await assert.rejects(store.recoverWorkflow(actor, 'AMENDMENT', { id }), { status: 409 });
    ctx();
    reply('dbo.BusinessAmendmentNotifications', []);
    ctx();
    assert.deepEqual(await store.notifications(actor), []);
    ctx();
    reply('dbo.BusinessAmendmentNotifications', []);
    ctx({ ...context, revision: 5 });
    await assert.rejects(store.notifications(actor), { status: 409 });
    for (const [number, status] of [
      [51003, 403],
      [51009, 409],
      [51010, 409],
      [51004, 404],
      [51000, 400],
      [2601, 409],
      [2627, 409],
      [547, 400],
      [2812, 503],
      [208, 503],
      [207, 503],
    ]) {
      f.reject('dbo.BusinessContext', { number, message: 'Rejected current operation' });
      await assert.rejects(store.context(actor), { status });
    }
    const fault = new Error('offline');
    f.reject('dbo.BusinessContext', fault);
    await assert.rejects(store.context(actor), e => e === fault);
    f.reply('dbo.BusinessContext', []);
    await assert.rejects(store.context(actor), { status: 503 });
    for (const call of f.calls) {
      assert.equal(call.inputs.account_id, account);
      assert.equal(call.inputs.actor_id, actor);
    }
  } finally {
    await f.finish();
  }
});
test('business file projection binds scope and refuses changed access before private byte delivery', async () => {
  const f = sqlAdapterFixture(),
    store = new SqlBusinessStore(account, { provider: 'sql' }),
    read = mock.method(
      PrivateFileStorage.prototype,
      'read',
      async (_access: Parameters<PrivateFileStorage['read']>[0], _id: string) =>
        Buffer.from('credential'),
    );
  const reply = (proc: string, value: unknown) => f.reply(proc, [{ json: JSON.stringify(value) }]);
  try {
    await assert.rejects(store.recordFiles(actor, 'other', id), { status: 400 });
    reply('dbo.BusinessRecordFiles', { workspaceRevision: 4, revision: 2 });
    reply('dbo.BusinessContext', context);
    assert.deepEqual((await store.recordFiles(actor, 'skills', id)).items, []);
    reply('dbo.BusinessRecordFiles', { workspaceRevision: 4 });
    reply('dbo.BusinessContext', { ...context, revision: 5 });
    await assert.rejects(store.recordFiles(actor, 'certifications', id), { status: 409 });
    await assert.rejects(new SqlBusinessStore(account).file(actor, 'skills', id, id), {
      status: 503,
    });
    // Each metadata read is authorized again; a second request cannot reuse the first grant.
    for (const kind of ['skills', 'certifications']) {
      for (let i = 0; i < 2; i++) {
        reply('dbo.BusinessRecordFiles', {
          workspaceRevision: 4,
          revision: 2,
          items: [{ id, bytes: 10, blobName: 'private/credential', mimeType: 'text/plain' }],
        });
        reply('dbo.BusinessContext', context);
      }
      assert.equal((await store.file(actor, kind, id, id)).data.toString(), 'credential');
      assert.equal(
        read.mock.calls.at(-1)?.arguments[0].context,
        kind === 'skills' ? 'business-skill' : 'business-cert',
      );
    }
  } finally {
    read.mock.restore();
    await f.finish();
  }
});
