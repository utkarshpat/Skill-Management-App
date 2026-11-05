import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
export function coverageSource(directory) {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(
      entry => entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts'),
    )
    .map(entry => join(entry.parentPath, entry.name))
    .sort();
  const hash = createHash('sha256');
  for (const file of files)
    hash
      .update(relative(directory, file).split(sep).join('/'))
      .update('\0')
      .update(readFileSync(file))
      .update('\0');
  return { files, hash: hash.digest('hex') };
}
