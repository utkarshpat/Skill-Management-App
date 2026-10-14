import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { transform } from 'rolldown/experimental';
import * as jsx from 'react/jsx-runtime';
import { readApiResponse } from '../../src/api-response.ts';
import * as labels from '../../src/business/people-search-prompt.ts';
let slots = [],
  cursor = 0,
  effects = [],
  requests = [];
const react = {
  useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [slots[i], v => (slots[i] = typeof v === 'function' ? v(slots[i]) : v)];
  },
  useRef(initial) {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  },
  useEffect(callback, deps) {
    const i = cursor++,
      old = slots[i];
    if (!old || deps.some((d, j) => d !== old.deps[j])) {
      old?.cleanup?.();
      const next = { deps };
      slots[i] = next;
      effects.push(() => (next.cleanup = callback()));
    }
  },
};
globalThis.__peopleProbe = {
  react,
  jsx,
  auth: {
    authenticatedFetch: (url, options) =>
      new Promise(resolve => requests.push({ url, options, resolve })),
  },
  response: { readApiResponse },
  dialog: { FormDialog: () => null },
  labels,
};
let source = (
  await transform(
    'AssistantPeopleResults.tsx',
    await fs.readFile(
      new URL('../../src/business/AssistantPeopleResults.tsx', import.meta.url),
      'utf8',
    ),
    { jsx: { runtime: 'automatic' } },
  )
).code;
const imports = {
  react: 'react',
  'react/jsx-runtime': 'jsx',
  '../auth': 'auth',
  '../api-response': 'response',
  '../FormDialog': 'dialog',
  './people-search-prompt': 'labels',
};
source = source
  .replace(/import ['"]\.\/people-search\.css['"];?/g, '')
  .replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_all, names, path) =>
      `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1:$2')}}=globalThis.__peopleProbe.${imports[path]};`,
  )
  .replace('export function AssistantPeopleResults', 'function AssistantPeopleResults');
const Component = new Function(source + '\nreturn AssistantPeopleResults;')();
const query = {
  skills: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', minRank: 2 }],
  certifications: [],
  headcount: 1,
  onlyEligible: false,
  page: 1,
};
const render = () => {
  cursor = 0;
  effects = [];
  const tree = Component({ query });
  for (const e of effects) e();
  return tree;
};
const walk = x => {
  if (!x || typeof x !== 'object') return [];
  if (Array.isArray(x)) return x.flatMap(walk);
  return [x, ...walk(x.props?.children), ...walk(x.props?.footer)];
};
const text = x => {
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (!x || typeof x !== 'object') return '';
  if (Array.isArray(x)) return x.map(text).join(' ');
  return text(x.props?.children) + ' ' + text(x.props?.footer);
};
const settle = () => new Promise(resolve => setImmediate(resolve));
render();
assert.equal(requests.length, 1);
requests[0].resolve(
  Response.json({
    context: { canExport: true, asOf: '2026-10-14', scopes: [] },
    requirements: [],
    required: 1,
    eligibleTotal: 1,
    total: 1,
    page: 1,
    pageSize: 25,
    rows: [
      {
        id: 'person',
        employee: 'Previously allowed person',
        employeeCode: 'DEMO-1',
        matched: 1,
        eligible: true,
        criteria: [],
      },
    ],
  }),
);
await settle();
let tree = render();
assert.match(text(tree), /Previously allowed person/);
const view = walk(tree).find(x => x.type === 'button' && x.props?.children === 'View results');
assert.ok(view);
view.props.onClick();
tree = render();
assert.equal(requests.length, 2);
assert.doesNotMatch(text(tree), /Previously allowed person/);
assert.match(text(tree), /Checking current matching records/);
requests[1].resolve(
  Response.json({ error: { message: 'Matching access changed.' } }, { status: 403 }),
);
await settle();
tree = render();
assert.match(text(tree), /Matching access changed/);
assert.doesNotMatch(text(tree), /Previously allowed person|CSV|Excel/);
assert.ok(walk(tree).find(x => x.type === 'input' && x.props.type === 'checkbox'));
console.log('People result opening rechecks current authority and hides stale rows/actions.');
