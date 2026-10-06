import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
if (dirname(output) !== resolve(root))
  throw Error('Build output must stay inside the API service.');
// TypeScript does not remove outputs belonging to deleted/renamed sources.
// An old dist/app.js can replace the Express entrypoint in Vercel's build cache.
await rm(output, { recursive: true, force: true });
const require = createRequire(import.meta.url);
const compiler = resolve(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
execFileSync(process.execPath, [compiler], { cwd: root, stdio: 'inherit' });
