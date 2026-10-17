import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { readApiResponse } from '../src/api-response';

const source = await fs.readFile(
  new URL('../src/capabilities/SkillCertificates.tsx', import.meta.url),
  'utf8',
);
const start = source.indexOf('  useEffect(() => {\n    const abort = new AbortController();');
const code = transformSync(source.slice(start, source.indexOf('  async function open(', start)), {
  loader: 'tsx',
}).code;
const openStart = source.indexOf('  async function open(');
const openCode = transformSync(
  source.slice(openStart, source.indexOf('  useEffect(() => {', openStart)) +
    "\nopen('certificate');",
  { loader: 'tsx' },
).code;

async function refreshFailure(status?: number) {
  const detailRequest = { current: new AbortController() };
  const draft = { id: 'draft', notes: 'Unsaved work' };
  const state = {
    editing: draft as typeof draft | undefined,
    viewing: draft as typeof draft | undefined,
    opening: true,
    error: '',
    data: {} as unknown,
  };
  let cleanup = () => {};
  let finishDetail!: (response: Response) => void;
  const scope = {
    AbortController,
    enabled: true,
    attempt: 1,
    detailRequest,
    useEffect: (effect: () => () => void) => {
      cleanup = effect();
    },
    setLoading: () => {},
    setError: (value: string) => {
      state.error = value;
    },
    setData: (value: unknown) => {
      state.data = value;
    },
    setViewing: (value: typeof draft | undefined) => {
      state.viewing = value;
    },
    setEditing: (value: typeof draft | undefined) => {
      state.editing = value;
    },
    setOpening: (value: boolean) => {
      state.opening = value;
    },
    setDetailError: () => {},
    authenticatedFetch: async () =>
      new Promise<Response>(resolve => {
        finishDetail = resolve;
      }),
    readApiResponse,
    loadCertificationPortfolio: async () => {
      throw Object.assign(Error('Refresh failed'), { status });
    },
  };
  // Transport deliberately ignores abort to reproduce a response that finishes late.
  const pendingDetail = vm.runInNewContext(openCode, scope);
  vm.runInNewContext(code, scope);
  await new Promise(resolve => setImmediate(resolve));
  finishDetail(Response.json({ record: draft }));
  await pendingDetail;
  cleanup();
  return { state, detailRequest, draft };
}

test('transient background certificate failures preserve the open editor and unsaved entries', async () => {
  for (const status of [undefined, 500, 503]) {
    const { state, draft } = await refreshFailure(status);
    assert.equal(state.editing, draft);
    assert.equal(state.error, 'Refresh failed');
    assert.equal(
      state.data,
      undefined,
      'Failed portfolio data must not advertise current authority',
    );
  }
});

test('denied certificate refresh closes dialogs and cancels detail reads that could reopen them', async () => {
  for (const status of [401, 403]) {
    const { state, detailRequest } = await refreshFailure(status);
    assert.equal(state.editing, undefined);
    assert.equal(state.viewing, undefined);
    assert.equal(state.opening, false);
    assert.equal(detailRequest.current.signal.aborted, true);
  }
});
