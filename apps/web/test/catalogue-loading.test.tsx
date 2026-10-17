import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const settle = () => new Promise(resolve => setImmediate(resolve));
test('catalogue starts initial/page/retry reads immediately while debouncing search and rejecting cancelled results', async () => {
  const source = await readFile(new URL('../src/SkillCatalogue.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  useEffect(() => {', source.indexOf('const requestedSearch'));
  const effect = source.slice(start, source.indexOf('  function create()', start));
  const requestedSearch = { current: '' };
  const requests: { url: string; signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = [];
  let cleanup: (() => void) | undefined;
  let shown: unknown;
  function render(search = '', page = 1, attempt = 0) {
    cleanup?.();
    vm.runInNewContext(effect, {
      search,
      page,
      attempt,
      status: '',
      requestedSearch,
      AbortController,
      URLSearchParams,
      useEffect: (callback: () => () => void) => {
        cleanup = callback();
      },
      setLoading: () => {},
      setError: () => {},
      setState: (value: unknown) => {
        shown = value;
      },
      setTimeout: (callback: () => void, ms: number) => {
        const timer = { callback, ms, cancelled: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer: (typeof timers)[number]) => {
        timer.cancelled = true;
      },
      authenticatedFetch: (url: string, { signal }: { signal: AbortSignal }) =>
        new Promise(resolve => requests.push({ url, signal, resolve })),
      responseBody: (value: unknown) => value,
    });
    return timers.at(-1)!;
  }
  const first = render();
  assert.equal(first.ms, 0);
  first.callback();
  requests[0].resolve('initial');
  await settle();
  assert.equal(shown, 'initial');
  const page = render('', 2);
  assert.equal(page.ms, 0);
  page.callback();
  assert.match(requests[1].url, /page=2/);
  const retry = render('', 2, 1);
  assert.equal(retry.ms, 0);
  const old = render('old');
  assert.equal(old.ms, 200);
  const typing = render('new');
  assert.equal(old.cancelled, true);
  assert.equal(requests.length, 2, 'cancelled search timers make no requests');
  assert.equal(typing.ms, 200);
  typing.callback();
  assert.match(requests[2].url, /search=new/);
  const latest = render('newest');
  latest.callback();
  assert.equal(requests[2].signal.aborted, true);
  requests[3].resolve('newest');
  await settle();
  requests[2].resolve('stale');
  await settle();
  assert.equal(shown, 'newest', 'late replies cannot overwrite the current search');
  const nextPage = render('newest', 2);
  assert.equal(nextPage.ms, 0, 'paging through the settled search does not add another debounce');
  cleanup?.();
});
