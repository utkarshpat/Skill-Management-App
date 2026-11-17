import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { createApp } from '../src/create-app.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express, { type ErrorRequestHandler } from 'express';
import { AccessError } from '../src/shared/errors.js';
import {
  answers,
  definition,
  design,
} from '../src/modules/announcements/announcement-definition.js';
import {
  announcementDesignContext,
  announcementDesignSystemPrompt,
} from '../src/modules/announcements/announcement-design.js';
import {
  registerAnnouncementRoutes,
  SqlAnnouncements,
} from '../src/modules/announcements/announcement-routes.js';

const grant = '11111111-1111-4111-8111-111111111111';
const scope = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const dev = {
  kind: 'FORM',
  title: 'Training',
  message: '',
  cta: 'Register',
  audience: [{ kind: 'PROJECT', id: scope }],
  exports: ['grade', 'du'],
  options: [],
  fields: [
    {
      id: 'batch',
      label: 'Preferred batch',
      type: 'choice',
      required: true,
      options: ['Morning', 'Afternoon'],
    },
  ],
};
const html =
  '<section><div data-slot="title"></div><div data-slot="image"></div><div data-slot="message"></div><div data-slot="action"></div></section>';
const css = 'section { color: #126b70; background-color: #f7f8f6; --layout: split; }';
test('designs compile only trusted slots and style tokens, and answers reject forged identity', () => {
  assert.deepEqual(design({ html, css }).order, ['title', 'image', 'message', 'action']);
  const example = JSON.parse(
    announcementDesignSystemPrompt.split('Example output:\n')[1].split('\n')[0],
  );
  assert.equal(design(example).buttonWidth, 'full');
  const formDesign = design({
    html,
    css: 'section { --form-layout: two-column; --density: compact; --button-width: full; }',
  });
  assert.equal(formDesign.formLayout, 'two-column');
  assert.equal(formDesign.buttonWidth, 'full');
  assert.equal(formDesign.density, 'compact');
  assert.throws(() => design({ html, css: 'section { --form-layout: subgrid; }' }), AccessError);
  for (const value of [
    { html: html.replace('<section>', '<section onclick="return false">'), css },
    { html: html.replace('"image"', '"title"'), css },
    { html, css: 'section { background: url(https://example.invalid/); }' },
    { html, css: 'section { position: fixed; }' },
  ])
    assert.throws(() => design(value), AccessError);
  const config = definition(dev);
  assert.deepEqual({ ...answers(config, { batch: 'Morning' }) }, { batch: 'Morning' });
  assert.throws(
    () => answers(config, { batch: 'Morning', employeeId: 'someone-else' }),
    AccessError,
  );
  assert.throws(() => answers(config, { batch: 'Evening' }), AccessError);
  assert.throws(
    () => definition({ ...dev, audience: [{ kind: 'ORGANIZATION', id: scope }] }),
    AccessError,
  );
});

