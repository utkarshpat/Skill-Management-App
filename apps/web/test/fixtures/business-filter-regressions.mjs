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
import * as model from '../../src/business/business-model.ts';
let params = new URLSearchParams('tab=insights&dataset=people');
const deferred = [];
const context = {
  actorId: 'actor',
  revision: 1,
  asOf: '2026-10-11T10:00:00Z',
  canView: true,
  canExport: true,
  canManage: false,
  scopes: [],
};
const dashboard = employee => ({
  context,
  summary: { employees: 1, certified: 0, skilled: 0, pending: 0, expired: 0, expiring: 0 },
  coverage: [],
  distribution: [],
  expiry: [],
  activity: [],
  rows: [{ employee, employeeCode: 'QA' }],
  total: 1,
  page: 1,
  pageSize: 25,
});
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const icons = new Proxy(
  Object.fromEntries(
    [
      'ArrowDownToLine',
      'BarChart3',
      'Users',
      'ShieldCheck',
      'Clock3',
      'AlertCircle',
      'Sparkles',
      'X',
      'Eye',
    ].map(name => [name, () => null]),
  ),
  {
    get: (target, prop) => (typeof prop === 'string' && prop in target ? target[prop] : () => null),
  },
);
globalThis.__probe = {
  react,
  jsx,
  icons,
  model,
  auth: {
    authenticatedFetch: async (url, options) => {
      calls.push(url);
      if (calls.length === 1) return json(dashboard('Initial employee'));
      return await new Promise(resolve => deferred.push({ resolve, signal: options.signal }));
    },
  },
  response: { readApiResponse },
  router: { useSearchParams: () => [params, next => (params = next)] },
  administration: {},
  workflows: {},
  date: {},
  files: {},
};
let source = (
  await transform(
    'BusinessOperations.tsx',
    await fs.readFile(
      new URL('../../src/business/BusinessOperations.tsx', import.meta.url),
      'utf8',
    ),
    { jsx: { runtime: 'automatic' } },
  )
).code;
const sources = {
  react: 'react',
  'react/jsx-runtime': 'jsx',
  'react-router': 'router',
  'lucide-react': 'icons',
  '../auth': 'auth',
  '../api-response': 'response',
  './business-model': 'model',
  './BusinessAdministration': 'administration',
  './BusinessWorkflows': 'workflows',
  './BusinessRecordDate': 'date',
  './BusinessRecordFiles': 'files',
};
source = source
  .replace(/import ['"]\.\/business\.css['"];?/g, '')
  .replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_all, names, path) =>
      `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1:$2')}}=globalThis.__probe.${sources[path]};`,
  )
  .replace('export function BusinessOperations', 'function BusinessOperations');
const Component = new Function(source + '\nreturn Insights;')();
const render = () => {
  cursor = 0;
  effects = [];
  const tree = Component({ context });
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
const button = (tree, label) =>
  nodes(tree).find(n => n.type === 'button' && text(n).trim() === label);

const tick = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
const section = tree =>
  nodes(tree).find(n => n.type === 'section' && n.props.className === 'bo-panel bo-records');
const dataset = tree =>
  nodes(tree).find(
    n =>
      n.type === 'select' &&
      nodes(n).some(o => o.type === 'option' && text(o) === 'All submissions'),
  );
let tree = render();
await tick();
tree = render();
assert.ok(section(tree));
assert.ok(
  !text(tree).includes('People on This Page by Current Credentials'),
  'Records view does not stack all charts',
);
assert.ok(!text(tree).includes('Top Certified Resources & Leaderboard'));
assert.ok(!text(tree).includes('Month-wise Certification & Submission Growth'));
button(tree, 'Overview').props.onClick();
tree = render();
assert.equal(button(tree, 'Overview').props.className.includes('active'), true);
assert.ok(!text(tree).includes('People on This Page by Current Credentials'));
assert.ok(!section(tree), 'Overview is compact and records are a separate view');
button(tree, 'People & records').props.onClick();
tree = render();
assert.ok(section(tree));
assert.ok(!text(tree).includes('L2 · Working'));

dataset(tree).props.onChange({ target: { value: 'certifications' } });
tree = render();
await tick();
assert.ok(section(tree), 'Records and filters remain mounted during loading');
assert.equal(section(tree).props['aria-busy'], true);
assert.equal(dataset(tree).props.value, 'certifications');
assert.ok(!nodes(tree).some(n => n.props.className === 'bo-skeleton'));
assert.equal(button(tree, 'CSV').props.disabled, true);
assert.ok(nodes(section(tree)).some(n => n.props['aria-hidden'] === true));
dataset(tree).props.onChange({ target: { value: 'skills' } });
tree = render();
await tick();
assert.equal(deferred[0].signal.aborted, true);
deferred[0].resolve(json(dashboard('Late stale employee')));
await tick();
tree = render();
assert.ok(!text(tree).includes('Late stale employee'));
deferred[1].resolve(json(dashboard('Current employee')));
await tick();
tree = render();
assert.ok(text(tree).includes('Current employee'));
assert.equal(section(tree).props['aria-busy'], false);
assert.equal(button(tree, 'CSV').props.disabled, false);
dataset(tree).props.onChange({ target: { value: 'certifications' } });
tree = render();
await tick();
deferred[2].resolve(json({ error: { message: 'Access revoked' } }, 403));
await tick();
tree = render();
assert.ok(!text(tree).includes('Current employee'));
assert.ok(text(tree).includes('Access revoked'));

params = new URLSearchParams('tab=insights&dataset=people&minRank=2&validity=15_30');
tree = render();
await tick();
const rankSelector = nodes(tree).find(n => n.type === 'select' && n.props.value === '2_4');
assert.ok(rankSelector, 'Minimum-only rank links keep their selected range visible');
assert.ok(text(tree).includes('Minimum rank'), 'Minimum-only filters retain a removable chip');
const upperValidity = nodes(tree).find(
  n =>
    n.type === 'select' &&
    nodes(n).some(o => o.type === 'option' && text(o) === 'Current & active'),
);
assert.equal(upperValidity.props.value, '15_30');
assert.ok(nodes(upperValidity).some(n => n.type === 'option' && n.props.value === '15_30'));
const empty = dashboard('Empty workforce');
empty.summary.employees = 0;
empty.rows = [];
empty.total = 0;
deferred[3].resolve(json(empty));
await tick();
tree = render();
assert.ok(
  !nodes(tree).some(n => n.props.className === 'bo-population-metric'),
  'Duplicate population gauge stays removed, including an empty workforce',
);
assert.ok(text(tree).includes('No matching records'));
console.log('Business filter lifecycle regressions passed');
