import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

test('saved-draft bootstrap stays locked on failure or locked status, supports retry and ignores cancellation', async () => {
  const source = await fs.readFile(
    new URL('../src/capabilities/CapabilityComposer.tsx', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('    async function bootstrap()'),
    end = source.indexOf('    void bootstrap();', start);
  const code = transformSync(source.slice(start, end) + '\nbootstrap();', { loader: 'ts' }).code;
  const state = { ready: false, initializing: true, error: '', restored: 0 };
  let mode = 'fail';
  const abort = new AbortController();
  const scope: any = {
    abort,
    root: '/api/capability-submissions',
    submissionId: 'saved',
    renewal: undefined,
    initialSkill: undefined,
    initialSkillDraft: undefined,
    json: async (path: string) => {
      if (path.endsWith('/availability')) return { aiAvailable: true, fileAvailable: true };
      if (path.endsWith('/options')) return { claims: [], certifications: [], definitions: [] };
      if (mode === 'fail') throw Error('Temporary read failure');
      if (mode === 'cancel') abort.abort();
      return { status: mode === 'locked' ? 'SUBMITTED' : 'DRAFT' };
    },
    sync: () => state.restored++,
    setPersonalReady: (v: boolean) => (state.ready = v),
    setInitializing: (v: boolean) => (state.initializing = v),
    setError: (v: string) => (state.error = v),
  };
  for (const setter of [
    'setAiAvailable',
    'setFileAvailable',
    'setOwnClaims',
    'setOwnCertificates',
    'setDefinitions',
  ])
    scope[setter] = () => {};
  await vm.runInNewContext(code, scope);
  assert.equal(state.ready, false);
  assert.equal(state.initializing, false);
  assert.equal(state.restored, 0);
  mode = 'locked';
  await vm.runInNewContext(code, scope);
  assert.equal(state.ready, false);
  assert.match(state.error, /already locked/);
  mode = 'success';
  await vm.runInNewContext(code, scope);
  assert.equal(state.ready, true);
  assert.equal(state.restored, 1);
  assert.equal(state.error, '');
  mode = 'cancel';
  await vm.runInNewContext(code, scope);
  assert.equal(state.ready, false);
  assert.equal(state.restored, 1);
});