test('publish is bound to a scoped preview and AI receives selected design and recent feedback', async () => {
  const app = express();
  app.use(express.json());
  const operations: string[] = [];
  let aiInput = '';
  registerAnnouncementRoutes(app, {
    verify: async () => ({
      tenantId: grant,
      objectId: actor,
      workEmail: 'employee@soprasteria.com',
    }),
    resolveAccess: async () => actor,
    announcements: {
      execute: async <T>(_actor: string, operation: string, id?: string): Promise<T> => {
        operations.push(operation);
        return (operation === 'PREVIEW' ? { audienceCount: 1 } : { id, ok: true }) as T;
      },
      provider: {
        name: 'fixture',
        complete: async messages => {
          aiInput = String(messages[1].content);
          return { content: JSON.stringify({ html, css }), calls: [] };
        },
      },
      budget: { acquire: async () => async () => {} },
    },
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error.status ?? 500).json({ error: error.message });
  };
  app.use(errors);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const post = (path: string, body: object) =>
      fetch('http://127.0.0.1:' + address.port + '/api/announcements/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const initial = {
      grantId: grant,
      revision: 0,
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2099-01-01T00:00:00Z',
      definition: dev,
    };
    const made = await post('design', { ...initial, prompt: 'Use a split layout' });
    assert.equal(made.status, 200);
    const version = await made.json();
    const updated = { ...dev, versions: [version], selectedVersion: version.id };
    const revised = await post('design', {
      ...initial,
      definition: updated,
      prompt: 'Make it more compact',
    });
    assert.equal(revised.status, 200);
    assert.equal(JSON.parse(aiInput).selected.html, html);
    const context = JSON.parse(aiInput);
    assert.equal(context.useCase, 'EVENT');
    assert.equal(context.viewport.mobileWidth, 390);
    assert.equal(context.viewport.cardMaxWidth, 720);
    assert.equal(context.connections.primaryAction.handler, 'open-configured-form');
    assert.equal(context.connections.failure, 'keep-form-values-and-allow-retry');
    assert.deepEqual(context.configuration.identityFields, ['Name', 'Work Email', 'Employee ID']);
    assert.equal(context.schedule.startsAt, new Date(initial.startsAt).toISOString());
    assert.equal(context.configuration.email, undefined);
    assert.deepEqual(JSON.parse(aiInput).recentIterations, ['Use a split layout']);

    const preview = await post('draft', { ...initial, definition: updated, preview: true });
    assert.equal(preview.status, 200);
    const { id, receipt } = await preview.json();
    const changed = await post('draft', {
      ...initial,
      definition: { ...updated, title: 'Changed' },
      id,
      receipt,
      publish: true,
    });
    assert.equal(changed.status, 409);
    assert.equal(operations.includes('DRAFT'), false);
    const published = await post('draft', {
      ...initial,
      definition: updated,
      id,
      receipt,
      publish: true,
    });
    assert.equal(published.status, 200);
    assert.equal((await published.json()).id, id);
    assert.equal(operations.at(-1), 'DRAFT');
    const retired = await post('templates/' + actor, { responsibilityId: scope, enabled: true });
    assert.equal(retired.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

test('poll context preserves configured vote actions and clamps viewport metadata', () => {
  const config = definition({
    ...dev,
    kind: 'POLL',
    options: ['Azure', 'SQL'],
    useCase: 'SURVEY',
    designViewport: 'mobile',
  });
  const context = announcementDesignContext(config, { width: 99999, height: -1, hasImage: true });
  assert.equal(context.useCase, 'SURVEY');
  assert.deepEqual(context.viewport.currentBrowser, { width: 3840, height: 480 });
  assert.equal(context.viewport.focus, 'mobile');
  assert.equal(
    context.connections.primaryAction.handler,
    'record-configured-option-as-authenticated-vote',
  );
  assert.deepEqual(context.configuration.pollOptions, ['Azure', 'SQL']);
  assert.deepEqual(context.configuration.fields, []);
  assert.equal(context.configuration.image.available, true);
});

test('notification delivery uses only the authenticated actor active feed and isolates outages', async () => {
  const access = await LocalAccessStore.open();
  const state = access.snapshot();
  const person = state.people[0];
  person.active = true;
  person.overrides.push({ permission: 'profile.view', scope: 'OWN', effect: 'ALLOW' });
  access.snapshot = () => structuredClone(state);
  const store = new SqlAnnouncements('fixture');
  let failure: Error | undefined;
  store.execute = async <T>(requestedActor: string, operation: string): Promise<T> => {
    assert.equal(requestedActor, person.id);
    assert.equal(operation, 'FEED');
    if (failure) throw failure;
    return {
      items: [
        {
          id: scope,
          startsAt: '2026-11-01T00:00:00Z',
          answered: false,
          definition: { title: 'Team training', message: 'Register for your batch', kind: 'FORM' },
        },
      ],
    } as T;
  };
  const server = createApp({
    access,
    verify: async () => ({ tenantId: 'fixture', objectId: 'fixture' }),
    resolveAccess: async () => person.id,
    profile: async () => undefined,
    announcements: store,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = () =>
      fetch('http://127.0.0.1:' + address.port + '/api/notifications?personId=other', {
        headers: { Authorization: 'Bearer fixture' },
      });
    const response = await get();
    assert.equal(response.status, 200);
    const feed = await response.json();
    assert.deepEqual(
      feed.items.find((i: { id: string }) => i.id === 'announcement-' + scope),
      {
        id: 'announcement-' + scope,
        at: '2026-11-01T00:00:00Z',
        title: 'Team training',
        body: 'Register for your batch',
        href: '/announcements?announcement=' + scope,
      },
    );
    failure = Error('SQL unavailable');
    const partial = await (await get()).json();
    assert.equal(partial.partial, true);
    assert.deepEqual(partial.failedSources, ['announcements']);
    assert.ok(!partial.items.some((i: { id: string }) => i.id.startsWith('announcement-')));
    failure = new AccessError(403, 'Revoked');
    assert.equal((await get()).status, 403);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
