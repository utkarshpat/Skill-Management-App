import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

test('frontend source uses valid UTF-8 without corrupted replacement characters', async () => {
  const source = new URL('../src/', import.meta.url);
  const paths = await readdir(source, { recursive: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const path of paths.filter(path => /\.(tsx?|css|html)$/.test(path))) {
    const content = decoder.decode(await readFile(new URL(path.replaceAll('\\', '/'), source)));
    assert.ok(!content.includes('\uFFFD'), `Corrupted replacement character in ${path}`);
  }
});
