import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('opening matching results refreshes authority and clears cached rows after revocation', () => {
  execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('./fixtures/people-search-recheck.mjs', import.meta.url)),
    ],
    { stdio: 'pipe' },
  );
});
