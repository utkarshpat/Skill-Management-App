import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { coverageSource } from './coverage-source.mjs';
import { readRemappedV8Coverage } from './remap-v8-coverage.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const root = fileURLToPath(new URL('../', import.meta.url));
const label = process.argv.includes('--baseline') ? 'baseline' : 'current';
const output = join(root, 'artifacts/coverage', label);
mkdirSync(output, { recursive: true });
const results = [];
const selection = process.argv.find(value => value.startsWith('--app='))?.slice(6);
if (selection && !['api', 'web'].includes(selection)) throw Error('Use --app=api or --app=web.');
const apps = selection ? [selection] : ['api', 'web'];
for (const app of apps) {
  const cwd = join(root, 'apps', app),
    destination = join(output, app);
  mkdirSync(destination, { recursive: true });
  const suffix = app === 'api' ? '.test.ts' : '.test.tsx';
  const tests = readdirSync(join(cwd, 'test'))
    .filter(name => name.endsWith(suffix))
    .sort()
    .map(name => 'test/' + name);
  console.log(`Coverage ${label}: ${app}, ${tests.length} test files`);
  const startedAtUtc = new Date().toISOString();
  const before = coverageSource(join(cwd, 'src'));
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/c8/bin/c8.js'),
      '--all',
      '--src=src',
      '--include=src/**',
      '--extension=.ts',
      '--extension=.tsx',
      '--exclude=**/*.d.ts',
      '--reporter=json-summary',
      '--reporter=json',
      '--reporter=lcov',
      '--reporter=html',
      `--reports-dir=${destination}`,
      process.execPath,
      '--import',
      'tsx',
      '--test',
      '--test-concurrency=4',
      ...tests,
    ],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        ...(app === 'web' ? { TSX_TSCONFIG_PATH: join(cwd, 'tsconfig.test.json') } : {}),
      },
    },
  );
  writeFileSync(join(destination, 'tests.log'), (result.stdout ?? '') + (result.stderr ?? ''));
  if (app === 'web') {
    const map = await readRemappedV8Coverage(join(destination, 'tmp'), before.files);
    const { createContext } = require('istanbul-lib-report');
    const reports = require('istanbul-reports');
    const context = createContext({ dir: destination, coverageMap: map });
    for (const name of ['json-summary', 'json', 'lcov', 'html'])
      reports.create(name).execute(context);
  }
  const coverage = JSON.parse(readFileSync(join(destination, 'coverage-summary.json'), 'utf8'));
  const sourceFiles = readdirSync(join(cwd, 'src'), {
    recursive: true,
    withFileTypes: true,
  }).filter(p => p.isFile() && /\.(ts|tsx)$/.test(p.name) && !p.name.endsWith('.d.ts'));
  const count = name => +(new RegExp(`(?:ℹ|#) ${name} (\\d+)`).exec(result.stdout ?? '')?.[1] ?? 0);
  const row = {
    app,
    exitCode: result.status,
    tests: count('tests'),
    passed: count('pass'),
    failed: count('fail'),
    sourceFiles: sourceFiles.length,
    measuredFiles: Object.keys(coverage).length - 1,
    coverage: coverage.total,
    sourceHash: before.hash,
    ...(app === 'web' ? { mapping: 'generated-variant-before-source-merge-v1' } : {}),
    stableSource: before.hash === coverageSource(join(cwd, 'src')).hash,
    startedAtUtc,
    completedAtUtc: new Date().toISOString(),
  };
  writeFileSync(join(destination, 'run.json'), JSON.stringify(row, null, 2));
  results.push(row);
  console.log(JSON.stringify(row));
}
let previous = [];
if (selection) {
  try {
    previous = JSON.parse(readFileSync(join(output, 'summary.json'), 'utf8')).results ?? [];
  } catch {
    /* First selected-app run has no previous result. */
  }
}
writeFileSync(
  join(output, 'summary.json'),
  JSON.stringify(
    {
      label,
      node: process.version,
      measuredAtUtc: new Date().toISOString(),
      denominator:
        'All production .ts/.tsx source; only .d.ts excluded; browser and SQL integration are separate.',
      selectedApps: apps,
      results: [...previous.filter(row => !apps.includes(row.app)), ...results],
    },
    null,
    2,
  ),
);
if (
  results.some(
    row =>
      row.exitCode !== 0 ||
      row.failed ||
      !row.stableSource ||
      row.measuredFiles !== row.sourceFiles,
  )
)
  process.exitCode = 1;
