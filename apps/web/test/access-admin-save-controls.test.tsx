import test, { after, afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { render, settle, closeBrowser, demoResponse } from './support/browser';
import { refreshDevelopmentLogin } from '../src/auth';
import { click, fill, change } from './support/interactions';
const css = registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context);
  },
});
const { AccessAdmin } = await import('../src/AccessAdmin');
const person = {
  id: 'aditi',
  displayName: 'Aditi Menon',
  employeeCode: '710902',
  active: true,
  roleIds: ['support'],
  overrides: [],
  jobTitle: 'Delivery Analyst',
  grade: 'B2',
};
const original = {
  revision: 15,
  storage: 'sql',
  authentication: 'local-demo',
  currentPerson: person,
  people: [person],
  roles: [
    {
      id: 'support',
      name: 'Delivery Support',
      permissions: [{ permission: 'request.view', scope: 'OWN', effect: 'ALLOW' }],
    },
  ],
  presets: [
    {
      key: 'coordination',
      name: 'Learning coordination',
      description: 'Coordinate personal learning records',
      permissions: [{ permission: 'learning.view', scope: 'OWN', effect: 'ALLOW' }],
      pending: [{ permission: 'future.report', scope: 'PORTFOLIO' }],
    },
  ],
  catalogue: [
    { code: 'request.view', label: 'View requests', implemented: true, scopes: ['OWN'] },
    { code: 'learning.view', label: 'View learning', implemented: true, scopes: ['OWN'] },
    { code: 'future.report', label: 'Future reporting', implemented: false, scopes: [] },
  ],
  canManageUsers: true,
  canViewAudit: true,
  audit: [],
};
let state: any, view: Awaited<ReturnType<typeof render>> | undefined;
let previews: any[] = [],
  saves: any[] = [],
  saveFailure = 0,
  failPerson = '',
  previewFailure = 0,
  auditReads: string[] = [],
  auditFailure = 0;
beforeEach(async () => {
  state = structuredClone(original);
  previews = [];
  saves = [];
  saveFailure = 0;
  failPerson = '';
  previewFailure = 0;
  auditReads = [];
  auditFailure = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input),
      method = init?.method ?? 'GET';
    if (url === '/api/dev-login') return demoResponse();
    if (url === '/api/notifications') return Response.json({ items: [], unread: 0, total: 0 });
    if (url === '/api/access/organization')
      return Response.json({ revision: 15, nodes: [], people: [person], assignments: [] });
    if (url.startsWith('/api/dev-access/primary-capabilities?'))
      return Response.json({ items: [], total: 0, pageSize: 10 });
    if (url.startsWith('/api/dev-access/audit?')) {
      auditReads.push(url);
      if (auditFailure)
        return Response.json(
          { error: { message: 'Activity access is unavailable' } },
          { status: auditFailure },
        );
      const q = new URL(url, 'http://localhost').searchParams;
      const before = q.has('before');
      return Response.json({
        items:
          q.has('q') && q.get('q')
            ? []
            : [
                {
                  revision: before ? 12 : 14,
                  action: before ? 'template.created' : 'person.updated',
                  at: '2026-11-08T10:00:00Z',
                  actorId: 'aditi',
                  actorName: 'Aditi Menon',
                  targetId: 'rohan',
                  targetName: 'Rohan Mehta',
                },
              ],
        nextCursor: before ? null : 14,
        hasMore: !before,
      });
    }
    if (url === '/api/dev-access/preview') {
      const body = JSON.parse(String(init?.body));
      previews.push(body);
      return previewFailure
        ? Response.json(
            { error: { message: 'Current access cannot preview this change' } },
            { status: previewFailure },
          )
        : Response.json({
            receipt: 'reviewed-access-change',
            before: person,
            after: body,
            impacts: [],
          });
    }
    if (url === '/api/dev-access' && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      saves.push(body);
      if (saveFailure || (failPerson && body.id === failPerson))
        return Response.json(
          { error: { message: 'Access revision changed. Preview again.' } },
          { status: saveFailure || 409 },
        );
      state.revision++;
      if (body.kind === 'role') {
        const changed = { ...body, id: body.id ?? 'created-template' };
        state.roles = [...state.roles.filter((role: any) => role.id !== changed.id), changed];
      }
      if (body.kind === 'person') {
        state.people = state.people.map((item: typeof person) =>
          item.id === body.id ? { ...item, roleIds: body.roleIds } : item,
        );
      }
      return Response.json({ ok: true });
    }
    if (url.startsWith('/api/dev-access')) return Response.json(state);
    throw Error('Unexpected administration request ' + url);
  });
  await refreshDevelopmentLogin();
});
afterEach(async () => {
  await view?.unmount();
  view = undefined;
  mock.restoreAll();
});
after(async () => {
  css.deregister();
  await closeBrowser();
});
async function mount(path = '/access?view=roles') {
  view = await render(
    <MemoryRouter initialEntries={[path]}>
      <AccessAdmin />
    </MemoryRouter>,
  );
  await settle();
  await settle();
}
const editor = () => document.querySelector('.form-dialog')!;
const review = () => document.querySelector('[aria-label="Review access change"]')!;

