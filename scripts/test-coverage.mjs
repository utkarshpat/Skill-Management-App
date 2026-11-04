import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const label = process.argv.includes('--baseline') ? 'baseline' : 'current';
const output = join(root, 'artifacts/coverage', label);
mkdirSync(output, { recursive: true });
const results = [];
for (const app of ['api', 'web']) {
  const cwd = join(root, 'apps', app),
    destination = join(output, app);
  mkdirSync(destination, { recursive: true });
  const suffix = app === 'api' ? '.test.ts' : '.test.tsx';
  const tests = readdirSync(join(cwd, 'test'))
    .filter(name => name.endsWith(suffix))
    .sort()
    .map(name => 'test/' + name);
  console.log(`Coverage ${label}: ${app}, ${tests.length} test files`);
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
  };
  results.push(row);
  console.log(JSON.stringify(row));
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
      results,
    },
    null,
    2,
  ),
);
if (results.some(row => row.exitCode !== 0 || row.failed || row.measuredFiles !== row.sourceFiles))
  process.exitCode = 1;
