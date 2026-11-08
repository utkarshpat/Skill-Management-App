import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { normalize, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { mergeScriptCovs } = require('@bcoe/v8-coverage');
const { createCoverageMap } = require('istanbul-lib-coverage');
const v8toIstanbul = require('v8-to-istanbul');

// A URL may run as both ESM and CommonJS. Their generated offsets are different.
// Node's per-process source-map cache keeps only one map per URL, so first collect
// variants across processes and identify each script by its generated length.
export async function remapV8Coverage(reports, files) {
  const inventory = new Set(files.map(file => resolve(file)));
  const variants = new Map();
  const pathFor = url => {
    try {
      return normalize(fileURLToPath(url));
    } catch {
      return undefined;
    }
  };
  for (const report of reports) {
    for (const [url, cached] of Object.entries(report['source-map-cache'] ?? {})) {
      const path = pathFor(url);
      if (!inventory.has(path) || !cached.data || !cached.lineLengths) continue;
      const values = variants.get(path) ?? new Map();
      values.set(JSON.stringify(cached), cached);
      variants.set(path, values);
    }
  }
  const groups = new Map();
  for (const report of reports)
    for (const script of report.result ?? []) {
      const path = pathFor(script.url);
      if (!inventory.has(path)) continue;
      const length = Math.max(
        ...script.functions.flatMap(fn => fn.ranges.map(range => range.endOffset)),
      );
      const choices = [...(variants.get(path)?.values() ?? [])].filter(
        cached => cached.lineLengths.reduce((sum, line) => sum + line + 1, -1) === length,
      );
      if (choices.length > 1) throw Error('Ambiguous generated source maps: ' + path);
      const cached = choices[0];
      if (!cached && length !== readFileSync(path, 'utf8').length)
        throw Error('Missing matching generated source map: ' + path);
      const key = JSON.stringify([path, cached ?? null]);
      const group = groups.get(key) ?? { path, cached, scripts: [] };
      group.scripts.push({ ...script, url: path });
      groups.set(key, group);
    }
  const map = createCoverageMap({});
  for (const { path, cached, scripts } of groups.values()) {
    const sources = cached
      ? {
          sourceMap: { sourcemap: cached.data },
          source: cached.lineLengths.map(length => '.'.repeat(length)).join('\n'),
        }
      : undefined;
    const converter = v8toIstanbul(path, 0, sources);
    await converter.load();
    converter.applyCoverage(mergeScriptCovs(scripts).functions);
    for (const [source, coverage] of Object.entries(converter.toIstanbul())) {
      if (!inventory.has(normalize(source)))
        throw Error('Source map escaped production inventory: ' + source);
      map.merge({ [source]: coverage });
    }
  }
  // Keep the same complete physical-source denominator, including never-imported files.
  for (const path of inventory)
    if (!map.files().includes(path)) {
      const converter = v8toIstanbul(path, 0);
      await converter.load();
      converter.applyCoverage([
        {
          functionName: '(empty-report)',
          ranges: [{ startOffset: 0, endOffset: readFileSync(path, 'utf8').length, count: 0 }],
          isBlockCoverage: true,
        },
      ]);
      map.merge(converter.toIstanbul());
    }
  return map;
}

export async function readRemappedV8Coverage(directory, files) {
  const reports = readdirSync(directory)
    .filter(name => /^coverage-.*\.json$/.test(name))
    .sort()
    .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')));
  if (!reports.length) throw Error('No raw V8 reports found: ' + directory);
  return remapV8Coverage(reports, files);
}