test('new access template previews its permission set and returns to the same draft before receipt save', async () => {
  await mount();
  await click('New template');
  await fill('Template name', 'Reporting support');
  const allowed = editor().querySelector<HTMLInputElement>(
    '[aria-label="View requests · Own records"]',
  )!;
  await act(async () => allowed.click());
  await click('Preview change');
  assert.equal(saves.length, 0);
  assert.equal(previews[0].kind, 'role');
  assert.equal(previews[0].revision, 15);
  assert.deepEqual(previews[0].permissions, [
    { permission: 'request.view', scope: 'OWN', effect: 'ALLOW' },
  ]);
  assert.equal(document.querySelectorAll('.form-dialog').length, 1);
  await click('Back to edit', review());
  assert.equal(
    document.querySelector<HTMLInputElement>('#role-editor input')!.value,
    'Reporting support',
  );
  await click('Preview change');
  await click('Confirm & save', review());
  assert.deepEqual(saves[0], { ...previews[1], previewReceipt: 'reviewed-access-change' });
  assert.match(document.body.textContent!, /Saved and audited/);
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('failed access recheck preserves the edited template and requires a new preview', async () => {
  await mount();
  await click('Edit Delivery Support');
  await fill('Template name', 'Client delivery support');
  await click('Preview change');
  saveFailure = 409;
  await click('Confirm & save', review());
  assert.equal(document.querySelector('[aria-label="Review access change"]'), null);
  assert.match(document.body.textContent!, /Access revision changed/);
  assert.equal(
    document.querySelector<HTMLInputElement>('#role-editor input')!.value,
    'Client delivery support',
  );
  saveFailure = 0;
  await click('Preview change');
  await click('Confirm & save', review());
  assert.equal(previews.length, 2);
  assert.equal(saves.length, 2);
});

test('new person preview preserves employment fields without granting templates or hierarchy authority', async () => {
  await mount('/access?view=overview');
  await click('Add person');
  await fill('Display name', 'Priya Nair');
  await fill('Person ID', '710904');
  await fill('Business job title', 'Delivery Analyst');
  await fill('Grade', 'B2');
  await click('Preview change');
  assert.equal(previews[0].displayName, 'Priya Nair');
  assert.equal(previews[0].jobTitle, 'Delivery Analyst');
  assert.equal(previews[0].grade, 'B2');
  assert.deepEqual(previews[0].roleIds, []);
  assert.deepEqual(previews[0].overrides, []);
  assert.equal(previews[0].managerId, undefined);
  assert.equal(document.querySelectorAll('.form-dialog').length, 1);
  await click('Back to edit', review());
  assert.equal(
    document.querySelector<HTMLInputElement>('#person-editor input')!.value,
    'Priya Nair',
  );
  assert.equal(saves.length, 0);
  await click('Cancel');
  assert.equal(document.querySelector('.form-dialog'), null);
});

test('preset proposals remain editable and failed preview never writes', async () => {
  await mount();
  await click('Learning coordination');
  assert.match(document.body.textContent!, /These proposals do not grant access yet/);
  await fill('Template name', 'Personal learning coordination');
  previewFailure = 403;
  await click('Preview change');
  assert.match(document.body.textContent!, /cannot preview this change/);
  assert.equal(saves.length, 0);
  assert.equal(previews[0].permissions[0].permission, 'learning.view');
  await click('Cancel');
});

test('bulk template assignment rechecks each revision and retries only the remaining person after a partial save', async () => {
  state.people.push({
    ...person,
    id: 'rohan',
    displayName: 'Rohan Mehta',
    employeeCode: '710903',
    roleIds: [],
  });
  await mount();
  await click('Bulk template assignments');
  await click('Edit assignments');
  for (const name of ['Aditi Menon', 'Rohan Mehta']) {
    const checkbox = editor().querySelector<HTMLInputElement>(
      `[aria-label="Assign Delivery Support to ${name}"]`,
    )!;
    await act(async () => checkbox.click());
  }
  await click('Save assignments');
  const assignmentsReview = () =>
    document.querySelector('[aria-label="Review template assignments"]')!;
  assert.match(assignmentsReview().textContent!, /Aditi Menon.*Rohan Mehta/);
  assert.equal(previews.length, 0);
  await click('Back to edit', assignmentsReview());
  assert.equal(
    editor().querySelector<HTMLInputElement>(
      '[aria-label="Assign Delivery Support to Rohan Mehta"]',
    )!.checked,
    true,
  );
  await click('Save assignments');
  failPerson = 'rohan';
  await click('Confirm assignments', assignmentsReview());
  assert.deepEqual(
    previews.map(p => [p.id, p.revision, p.roleIds]),
    [
      ['aditi', 15, []],
      ['rohan', 16, ['support']],
    ],
  );
  assert.deepEqual(
    saves.map(({ previewReceipt, ...body }) => [previewReceipt, body]),
    previews.map(body => ['reviewed-access-change', body]),
  );
  assert.match(document.body.textContent!, /1 people saved. Review remaining selections/);
  failPerson = '';
  await click('Save assignments');
  assert.doesNotMatch(assignmentsReview().textContent!, /Aditi Menon/);
  await click('Confirm assignments', assignmentsReview());
  assert.deepEqual(
    saves.map(s => [s.id, s.revision]),
    [
      ['aditi', 15],
      ['rohan', 16],
      ['rohan', 16],
    ],
  );
  assert.match(document.body.textContent!, /Saved 1 people/);
});

test('activity log follows the current cursor, resets on search and keeps denied rows hidden until retry', async () => {
  await mount('/access?view=overview');
  const currentAudit = () => new URL(auditReads.at(-1)!, 'http://localhost').searchParams;
  const ready = async () => {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
    });
    await settle();
  };
  await ready();
  assert.equal(currentAudit().get('pageSize'), '5');
  await click('View all', document.querySelector('.overview-activity')!);
  await ready();
  assert.equal(currentAudit().get('pageSize'), '25');
  assert.match(
    document.querySelector('.audit-scroll')!.textContent!,
    /person updated.*Aditi Menon.*Rohan Mehta/,
  );
  await click('Older');
  await ready();
  assert.equal(currentAudit().get('before'), '14');
  assert.match(document.querySelector('.audit-scroll')!.textContent!, /template created/);
  await click('Newer');
  await ready();
  assert.equal(currentAudit().has('before'), false);
  auditFailure = 403;
  await change(
    document.querySelector<HTMLInputElement>('[aria-label="Search activity"]')!,
    'Northstar',
  );
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 270));
  });
  await settle();
  assert.match(document.body.textContent!, /Activity access is unavailable/);
  assert.equal(document.querySelector('.audit-scroll'), null);
  assert.equal(currentAudit().get('q'), 'Northstar');
  assert.equal(currentAudit().get('details'), 'false');
  auditFailure = 0;
  await click('Retry activity');
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 270));
  });
  await settle();
  assert.match(
    document.querySelector('.audit-scroll')!.textContent!,
    /No matching changes recorded/,
  );
  assert.equal(currentAudit().has('before'), false);
});

