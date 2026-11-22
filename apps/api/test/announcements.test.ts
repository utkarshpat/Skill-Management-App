import { LocalAccessStore } from '../src/modules/access/local-access-store.js';
import { createApp } from '../src/create-app.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express, { type ErrorRequestHandler } from 'express';
import { AccessError } from '../src/shared/errors.js';
import {
  answers,
  canonicalExportFields,
  definition,
  design,
  schedule,
} from '../src/modules/announcements/announcement-definition.js';
import {
  announcementDesignContext,
  announcementDesignResponse,
  announcementDesignSystemPrompt,
} from '../src/modules/announcements/announcement-design.js';
import {
  registerAnnouncementRoutes,
  SqlAnnouncements,
  announcementPage,
} from '../src/modules/announcements/announcement-routes.js';
import {
  announcementBindings,
  checkAnnouncementBindings,
} from '../src/modules/announcements/announcement-sandbox.js';

function registerWithPreviewKey(
  app: Parameters<typeof registerAnnouncementRoutes>[0],
  dependencies: Parameters<typeof registerAnnouncementRoutes>[1],
  key?: string,
) {
  const prior = process.env.ENTRA_WEB_CLIENT_SECRET;
  if (key === undefined) delete process.env.ENTRA_WEB_CLIENT_SECRET;
  else process.env.ENTRA_WEB_CLIENT_SECRET = key;
  try {
    registerAnnouncementRoutes(app, dependencies);
  } finally {
    if (prior === undefined) delete process.env.ENTRA_WEB_CLIENT_SECRET;
    else process.env.ENTRA_WEB_CLIENT_SECRET = prior;
  }
}

const grant = '11111111-1111-4111-8111-111111111111';
const scope = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
test('historical primary skill selections export one Primary Capability column', () => {
  assert.deepEqual(canonicalExportFields(['grade', 'primarySkill', 'capability']), [
    'grade',
    'capability',
  ]);
});
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

test('announcement schedules reject dates and times that would roll over', () => {
  const start = '2026-01-01T00:00:00Z',
    end = '2028-03-01T00:00:00Z';
  for (const time of ['2026-02-31T10:00:00Z', '2026-04-30T24:00:00Z']) {
    assert.throws(() => schedule(time, end), /valid date and time/);
    assert.throws(() => schedule(start, time), /valid date and time/);
  }
  assert.equal(schedule('2028-02-29T10:00:00.1Z', end).startsAt, '2028-02-29T10:00:00.100Z');
});

test('radio choices and checkbox answers are validated without accepting identity input', () => {
  const configured = definition({
    ...dev,
    fields: [
      { ...dev.fields[0], type: 'radio' },
      { id: 'confirm', label: 'I can attend', type: 'checkbox', required: true },
    ],
  });
  assert.deepEqual(
    { ...answers(configured, { batch: 'Morning', confirm: true }) },
    {
      batch: 'Morning',
      confirm: true,
    },
  );
  for (const invalid of [
    { batch: 'Unknown', confirm: true },
    { batch: ['Morning', 'Afternoon'], confirm: true },
    { batch: 'Morning', confirm: false },
    { batch: 'Morning', confirm: true, email: 'other@example.com' },
  ])
    assert.throws(() => answers(configured, invalid), AccessError);
});

