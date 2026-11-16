import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { remapV8Coverage } from './remap-v8-coverage.mjs';
const require = createRequire(import.meta.url);
const { transformSync } = require('esbuild');
test('different generated formats remap independently before merging, regardless of cache/report order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'coverage-remap-'));
  try {
    const file = join(dir, 'source.ts'),
      unseen = join(dir, 'unseen.ts');
    const source = 'export const alpha = () => 1;\nexport const beta = () => 2;\n';
    writeFileSync(file, source);
    writeFileSync(unseen, 'export const unused = () => 3;\n');
    const url = pathToFileURL(file).href;
    function variant(format, covered) {
      const output = transformSync(source, {
        loader: 'ts',
        format,
        sourcefile: file,
        sourcemap: 'external',
      });
      const cache = {
        data: JSON.parse(output.map),
        lineLengths: output.code.split('\n').map(line => line.length),
      };
      const functions = [
        {
          functionName: '',
          ranges: [{ startOffset: 0, endOffset: output.code.length, count: 1 }],
          isBlockCoverage: true,
        },
      ];
      for (const [name, value] of [
        ['alpha', '1'],
        ['beta', '2'],
      ]) {
        const start = output.code.indexOf('() => ' + value);
        assert.ok(start >= 0);
        functions.push({
          functionName: name,
          ranges: [{ startOffset: start, endOffset: start + 7, count: covered === name ? 1 : 0 }],
          isBlockCoverage: true,
        });
      }
      return { result: [{ scriptId: '1', url, functions }], 'source-map-cache': { [url]: cache } };
    }
    const esm = variant('esm', 'alpha'),
      cjs = variant('cjs', 'beta');
    const forward = await remapV8Coverage([esm, cjs], [file, unseen]);
    const backward = await remapV8Coverage([cjs, esm], [file, unseen]);
    assert.deepEqual(forward.getCoverageSummary().toJSON(), backward.getCoverageSummary().toJSON());
    assert.equal(forward.files().length, 2);
    assert.equal(forward.fileCoverageFor(unseen).toSummary().lines.covered, 0);
    assert.equal(forward.fileCoverageFor(file).toSummary().lines.pct, 100);
    // Simulate Node overwriting a URL cache in a process containing both formats.
    const overwritten = { ...esm, 'source-map-cache': cjs['source-map-cache'] };
    const recovered = await remapV8Coverage([overwritten, cjs, esm], [file, unseen]);
    assert.deepEqual(
      recovered.getCoverageSummary().toJSON(),
      forward.getCoverageSummary().toJSON(),
    );
    await assert.rejects(
      remapV8Coverage([overwritten], [file]),
      /Missing matching generated source map/,
    );
    const ambiguous = structuredClone(esm);
    ambiguous['source-map-cache'][url].data.names.push('another-map-at-the-same-length');
    await assert.rejects(
      remapV8Coverage([esm, ambiguous], [file]),
      /Ambiguous generated source maps/,
    );
    const escaped = variant('esm', 'alpha');
    escaped['source-map-cache'][url].data.sources = [join(dir, 'foreign.ts')];
    await assert.rejects(remapV8Coverage([escaped], [file]), /escaped production inventory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
