import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const composer = () =>
  fs.readFile(new URL('../src/capabilities/CapabilityComposer.tsx', import.meta.url), 'utf8');
const compile = (source: string) => transformSync(source, { loader: 'tsx' }).code;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('catalogue browsing advances through all pages, retries the failed page and ignores cancelled search results', async () => {
  const source = await composer();
  const start = source.indexOf(
    '  useEffect(() => {',
    source.indexOf('}, [submissionId, bootstrapAttempt]);'),
  );
  const effect = compile(source.slice(start, source.indexOf('  async function autofill(', start)));
  const moreStart = source.indexOf('setCataloguePage(loadedCataloguePage.current + 1);');
  const moreEnd = source.indexOf('setCatalogueAttempt(v => v + 1);', moreStart);
  const more = compile(
    source.slice(moreStart, moreEnd + 'setCatalogueAttempt(v => v + 1);'.length),
  );
  const searchStart = source.indexOf('setQuery(e.target.value);');
  const searchEnd = source.indexOf('setSearching(true);', searchStart);
  const search = compile(source.slice(searchStart, searchEnd + 'setSearching(true);'.length));
  const state = {
    page: 1,
    query: '',
    attempt: 0,
    options: [] as { id: string }[],
    total: 0,
    error: '',
  };
  const loaded = { current: 0 };
  const requests: string[] = [];
  let failPage = 3;
  let delayed: ((value: unknown) => void) | undefined;
  let delayNext = false;
  const setters = {
    loadedCataloguePage: loaded,
    setSearching: () => {},
    setCatalogueError: (v: string) => (state.error = v),
    setCatalogueTotal: (v: number) => (state.total = v),
    setCataloguePage: (v: number) => (state.page = v),
    setCatalogueAttempt: (f: (v: number) => number) => (state.attempt = f(state.attempt)),
    setQuery: (v: string) => (state.query = v),
    setOptions: (v: any) => (state.options = typeof v === 'function' ? v(state.options) : v),
  };
  async function readPage() {
    let timer: () => void = () => {};
    let cleanup: () => void = () => {};
    vm.runInNewContext(effect, {
      ...setters,
      AbortController,
      query: state.query,
      cataloguePage: state.page,
      catalogueAttempt: state.attempt,
      useEffect: (fn: () => () => void) => (cleanup = fn()),
      setTimeout: (fn: () => void) => {
        timer = fn;
        return 1;
      },
      clearTimeout: () => {},
      json: async (path: string) => {
        const query = new URL(path, 'https://fixture.invalid').searchParams;
        const page = Number(query.get('page'));
        requests.push(`${query.get('search')}:${page}`);
        if (delayNext) {
          delayNext = false;
          return new Promise(resolve => (delayed = resolve));
        }
        if (page === failPage) {
          failPage = 0;
          throw Error('Temporary catalogue failure');
        }
        return {
          total: 36,
          skills: Array.from({ length: 12 }, (_, i) => ({
            id: `${query.get('search')}-${(page - 1) * 12 + i}`,
          })),
        };
      },
    });
    timer();
    await flush();
    return cleanup;
  }
  await readPage();
  vm.runInNewContext(more, setters);
  await readPage();
  vm.runInNewContext(more, setters);
  await readPage();
  assert.equal(loaded.current, 2);
  assert.equal(state.options.length, 24);
  assert.match(state.error, /Temporary/);
  vm.runInNewContext(more, setters);
  await readPage();
  assert.deepEqual(requests, [':1', ':2', ':3', ':3']);
  assert.equal(loaded.current, 3);
  assert.equal(state.options.length, 36);
  assert.equal(new Set(state.options.map(o => o.id)).size, 36);
  vm.runInNewContext(search, { ...setters, e: { target: { value: 'old' } } });
  delayNext = true;
  const cancelOld = await readPage();
  cancelOld();
  vm.runInNewContext(search, { ...setters, e: { target: { value: 'new' } } });
  assert.equal(loaded.current, 0);
  await readPage();
  delayed!({ total: 1, skills: [{ id: 'stale' }] });
  await flush();
  assert.equal(loaded.current, 1);
  assert.equal(state.total, 36);
  assert.ok(state.options.every(o => o.id.startsWith('new-')));
});

