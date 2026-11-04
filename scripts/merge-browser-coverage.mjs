import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize, relative } from 'node:path';
const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const { createContext } = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const root = fileURLToPath(new URL('../', import.meta.url)),
  output = join(root, 'artifacts/coverage/combined-web');
mkdirSync(output, { recursive: true });
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
for (const file of files)
  merge(JSON.parse(readFileSync(join(root, 'artifacts/coverage/browser', file), 'utf8')));
const context = createContext({ dir: output, coverageMap: map });
for (const name of ['html', 'json', 'json-summary', 'lcovonly'])
  reports.create(name).execute(context);
const summary = map.getCoverageSummary().toJSON();
writeFileSync(
  join(output, 'summary.json'),
  JSON.stringify({ sourceFiles: map.files().length, coverage: summary }, null, 2),
);
console.log(JSON.stringify({ sourceFiles: map.files().length, coverage: summary }));
