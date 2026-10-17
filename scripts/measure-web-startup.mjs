// Build locally and measure static JS dependencies, excluding deferred imports.
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const root = fileURLToPath(new URL('../apps/web/', import.meta.url));
await build({ root, build: { manifest: true }, logLevel: 'silent' });
const manifest = JSON.parse(
  await readFile(new URL('../apps/web/dist/.vite/manifest.json', import.meta.url), 'utf8'),
);
const flows = {
  employeeDashboard: [
    'index.html',
    'src/Workspace.tsx',
    'src/Dashboard.tsx',
    'src/AssistantWidget.tsx',
  ],
  administratorDashboard: [
    'index.html',
    'src/AccessAdmin.tsx',
    'src/Workspace.tsx',
    'src/Dashboard.tsx',
    'src/AssistantWidget.tsx',
  ],
  employeeLearning: [
    'index.html',
    'src/Workspace.tsx',
    'src/Learning.tsx',
    'src/AssistantWidget.tsx',
  ],
};
for (const [flow, entries] of Object.entries(flows)) {
  const seen = new Set();
  function visit(key) {
    if (seen.has(key)) return;
    if (!manifest[key]) throw Error(`Missing build entry: ${key}`);
    seen.add(key);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  entries.forEach(visit);
  let bytes = 0,
    gzipBytes = 0;
  for (const key of seen) {
    const path = new URL(`../apps/web/dist/${manifest[key].file}`, import.meta.url);
    bytes += (await stat(path)).size;
    gzipBytes += gzipSync(await readFile(path)).length;
  }
  console.log(JSON.stringify({ flow, javaScriptBytes: bytes, gzipBytes, chunks: seen.size }));
}
