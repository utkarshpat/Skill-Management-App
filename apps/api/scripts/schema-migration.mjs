import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const schema = resolve(apiRoot, 'prisma/schema.prisma');
const snapshot = resolve(apiRoot, 'prisma/applied-schema.prisma');
const migrations = resolve(apiRoot, '../../database/migrations');
const normalize = text => text.replace(/\r\n/g, '\n').trimEnd();

const [command, name] = process.argv.slice(2);

if (command === 'check') {
  const [current, applied] = await Promise.all([
    readFile(schema, 'utf8'),
    readFile(snapshot, 'utf8'),
  ]);
  if (normalize(current) !== normalize(applied)) {
    console.error(
      'schema.prisma differs from prisma/applied-schema.prisma. Run "npm run db:migration:new -- <name>" to generate a reviewed SQL migration.',
    );
    process.exitCode = 1;
  } else console.log('schema.prisma matches the schema covered by database/migrations.');
} else if (command === 'new' && /^[a-z0-9_]+$/.test(name ?? '')) {
  const require = createRequire(import.meta.url);
  const prisma = resolve(dirname(require.resolve('prisma/package.json')), 'build/index.js');
  const script = execFileSync(
    process.execPath,
    [prisma, 'migrate', 'diff', '--from-schema', snapshot, '--to-schema', schema, '--script'],
    { cwd: apiRoot, encoding: 'utf8' },
  );
  const body = script
    .replace(/^BEGIN TRY\s*BEGIN TRAN;\s*/m, '')
    .replace(/COMMIT TRAN;\s*END TRY\s*BEGIN CATCH[\s\S]*END CATCH\s*$/m, '')
    .trim();
  if (!/\S/.test(body.replace(/^\s*--.*$/gm, ''))) {
    console.log('No schema changes to migrate.');
  } else {
    const versions = (await readdir(migrations))
      .map(file => Number(/^(\d{3})_/.exec(file)?.[1]))
      .filter(Number.isInteger);
    const next = String(Math.max(...versions) + 1).padStart(3, '0');
    const filename = `${next}_${name}.sql`;
    const header = `-- Generated from prisma/schema.prisma by db:migration:new. Review before applying.\n-- The migration runner supplies the transaction. Prisma cannot express filtered indexes\n-- or rowversion; add those manually.\n`;
    await writeFile(resolve(migrations, filename), `${header}${body}\n`, { flag: 'wx' });
    await writeFile(snapshot, await readFile(schema, 'utf8'));
    console.log(`Created database/migrations/${filename}. Review it, then run db:migrate.`);
  }
} else {
  console.error('Usage: schema-migration.mjs check | new <snake_case_name>');
  process.exitCode = 1;
}
