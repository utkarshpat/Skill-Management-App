import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  announcementBindings,
  sandboxDesign,
  checkAnnouncementBindings,
} from '../src/modules/announcements/announcement-sandbox.js';
import { workflowOnlyInstructions } from '../src/modules/ai/workflow-chat-policy.js';
const configuration = { kind: 'FORM', fields: [{ id: 'batch', type: 'choice' }], options: [] };
const html =
  '<section><h2 id="ann-title"></h2><p id="ann-message"></p><button id="ann-open">Register</button><form id="ann-form"><label for="ann-name">Name</label><input id="ann-name"><label for="ann-email">Email</label><input id="ann-email"><label for="ann-employee-id">Employee ID</label><input id="ann-employee-id"><label for="ann-field-batch">Batch</label><select id="ann-field-batch"></select><button id="ann-submit">Register</button></form></section>';
const candidate = () => ({
  html,
  css: 'section{display:grid;gap:16px;background:linear-gradient(120deg,#fff,#eaf7f6)} @media(max-width:500px){section{padding:12px}}',
  bindings: announcementBindings(configuration),
});
test('sandbox accepts designer CSS and connects the exact configured form IDs', () => {
  const design = sandboxDesign(candidate());
  checkAnnouncementBindings({ ...configuration, design });
  assert.equal(design.format, 'sandbox-v1');
  assert.match(design.css, /linear-gradient/);
  const poll = { kind: 'POLL', fields: [], options: ['Azure', 'SQL'] };
  checkAnnouncementBindings({
    ...poll,
    design: sandboxDesign({
      html: '<h2 id="ann-title"></h2><p id="ann-message"></p><button id="ann-vote-0">Azure</button><button id="ann-vote-1">SQL</button>',
      css: 'button{min-height:44px}',
      bindings: announcementBindings(poll),
    }),
  });
  assert.throws(
    () =>
      checkAnnouncementBindings({
        ...configuration,
        fields: [{ id: 'other', type: 'text' }],
        design,
      }),
    /current form/,
  );
});
test('sandbox rejects active markup, external resources, forged bindings and incompatible fields', () => {
  assert.throws(
    () =>
      sandboxDesign({
        ...candidate(),
        html: html.replace(
          '<h2 id="ann-title"></h2>',
          '<h2 id="ann-title"><span>Nested</span></h2>',
        ),
      }),
    /text-only/,
  );
  for (const unsafe of [
    html
      .replace('<button id="ann-open">Register</button>', '')
      .replace(
        '<form id="ann-form">',
        '<form id="ann-form"><button id="ann-open">Register</button>',
      ),
    html.replace(
      '<select id="ann-field-batch"></select>',
      '<fieldset disabled><select id="ann-field-batch"></select></fieldset>',
    ),
  ])
    assert.throws(
      () =>
        checkAnnouncementBindings({
          ...configuration,
          design: sandboxDesign({ ...candidate(), html: unsafe }),
        }),
      /outside ann-form|disable/,
    );
  for (const injected of [
    '<script>alert(1)</script>',
    '<iframe></iframe>',
    '<svg onload="alert(1)"></svg>',
    '<img src="https://external.test/x">',
    '<a href="https://external.test">Visit</a>',
    '<input id="ann-extra">',
    '<div onclick="alert(1)"></div>',
    '<div style="color:red"></div>',
  ])
    assert.throws(() => sandboxDesign({ ...candidate(), html: html + injected }));
  for (const css of [
    '@import "https://external.test";',
    'section{background:url(x)}',
    '@font-face{font-family:x;src:local(x)}',
    'section{background:image-set("x" 1x)}',
    'section{behavior:evil}',
    'section{color:r\\65d}',
    'section{color:red',
  ])
    assert.throws(() => sandboxDesign({ ...candidate(), css }));
  assert.throws(
    () =>
      sandboxDesign({
        ...candidate(),
        bindings: [...announcementBindings(configuration), announcementBindings(configuration)[0]],
      }),
    /unique/,
  );
  assert.throws(() =>
    sandboxDesign({ ...candidate(), html: html.replace('id="ann-title"', 'id="bad"') }),
  );
  assert.throws(
    () =>
      sandboxDesign({
        ...candidate(),
        html: html.replace(
          '<h2 id="ann-title"></h2>',
          '<h2 id="ann-title"></h2><h2 id="ann-title"></h2>',
        ),
      }),
    /unique/,
  );
  assert.throws(
    () =>
      checkAnnouncementBindings({
        ...configuration,
        design: sandboxDesign({
          ...candidate(),
          html: html.replace(
            '<select id="ann-field-batch"></select>',
            '<input id="ann-field-batch">',
          ),
        }),
      }),
    /field type/,
  );
  assert.throws(
    () =>
      checkAnnouncementBindings({
        ...configuration,
        design: sandboxDesign({
          ...candidate(),
          html: html.replace('<label for="ann-field-batch">Batch</label>', ''),
        }),
      }),
    /associated label/,
  );
  assert.throws(() =>
    checkAnnouncementBindings({
      ...configuration,
      design: sandboxDesign({
        ...candidate(),
        html: html.replace('<form id="ann-form">', '').replace('</form>', ''),
        bindings: announcementBindings(configuration).filter(b => b.kind !== 'form'),
      }),
    }),
  );
});
test('trusted bridge CSP hash matches its exact script and assistant keeps announcement workflow guidance', async () => {
  const page = await readFile(
    new URL('../../web/public/announcement-sandbox.html', import.meta.url),
    'utf8',
  );
  const script = /<script id="announcement-bridge">([\s\S]*?)<\/script>/.exec(page)![1];
  const hash =
    'sha256-' + createHash('sha256').update(script.replace(/\r\n/g, '\n')).digest('base64');
  assert.ok(page.includes("script-src '" + hash + "'"));
  assert.match(page, /connect-src 'none'/);
  assert.match(page, /form-action 'none'/);
  assert.match(workflowOnlyInstructions, /Announcements\/forms\/polls use Design & preview/);
  assert.match(workflowOnlyInstructions, /latest user message/);
});
