import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = await fs.readFile(
  new URL('../src/capabilities/CapabilitySubmissions.tsx', import.meta.url),
  'utf8',
);
const start = source.lastIndexOf(
  '  useEffect(() => {',
  source.indexOf("const target = params.get('submission')"),
);
const code = transformSync(source.slice(start, source.indexOf('  const done =', start)), {
  loader: 'tsx',
}).code;
const id = '10000000-0000-4000-8000-0000000000ab';

test('notification links can open submissions outside the recent list, once per navigation', () => {
  const opened: string[] = [];
  const consumed = { current: undefined };
  const render = (loading: boolean, key = 'first') =>
    vm.runInNewContext(code, {
      useEffect: (effect: () => void) => effect(),
      params: new URLSearchParams({ submission: id.toUpperCase() }),
      location: { key },
      consumed,
      loading,
      records: Array.from({ length: 50 }, (_, index) => ({ id: `recent-${index}` })),
      setOpened: (value: string) => opened.push(value),
    });
  render(true);
  assert.deepEqual(opened, [], 'Wait for the list so listed editable drafts use their editor');
  render(false);
  assert.deepEqual(opened, [id], 'A bounded recent list must not disable older notification links');
  render(false);
  assert.deepEqual(opened, [id], 'Closing the dialog must not reopen it on a list refresh');
  render(false, 'second');
  assert.deepEqual(opened, [id, id]);
});

test('malformed submission links cannot open a detail request', () => {
  for (const value of ['', '../options', 'not-a-uuid']) {
    vm.runInNewContext(code, {
      useEffect: (effect: () => void) => effect(),
      params: new URLSearchParams({ submission: value }),
      location: { key: 'first' },
      consumed: { current: undefined },
      loading: false,
      records: [],
      setOpened: () => assert.fail('Malformed link opened'),
    });
  }
});
