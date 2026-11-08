import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize, relative } from 'node:path';
import { coverageSource } from './coverage-source.mjs';
const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const { createContext } = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const root = fileURLToPath(new URL('../', import.meta.url)),
  output = join(root, 'artifacts/coverage/combined-web');
mkdirSync(output, { recursive: true });
const inventory = coverageSource(join(root, 'apps/web/src'));
const unit = JSON.parse(
  readFileSync(join(root, 'artifacts/coverage/current/web/run.json'), 'utf8'),
);
if (
  unit.sourceHash !== inventory.hash ||
  !unit.stableSource ||
  unit.exitCode !== 0 ||
  unit.failed ||
  unit.mapping !== 'generated-variant-before-source-merge-v1'
)
  throw Error('Current passing web unit coverage is required before browser coverage is merged.');
const map = createCoverageMap({});
function merge(data) {
  for (const [key, file] of Object.entries(data)) {
    const path = normalize(key),
      rel = relative(join(root, 'apps/web/src'), path);
    if (rel.startsWith('..') || rel.endsWith('.d.ts') || !/\.(ts|tsx)$/.test(rel)) continue;
    file.path = path;
    map.merge({ [path]: file });
  }
}
merge(
  JSON.parse(
    readFileSync(join(root, 'artifacts/coverage/current/web/coverage-final.json'), 'utf8'),
  ),
);
const run = JSON.parse(readFileSync(join(root, 'artifacts/e2e/results.json'), 'utf8'));
const started = Date.parse(run.stats?.startTime),
  ended = started + run.stats?.duration;
if (!Number.isFinite(ended) || run.errors?.length || run.stats.unexpected || run.stats.skipped)
  throw Error('A complete passing browser run is required; coverage merge refused.');
if (inventory.files.some(source => statSync(source).mtimeMs > started))
  throw Error('Production source changed during/after the browser run; rerun browser tests.');
const files = [];
function visit(suite) {
  for (const spec of suite.specs ?? [])
    for (const item of spec.tests ?? []) {
      if (item.results?.at(-1)?.status !== 'passed')
        throw Error('Browser run contains a failed/skipped test; do not publish passing coverage.');
      files.push(`${item.projectName}-${spec.id}.json`);
    }
  for (const child of suite.suites ?? []) visit(child);
}
for (const suite of run.suites ?? []) visit(suite);
if (!files.length) throw Error('No browser test results; coverage merge refused.');
// Consume only this run's test IDs: stale files from removed/renamed tests cannot inflate coverage.
for (const file of files) {
  const path = join(root, 'artifacts/coverage/browser', file);
  const written = statSync(path).mtimeMs;
  if (written < started - 1000 || written > ended + 1000)
    throw Error('Browser coverage belongs to another/in-progress run: ' + file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  for (const source of Object.keys(data))
    if (statSync(source).mtimeMs > started)
      throw Error('Production source changed during/after the browser run: ' + source);
  merge(data);
}
const context = createContext({ dir: output, coverageMap: map });
for (const name of ['html', 'json', 'json-summary', 'lcovonly'])
  reports.create(name).execute(context);
const summary = map.getCoverageSummary().toJSON();
writeFileSync(
  join(output, 'summary.json'),
  JSON.stringify(
    {
      sourceFiles: map.files().length,
      coverage: summary,
      browserStartTime: run.stats.startTime,
      sourceHash: inventory.hash,
      mapping: unit.mapping,
      unitCompletedAt: unit.completedAtUtc,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ sourceFiles: map.files().length, coverage: summary }));