test('person account status and scoped exception stay staged until the reviewed preview is confirmed', async () => {
  await mount('/access?view=overview');
  await click('Add person');
  await fill('Display name', 'Priya Nair');
  await fill('Person ID', '710904');
  const active = [...editor().querySelectorAll('label')]
    .find(label => label.textContent?.includes('Active account'))!
    .querySelector('input')!;
  await act(async () => active.click());
  await click('Exceptions');
  const permission = editor().querySelector<HTMLInputElement>(
    '[aria-label="View requests · Own records"]',
  )!;
  await act(async () => permission.click());
  await fill('Effect', 'DENY');
  await fill('Expires (required)', '2030-02-01T09:00');
  await fill('Reason (required)', 'Hold requests pending the account review.');
  await click('Back to permissions');
  await click('Preview change');
  assert.equal(saves.length, 0);
  assert.equal(previews[0].active, false);
  assert.deepEqual(previews[0].overrides, [
    {
      permission: 'request.view',
      effect: 'DENY',
      scope: 'OWN',
      validUntil: new Date('2030-02-01T09:00').toISOString(),
      reason: 'Hold requests pending the account review.',
    },
  ]);
  await click('Close Review access change', review());
  assert.ok(document.querySelector('dialog[aria-label="Create person"]'));
  await click('Close Create person');
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(saves.length, 0);
});

test('overview template shortcut opens the template editor and close discards the unsaved request', async () => {
  await mount('/access?view=overview');
  await click('Create template');
  const dialog = document.querySelector('dialog[aria-label="Create access template"]');
  assert.ok(dialog);
  await fill('Template name', 'Reporting support', dialog);
  await click('Close Create access template', dialog);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(previews.length, 0);
  assert.equal(saves.length, 0);
});
