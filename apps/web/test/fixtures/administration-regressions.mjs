import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { transform } from 'rolldown/experimental';
import * as jsx from 'react/jsx-runtime';
import { readApiResponse } from '../../src/api-response.ts';
let slots = [],
  cursor = 0,
  effects = [],
  calls = [],
  events = [],
  handler;
const react = {
  useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [slots[i], v => (slots[i] = typeof v === 'function' ? v(slots[i]) : v)];
  },
  useRef(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = { current: initial };
    return slots[i];
  },
  useEffect(callback, deps) {
    const i = cursor++;
    const old = slots[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) {
      old?.cleanup?.();
      const next = { deps };
      slots[i] = next;
      effects.push(() => (next.cleanup = callback()));
    }
  },
};
globalThis.window = {
  dispatchEvent: e => {
    events.push(e.type);
    return true;
  },
};
globalThis.document = { getElementById: () => null };
const FormDialog = () => null,
  Link = () => null;
const icons = new Proxy({}, { get: () => () => null });
globalThis.__probe = {
  react,
  jsx,
  icons,
  auth: {
    authenticatedFetch: async (...args) => {
      calls.push([args[0], args[1]?.method ?? 'GET', args[1]?.body]);
      return handler(...args);
    },
  },
  response: { readApiResponse },
  dialog: { FormDialog },
  router: { Link },
};
let source = (
  await transform(
    'BusinessAdministration.tsx',
    await fs.readFile(
      new URL('../../src/business/BusinessAdministration.tsx', import.meta.url),
      'utf8',
    ),
    { jsx: { runtime: 'automatic' } },
  )
).code;
const sources = {
  react: 'react',
  'react/jsx-runtime': 'jsx',
  'lucide-react': 'icons',
  '../auth': 'auth',
  '../api-response': 'response',
  '../FormDialog': 'dialog',
  'react-router': 'router',
};
source = source
  .replace(/import\s+['"][^'"]+\.css['"];?/g, '')
  .replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_all, names, path) =>
      `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1:$2')}}=globalThis.__probe.${sources[path]};`,
  )
  .replace('export function BusinessAdministration', 'function BusinessAdministration');
const Component = new Function(source + '\nreturn BusinessAdministration;')();
const render = () => {
  cursor = 0;
  effects = [];
  const tree = Component({ onSaved: () => {} });
  for (const effect of effects) effect();
  return tree;
};
const nodes = tree => {
  const result = [];
  function walk(x) {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (x.props) {
      result.push(x);
      walk(x.props.children);
      walk(x.props.footer);
    }
  }
  walk(tree);
  return result;
};
const text = node => {
  function get(x) {
    return Array.isArray(x)
      ? x.map(get).join('')
      : x && typeof x === 'object'
        ? get(x.props?.children)
        : (x ?? '');
  }
  return get(node);
};
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && text(n) === label);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const snapshot = {
  revision: 7,
  personalBaseline: true,
  baselineAffectedPeople: 1,
  people: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Synthetic Admin',
      employeeCode: 'PROBE',
      active: true,
      employeeAccess: true,
      managerAccess: false,
      analyticsAccess: true,
      adminAccess: true,
    },
  ],
  projects: [],
  memberships: [],
  responsibilities: [],
  nodes: [],
  historicalGrantsForReview: [],
};
const tick = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
async function initialize(fetcher) {
  slots = [];
  calls = [];
  events = [];
  handler = fetcher;
  render();
  await tick();
  return render();
}
const results = {};
let tree = await initialize(async () => json(snapshot));
results.shortcuts = nodes(tree)
  .filter(n => n.type === Link)
  .map(n => ({ label: text(n), url: n.props.to }));
assert.ok(results.shortcuts.every(n => n.url.includes('?view=')));
let resolvePreview;
tree = await initialize(async url =>
  url.endsWith('/preview') ? await new Promise(r => (resolvePreview = r)) : json(snapshot),
);
button(tree, 'Employee baseline').props.onClick();
tree = render();
nodes(tree)
  .find(n => n.type === 'textarea')
  .props.onChange({ target: { value: 'Synthetic reason' } });
tree = render();
nodes(tree)
  .find(n => n.type === 'form')
  .props.onSubmit({ preventDefault() {} });
