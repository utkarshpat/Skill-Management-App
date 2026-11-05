import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverageSource } from './coverage-source.mjs';
test('coverage inventory hashes every production source path/content while ignoring declarations and CSS', () => {
  const root = mkdtempSync(join(tmpdir(), 'coverage-source-')),
    nested = join(root, 'nested');
  mkdirSync(nested);
  const files = [
    join(root, 'app.ts'),
    join(nested, 'view.tsx'),
    join(root, 'types.d.ts'),
    join(root, 'view.css'),
  ];
  try {
    writeFileSync(files[0], 'export const value = 1;');
    writeFileSync(files[1], 'export const view = <p>Delivery</p>;');
    writeFileSync(files[2], 'declare const value: number;');
    writeFileSync(files[3], 'p { color: teal; }');
    const first = coverageSource(root);
    assert.equal(first.files.length, 2);
    assert.deepEqual(first.files, [files[0], files[1]]);
    assert.match(first.hash, /^[a-f0-9]{64}$/);
    writeFileSync(files[2], 'declare const value: string;');
    writeFileSync(files[3], 'p { color: navy; }');
    assert.equal(coverageSource(root).hash, first.hash);
    writeFileSync(files[0], 'export const value = 2;');
    const changed = coverageSource(root);
    assert.notEqual(changed.hash, first.hash);
    const renamed = join(root, 'renamed.ts');
    renameSync(files[0], renamed);
    files[0] = renamed;
    assert.equal(coverageSource(root).files.length, 2);
    assert.notEqual(coverageSource(root).hash, changed.hash);
  } finally {
    for (const file of files) unlinkSync(file);
    rmdirSync(nested);
    rmdirSync(root);
  }
});