test('full app preserves announcement authentication, access and conflict errors without exposing unexpected failures', async t => {
  const access = await LocalAccessStore.open();
  let provisioned = true;
  let failure: Error | undefined;
  let storeCalls = 0;
  const store = new SqlAnnouncements(grant);
  store.execute = async <T>(): Promise<T> => {
    storeCalls++;
    if (failure) throw failure;
    return { items: [] } as T;
  };
  const app = createApp({
    access,
    verify: async authorization => {
      if (authorization !== 'Bearer current') throw Error('Missing verified identity');
      return { tenantId: grant, objectId: actor };
    },
    resolveAccess: async () => (provisioned ? actor : undefined),
    profile: async () => undefined,
    announcements: store,
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api/announcements/';
  const get = (path: string, signedIn = true) =>
    fetch(base + path, {
      headers: signedIn ? { Authorization: 'Bearer current' } : {},
    });
  for (const path of ['feed', 'manage']) {
    const response = await get(path, false);
    assert.equal(response.status, 401);
    assert.match((await response.json()).error.message, /Sign in/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(storeCalls, 0);
  provisioned = false;
  assert.equal((await get('feed')).status, 403);
  assert.equal(storeCalls, 0);
  provisioned = true;
  assert.equal((await get('feed?page=0')).status, 400);
  assert.equal(storeCalls, 0);
  assert.equal((await get('feed')).status, 200);
  for (const status of [403, 404, 409, 422, 503]) {
    failure = new AccessError(status, 'Expected announcement failure');
    const response = await get('feed');
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.message, failure.message);
    assert.ok(body.error.requestId);
  }
  failure = Error('private SQL connection details');
  const response = await get('manage');
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private SQL connection details/);
});
test('designs compile only trusted slots and style tokens, and answers reject forged identity', () => {
  assert.deepEqual(design({ html, css }).order, ['title', 'image', 'message', 'action']);
  const formDesign = design({
    html,
    css: 'section { --form-layout: two-column; --density: compact; --button-width: full; }',
  });
  assert.equal(formDesign.formLayout, 'two-column');
  assert.equal(formDesign.buttonWidth, 'full');
  assert.equal(formDesign.density, 'compact');
  const polished = design({
    html,
    css: 'section { --visual-style: spotlight; --heading-scale: hero; --corner-style: rounded; --button-style: outline; }',
  });
  assert.equal(polished.visualStyle, 'spotlight');
  assert.equal(polished.headingScale, 'hero');
  assert.equal(polished.cornerStyle, 'rounded');
  assert.equal(polished.buttonStyle, 'outline');
  for (const css of [
    'section { --visual-style: url(x); }',
    'section { --heading-scale: 99px; }',
    'section { --corner-style: expression(x); }',
    'section { --button-style: hidden; }',
  ])
    assert.throws(() => design({ html, css }), AccessError);
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

test('forms with a missing bound control fail with a validation error', () => {
  assert.throws(
    () =>
      checkAnnouncementBindings({
        ...dev,
        design: {
          format: 'sandbox-v1',
          bindings: announcementBindings(dev),
          html: '<form id="ann-form"></form>',
        },
      }),
    { status: 400, message: 'A design binding points to a missing element.' },
  );
});

test('a missing preview signing key blocks preview and publish but allows draft saves', async () => {
  const app = express();
  app.use(express.json());
  const operations: string[] = [];
  registerWithPreviewKey(app, {
    verify: async () => ({ tenantId: grant, objectId: actor }),
    resolveAccess: async () => actor,
    announcements: {
      execute: async <T>(_actor: string, operation: string) => {
        operations.push(operation);
        return { ok: true } as T;
      },
    },
  });
  app.use(((error, _req, res, _next) => {
    res.status(error.status ?? 500).json({ error: error.message });
  }) satisfies ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    for (const [flags, status] of [
      [{ preview: true }, 503],
      [{ publish: true }, 503],
      [{}, 200],
    ] as const) {
      const response: Response = await fetch(
        `http://127.0.0.1:${address.port}/api/announcements/draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grantId: grant,
            revision: 0,
            startsAt: '2026-01-01T00:00:00Z',
            endsAt: '2099-01-01T00:00:00Z',
            definition: dev,
            ...flags,
          }),
        },
      );
      assert.equal(response.status, status);
    }
    assert.deepEqual(operations, ['DESIGN', 'DESIGN', 'DESIGN', 'DRAFT']);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('publish is bound to a scoped preview and AI receives selected design and recent feedback', async () => {
  const app = express();
  app.use(express.json());
  const operations: string[] = [];
  let aiInput = '';
  let aiMessage: string | undefined = 'I used a clear layout and a connected registration action.';
  let useSandbox = false;
  registerWithPreviewKey(
    app,
    {
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
          complete: async (messages, _tools, _signal, options) => {
            aiInput = String(messages[1].content);
            assert.deepEqual(options?.responseSchema, announcementDesignResponse);
            if (useSandbox)
              return {
                content: JSON.stringify({
                  format: 'sandbox-v1',
                  html: '<h2 id="ann-title"></h2><p id="ann-message"></p><button id="ann-open">Register</button><form id="ann-form"><label for="ann-name">Name</label><output id="ann-name"></output><label for="ann-email">Work email</label><output id="ann-email"></output><label for="ann-employee-id">Employee ID</label><output id="ann-employee-id"></output><fieldset id="ann-field-batch"></fieldset><button id="ann-submit">Register</button></form>',
                  css: 'fieldset { border: 1px solid teal; }',
                  message: 'Radio form ready.',
                }),
                calls: [],
              };
            return { content: JSON.stringify({ html, css, message: aiMessage }), calls: [] };
          },
        },
        budget: { acquire: async () => async () => {} },
      },
    },
    'fixture-preview-key',
  );
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
    assert.equal(version.reply, aiMessage);
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
    assert.equal(context.viewport.cardMaxWidth, 680);
    assert.equal(context.connections.primaryAction.handler, 'open-configured-form');
    assert.equal(context.connections.failure, 'keep-form-values-and-allow-retry');
    assert.deepEqual(context.configuration.identityFields, ['Name', 'Work Email', 'Employee ID']);
    assert.equal(context.schedule.startsAt, new Date(initial.startsAt).toISOString());
    assert.equal(context.configuration.email, undefined);
    assert.equal(context.recentIterations, undefined);
    assert.equal(context.recentConversation[0].request, 'Use a split layout');
    assert.equal(context.recentConversation[0].reply, aiMessage);
    assert.equal(context.recentConversation[0].design, undefined);
    assert.equal(context.recentConversation[0].selected, true);
    assert.match(announcementDesignSystemPrompt, /two-step employee platform builder/);
    assert.match(announcementDesignSystemPrompt, /Unknown mappings are rejected/);

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
    aiMessage = 'x'.repeat(601);
    assert.equal((await post('design', { ...initial, prompt: 'Keep it readable' })).status, 422);
    aiMessage = undefined;
    const compatible = await post('design', { ...initial, prompt: 'Use the default branding' });
    assert.equal(compatible.status, 200);
    assert.match((await compatible.json()).reply, /Design updated/);
    useSandbox = true;
    const radio = await post('design', {
      ...initial,
      definition: { ...dev, fields: [{ ...dev.fields[0], type: 'radio' }] },
      prompt: 'Design a radio form',
    });
    assert.equal(radio.status, 200);
    const radioDesign = (await radio.json()).design;
    assert.deepEqual(
      radioDesign.bindings.find((binding: { kind: string }) => binding.kind === 'field'),
      {
        elementId: 'ann-field-batch',
        kind: 'field',
        key: 'batch',
      },
    );
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
  assert.equal(context.connections.primaryAction.handler, 'open-recipient-popup');
  assert.equal(context.connections.vote, 'record-configured-option-as-authenticated-vote');
  assert.deepEqual(context.configuration.pollOptions, ['Azure', 'SQL']);
  assert.deepEqual(context.configuration.fields, []);
  assert.equal(context.configuration.image.available, true);
  assert.equal(
    announcementDesignContext(config, { previewWidth: 10000 }).viewport.currentPreviewWidth,
    1280,
  );
  assert.equal(
    announcementDesignContext(config, { previewWidth: 100 }).viewport.currentPreviewWidth,
    320,
  );
  assert.equal(
    announcementDesignContext(config, { previewWidth: Number.NaN }).viewport.currentPreviewWidth,
    680,
  );
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

test('announcement pages reject invalid query shapes and retain the configured bounds', () => {
  assert.equal(announcementPage(undefined), 1);
  assert.equal(announcementPage('2'), 2);
  for (const value of ['0', '-1', '1.5', '1000001', 'abc', ['1']])
    assert.throws(() => announcementPage(value), AccessError);
});

test('paged announcement HTTP reads preserve scope selectors and response email metadata', async () => {
  const app = express();
  const calls: { operation: string; key?: string; payload: object }[] = [];
  registerAnnouncementRoutes(app, {
    verify: async () => ({ tenantId: grant, objectId: actor }),
    resolveAccess: async () => actor,
    announcements: {
      execute: async <T>(
        ...[_actor, operation, key, payload]: Parameters<SqlAnnouncements['execute']>
      ): Promise<T> => {
        calls.push({ operation, key, payload: payload ?? {} });
        return (
          operation === 'RESPONSES'
            ? {
                definition: { ...dev, fields: [] },
                responses: [
                  {
                    name: 'Employee',
                    employeeId: '100',
                    email: 'employee@soprasteria.com',
                    answers: {},
                    grade: 'private',
                  },
                ],
                page: 2,
                hasMore: true,
              }
            : { items: [], page: 2, hasMore: true }
        ) as T;
      },
    },
  });
  const errors: ErrorRequestHandler = (e, _q, r, _n) => {
    r.status(e.status ?? 500).json({ error: { message: e.message } });
  };
  app.use(errors);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const get = (path: string) =>
      fetch('http://127.0.0.1:' + address.port + '/api/announcements/' + path);
    assert.equal((await get('feed?page=2')).status, 200);
    assert.equal((await get('manage?page=2')).status, 200);
    const response = await get(scope + '/responses?page=2');
    const body = await response.json();
    assert.equal(body.hasMore, true);
    assert.equal(body.page, 2);
    assert.equal(body.responses[0].email, 'employee@soprasteria.com');
    assert.equal(body.responses[0].grade, undefined);
    assert.equal((await get('feed?announcement=' + scope)).status, 200);
    assert.deepEqual(
      calls.map(c => [c.operation, c.payload, c.key]),
      [
        ['FEED', { page: 2 }, undefined],
        ['MANAGE', { page: 2 }, undefined],
        ['RESPONSES', { page: 2 }, scope],
        ['FEED', { page: 1 }, scope],
      ],
    );
    const count = calls.length;
    assert.equal((await get('manage?page=0')).status, 400);
    assert.equal((await get('feed?announcement=invalid')).status, 400);
    assert.equal(calls.length, count);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test('response updates pass the version the employee edited and reject a stale second tab', async () => {
  const app = express();
  app.use(express.json());
  let version = 1;
  registerAnnouncementRoutes(app, {
    verify: async () => ({
      tenantId: grant,
      objectId: actor,
      workEmail: 'employee@soprasteria.com',
    }),
    resolveAccess: async () => actor,
    announcements: {
      execute: async <T>(
        ...[_actor, operation, _key, input]: Parameters<SqlAnnouncements['execute']>
      ) => {
        if (operation === 'DETAIL')
          return { revision: 3, definition: { ...dev, allowResponseUpdates: true } } as T;
        assert.equal(operation, 'ANSWER');
        const draft = input as { responseRevision: number };
        if (draft.responseRevision !== version)
          throw new AccessError(409, 'Your response changed.');
        return { saved: true, responseRevision: ++version } as T;
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const save = (responseRevision: number) =>
      fetch(`http://127.0.0.1:${address.port}/api/announcements/${scope}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 3, responseRevision, answers: { batch: 'Morning' } }),
      });
    assert.equal((await save(1)).status, 200);
    assert.equal((await save(1)).status, 409);
    assert.equal((await save(2)).status, 200);
    assert.equal(version, 3);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