await tick();
tree = render();
button(tree, 'Projects').props.onClick();
tree = render();
const submitted = JSON.parse(calls.find(c => c[0].endsWith('/preview'))[2]);
resolvePreview(
  json({
    receipt: 'probe',
    change: submitted,
    before: null,
    after: submitted.payload,
    impact: { actions: [] },
    warnings: [],
  }),
);
await tick();
tree = render();
results.previewRace = {
  currentTab: nodes(tree)
    .filter(n => n.type === 'button' && n.props['aria-current'] === 'page')
    .map(text),
  latePreviewKind: submitted.kind,
};
assert.ok(button(tree, 'Projects').props['aria-current'] === 'page');
assert.ok(!nodes(tree).some(n => n.type === FormDialog));
assert.equal(submitted.kind, 'PERSONAL_BASELINE');
let conflictReads = 0;
tree = await initialize(async url =>
  url.endsWith('/preview')
    ? json({ error: { message: 'Access changed. Reload before previewing.' } }, 409)
    : json({ ...snapshot, revision: 7 + conflictReads++ }),
);
button(tree, 'Employee baseline').props.onClick();
tree = render();
for (let i = 0; i < 2; i++) {
  nodes(tree)
    .find(n => n.type === 'form')
    .props.onSubmit({ preventDefault() {} });
  await tick();
  tree = render();
  await tick();
  tree = render();
}
results.staleRetry = {
  metadataLoads: calls.filter(c => c[1] === 'GET').length,
  previewRevisions: calls
    .filter(c => c[0].endsWith('/preview'))
    .map(c => JSON.parse(c[2]).revision),
};
assert.deepEqual(results.staleRetry, { metadataLoads: 3, previewRevisions: [7, 8] });
let reads = 0;
tree = await initialize(async (url, options) => {
  if (url.endsWith('/preview')) {
    const c = JSON.parse(options.body);
    return json({
      receipt: 'probe',
      change: c,
      before: null,
      after: c.payload,
      impact: { actions: [] },
      warnings: [],
    });
  }
  if (options?.method === 'POST') return json({ saved: true });
  if (url.endsWith('/context')) throw Error('Synthetic context failure');
  return ++reads === 1
    ? json(snapshot)
    : json({ error: { message: 'Administration denied.' } }, 403);
});
button(tree, 'Employee baseline').props.onClick();
tree = render();
nodes(tree)
  .find(n => n.type === 'form')
  .props.onSubmit({ preventDefault() {} });
await tick();
tree = render();
button(tree, 'Confirm & save').props.onClick();
await tick();
render();
await tick();
tree = render();
tree = render();
results.postSaveFailure = {
  committedPosts: calls.filter(c => c[1] === 'POST' && c[0] === '/api/business/administration')
    .length,
  emittedEvents: events,
  retainedAdminRoster: nodes(tree).some(
    n => n.type === 'td' && text(n).includes('Synthetic Admin'),
  ),
};
assert.equal(results.postSaveFailure.committedPosts, 1);
assert.deepEqual(events, ['business-changed', 'workspace-access-updated']);
assert.ok(!results.postSaveFailure.retainedAdminRoster);
console.log('Administration regression scenarios passed');

// Initial transient load can be retried, and the baseline draft survives a conflict reload.
let initialReads = 0;
tree = await initialize(async () =>
  ++initialReads === 1 ? json({ error: { message: 'Temporary failure' } }, 503) : json(snapshot),
);
assert.ok(button(tree, 'Retry loading configuration'));
button(tree, 'Retry loading configuration').props.onClick();
tree = render();
await tick();
tree = render();
assert.ok(button(tree, 'Employee baseline'));
// A lost save response retains the ID even when the server already committed the change.
let saveAttempts = 0;
tree = await initialize(async (url, options) => {
  if (url.endsWith('/preview')) {
    const c = JSON.parse(options.body);
    return json({
      receipt: 'probe',
      change: c,
      before: null,
      after: c.payload,
      impact: { actions: [] },
      warnings: [],
    });
  }
  if (options?.method === 'POST') {
    saveAttempts++;
    throw Error('Lost response');
  }
  return json(snapshot);
});
button(tree, 'Projects').props.onClick();
tree = render();
nodes(tree)
  .find(n => n.type === 'form')
  .props.onSubmit({ preventDefault() {} });
await tick();
tree = render();
const originalId = JSON.parse(calls.find(c => c[0].endsWith('/preview'))[2]).id;
button(tree, 'Confirm & save').props.onClick();
await tick();
tree = render();
await tick();
tree = render();
nodes(tree)
  .find(n => n.type === 'form')
  .props.onSubmit({ preventDefault() {} });
await tick();
tree = render();
assert.equal(JSON.parse(calls.filter(c => c[0].endsWith('/preview')).at(-1)[2]).id, originalId);
assert.equal(saveAttempts, 1);