test('uncertain-save reconciliation stays locked on ambiguous reads, safely handles initial absence and prevents overlapping reads', async () => {
  const source = await composer();
  const start = source.indexOf('  async function recover()');
  const code = compile(
    source.slice(start, source.indexOf('  const certificateFieldsUI', start)) + '\nrecover();',
  );
  const state = {
    recovery: true,
    busy: false,
    error: '',
    restored: 0,
    cleared: 0,
    completed: 0,
    reads: 0,
  };
  const lock = { current: false },
    version = { current: 2 },
    mounted = { current: true };
  const request: { current?: AbortController } = {};
  let mode: number | string = 503;
  let resolveRead: ((v: unknown) => void) | undefined;
  const scope: any = {
    AbortController,
    busy: false,
    uploadBusy: false,
    initializing: false,
    personalReady: true,
    lock,
    version,
    mounted,
    request,
    submissionId: 'saved',
    id: { current: 'same-id' },
    root: '/api/capability-submissions',
    setBusy: (v: boolean) => (state.busy = v),
    setRecovery: (v: boolean) => (state.recovery = v),
    setError: (v: string) => (state.error = v),
    setPendingEvidence: () => state.cleared++,
    sync: (_v: unknown, restore: boolean) => {
      assert.equal(restore, true);
      state.restored++;
    },
    toast: { info: () => {} },
    onSaved: () => state.completed++,
    json: async (path: string, _body: unknown, signal: AbortSignal) => {
      state.reads++;
      assert.equal(path, '/api/capability-submissions/same-id');
      assert.equal(signal, request.current?.signal);
      if (mode === 'defer') return new Promise(resolve => (resolveRead = resolve));
      if (typeof mode === 'number')
        throw Object.assign(Error('Read unavailable'), { status: mode });
      if (mode === 'network') throw Error('Connection failed');
      return { status: mode };
    },
  };
  for (mode of [503, 401, 403, 404, 200, 'network', 'UNKNOWN']) {
    await vm.runInNewContext(code, scope);
    assert.equal(state.recovery, true);
    assert.equal(state.cleared, 0);
    assert.match(state.error, /still unconfirmed/);
    assert.equal(lock.current, false);
  }
  version.current = 0;
  scope.submissionId = undefined;
  mode = 503;
  await vm.runInNewContext(code, scope);
  assert.equal(state.recovery, true);
  mode = 404;
  await vm.runInNewContext(code, scope);
  assert.equal(state.recovery, false);
  assert.match(state.error, /No submission was saved/);
  assert.equal(state.cleared, 0);
  state.recovery = true;
  mode = 'defer';
  const pending = vm.runInNewContext(code, scope);
  const readCount = state.reads;
  await vm.runInNewContext(code, scope);
  assert.equal(state.reads, readCount);
  resolveRead!({ status: 'DRAFT' });
  await pending;
  assert.equal(state.restored, 1);
  assert.equal(state.cleared, 1);
  assert.equal(state.recovery, false);
  for (mode of ['SUBMITTED', 'REVIEWED', 'LINKED']) await vm.runInNewContext(code, scope);
  assert.equal(state.completed, 3);
  mode = 'defer';
  const cancelled = vm.runInNewContext(code, scope);
  request.current!.abort();
  mounted.current = false;
  resolveRead!({ status: 'DRAFT' });
  await cancelled;
  assert.equal(state.restored, 1);
});

test('repeat submission and certificate notifications open once per navigation without reopening after background refresh', async () => {
  const target = '00000000-0000-4000-8000-000000000002';
  for (const kind of ['submission', 'record', 'renew', 'certification']) {
    const source = await fs.readFile(
      new URL(
        `../src/capabilities/${kind === 'submission' ? 'CapabilitySubmissions' : 'SkillCertificates'}.tsx`,
        import.meta.url,
      ),
      'utf8',
    );
    const start = source.indexOf('  useEffect(() => {\n    const target = params.get(');
    const end = source.indexOf(kind === 'submission' ? '  const done =' : '  const close =', start);
    assert.ok(start > 0 && end > start);
    const code = compile(source.slice(start, end));
    const consumed = { current: '' },
      location = { key: 'first-click' };
    const opens: string[] = [];
    const scope = {
      params: new URLSearchParams({ [kind]: target }),
      consumed,
      location,
      enabled: true,
      data: {},
      loading: false,
      records: [] as { id: string }[],
      useEffect: (fn: () => void) => fn(),
      setOpened: (id: string) => opens.push(id),
      open: (id: string, renewal: boolean) => {
        assert.equal(renewal, kind === 'renew');
        opens.push(id);
      },
    };
    vm.runInNewContext(code, scope);
    if (kind === 'submission') {
      assert.equal(opens.length, 0);
      scope.records = [{ id: target }];
      vm.runInNewContext(code, scope);
    }
    assert.equal(opens.length, 1);
    // Closing does not change the navigation; background refresh must not reopen it.
    vm.runInNewContext(code, scope);
    assert.equal(opens.length, 1);
    location.key = 'second-click';
    vm.runInNewContext(code, scope);
    assert.deepEqual(opens, [target, target]);
    vm.runInNewContext(code, scope);
    assert.equal(opens.length, 2);
  }
});
