import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSources, imports } from './check-architecture.mjs';

const access = 'apps/api/src/modules/access/';
const identity = 'apps/api/src/modules/identity/';
const ai = 'apps/api/src/modules/ai/';
const shared = 'apps/api/src/shared/';
const web = 'apps/web/src/';
const fixture = (...entries) => new Map(entries);

test('public module contracts pass; private adapters and re-exports are rejected', () => {
  const sources = fixture([ai + 'assistant.ts', "import { can } from '../access/index.js';"], [access + 'index.ts', ''], [access + 'sql-access-store.ts', '']);
  assert.deepEqual(checkSources(sources), []);
  sources.set(ai + 'assistant.ts', "export { SqlAccessStore } from '../access/sql-access-store.js';");
  assert.ok(checkSources(sources).some(error => error.includes('public index')));
});

test('shared infrastructure and modules cannot reach composition roots or the other app', () => {
  const sources = fixture([shared + 'database.ts', "import '../modules/access/index.js';"], [access + 'index.ts', "import '../../app.js';"], ['apps/api/src/app.ts', ''], [web + 'App.tsx', "import '../../api/src/modules/access/index.js';"]);
  const errors = checkSources(sources);
  assert.ok(errors.some(error => error.includes('shared infrastructure')));
  assert.ok(errors.some(error => error.includes('composition roots')));
  assert.ok(errors.some(error => error.includes('frontend cannot')));
});

test('identity contracts can be type-only dependencies without introducing runtime cycles', () => {
  const sources = fixture([access + 'routes.ts', "import type { Identity } from '../identity/index.js';"], [identity + 'index.ts', '']);
  assert.deepEqual(checkSources(sources), []);
  sources.set(access + 'routes.ts', "import { tokenVerifier } from '../identity/index.js';");
  assert.ok(checkSources(sources).some(error => error.includes('declared module graph')));
});

test('literal dynamic imports, import types and require cannot bypass private boundaries', () => {
  for (const statement of ["import('../access/private.js')", "type T = import('../access/private.js').Store", "require('../access/private.js')"]) {
    const sources = fixture([ai + 'assistant.ts', statement], [access + 'private.ts', '']);
    assert.ok(checkSources(sources).some(error => error.includes('public index')));
  }
  assert.ok(checkSources(fixture([ai + 'assistant.ts', 'import(destination)'])).some(error => error.includes('computed')));
  assert.ok(checkSources(fixture([ai + 'assistant.ts', "import('../access/index.js' + suffix)"])).some(error => error.includes('computed')));
});

test('comments, strings and import.meta are ignored; missing imports and app aliases fail', () => {
  assert.deepEqual(imports("// import '../access/private.js'\nconst label = \"import('../access/private.js')\"; /* export * from '../access/private.js'; */ const url = import.meta.url;"), []);
  assert.ok(checkSources(fixture([ai + 'assistant.ts', "import './missing.js';"])).some(error => error.includes('missing')));
  assert.ok(checkSources(fixture([web + 'App.tsx', "import '@capability/api';"])).some(error => error.includes('HTTP')));
});
