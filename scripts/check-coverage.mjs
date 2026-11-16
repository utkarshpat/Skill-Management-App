import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { coverageSource } from './coverage-source.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const threshold = 90;
const pathKey = value => {
  const absolute = resolve(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
};
const results = [];
for (const [app, report] of [
  ['api', 'artifacts/coverage/current/api/coverage-summary.json'],
  ['web', 'artifacts/coverage/combined-web/coverage-summary.json'],
]) {
  try {
    const inventory = coverageSource(join(root, 'apps', app, 'src'));
    const unit = JSON.parse(
      readFileSync(join(root, 'artifacts/coverage/current', app, 'run.json'), 'utf8'),
    );
    if (
      unit.sourceHash !== inventory.hash ||
      !unit.stableSource ||
      unit.exitCode !== 0 ||
      unit.failed
    )
      throw Error('Unit coverage is stale, failed or missing for current production source.');
    if (app === 'web') {
      const merged = JSON.parse(
        readFileSync(join(root, 'artifacts/coverage/combined-web/summary.json'), 'utf8'),
      );
      const run = JSON.parse(readFileSync(join(root, 'artifacts/e2e/results.json'), 'utf8'));
      if (
        !merged.browserStartTime ||
        unit.mapping !== 'generated-variant-before-source-merge-v1' ||
        merged.mapping !== unit.mapping ||
        merged.unitCompletedAt !== unit.completedAtUtc ||
        merged.sourceHash !== inventory.hash ||
        merged.browserStartTime !== run.stats?.startTime ||
        run.errors?.length ||
        run.stats.unexpected ||
        run.stats.skipped
      )
        throw Error('Web coverage must come from the current complete passing browser run.');
    }
    const summary = JSON.parse(readFileSync(join(root, report), 'utf8'));
    const sourcePaths = readdirSync(join(root, 'apps', app, 'src'), {
      recursive: true,
      withFileTypes: true,
    })
      .filter(e => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts'))
      .map(e => pathKey(join(e.parentPath, e.name)));
    const sourceFiles = sourcePaths.length;
    const reportPaths = new Set(
      Object.keys(summary)
        .filter(name => name !== 'total')
        .map(pathKey),
    );
    const missingFiles = sourcePaths.filter(name => !reportPaths.has(name));
    const productionPaths = new Set(sourcePaths);
    const unexpectedFiles = [...reportPaths].filter(name => !productionPaths.has(name));
    const represented = Object.keys(summary).length - 1;
    const metrics = Object.fromEntries(
      ['lines', 'statements', 'branches', 'functions'].map(metric => {
        const counter = summary.total[metric];
        const percentage = counter.total > 0 ? (100 * counter.covered) / counter.total : 0;
        return [
          metric,
          { percentage: Number(percentage.toFixed(2)), passed: percentage >= threshold },
        ];
      }),
    );
    results.push({
      app,
      sourceFiles,
      represented,
      missingFiles,
      unexpectedFiles,
      metrics,
      passed:
        missingFiles.length === 0 &&
        unexpectedFiles.length === 0 &&
        Object.values(metrics).every(value => value.passed),
    });
  } catch (error) {
    results.push({ app, passed: false, error: String(error) });
  }
}
console.log(JSON.stringify({ threshold, results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
