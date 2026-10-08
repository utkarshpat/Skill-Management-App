import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRowversion, diffSqlFeatures, newRowversionColumns } from '../src/sql-features.ts';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const schema = resolve(apiRoot, 'prisma/schema.prisma');
const snapshot = resolve(apiRoot, 'prisma/applied-schema.prisma');
const migrations = resolve(apiRoot, '../../database/migrations');
const features = resolve(apiRoot, 'src/sql-features.json');
const featuresSnapshot = resolve(apiRoot, 'prisma/applied-sql-features.json');
const normalize = text => text.replace(/\r\n/g, '\n').trimEnd();

const [command, name] = process.argv.slice(2);

if (command === 'check') {
  const [current, applied, currentFeatures, appliedFeatures] = await Promise.all(
    [schema, snapshot, features, featuresSnapshot].map(file => readFile(file, 'utf8')),
  );
  if (
    normalize(current) !== normalize(applied) ||
    JSON.stringify(JSON.parse(currentFeatures)) !== JSON.stringify(JSON.parse(appliedFeatures))
  ) {
    console.error(
      'schema.prisma or sql-features.json differs from its applied snapshot. Run "npm run db:migration:new -- <name>" to generate a reviewed SQL migration.',
    );
    process.exitCode = 1;
  } else
    console.log(
      'schema.prisma and sql-features.json match what is covered by database/migrations.',
    );
} else if (command === 'new' && /^[a-z0-9_]+$/.test(name ?? '')) {
  const require = createRequire(import.meta.url);
  const prisma = resolve(dirname(require.resolve('prisma/package.json')), 'build/index.js');
  const script = execFileSync(
    process.execPath,
    [prisma, 'migrate', 'diff', '--from-schema', snapshot, '--to-schema', schema, '--script'],
    { cwd: apiRoot, encoding: 'utf8' },
  );
  const before = JSON.parse(await readFile(featuresSnapshot, 'utf8'));
  const after = JSON.parse(await readFile(features, 'utf8'));
  const rowversions = newRowversionColumns(before, after);
  const prismaBody = applyRowversion(script, rowversions)
    .replace(/^BEGIN TRY\s*BEGIN TRAN;\s*/m, '')
    .replace(/COMMIT TRAN;\s*END TRY\s*BEGIN CATCH[\s\S]*END CATCH\s*$/m, '')
    .trim();
  for (const { table, column } of rowversions) {
    if (
      !new RegExp(`\\[${column}\\] ROWVERSION`).test(prismaBody) ||
      !prismaBody.includes(`[${table}]`)
    )
      throw new Error(
        `Cannot declare existing column ${table}.${column} as rowversion; add a new column instead.`,
      );
  }
  const body = [prismaBody, ...diffSqlFeatures(before, after)]
    .filter(part => /\S/.test(part.replace(/^\s*--.*$/gm, '')))
    .join('\n\n');
  if (!body) {
    console.log('No schema changes to migrate.');
  } else {
    const versions = (await readdir(migrations))
      .map(file => Number(/^(\d{3})_/.exec(file)?.[1]))
      .filter(Number.isInteger);
    const next = String(Math.max(...versions) + 1).padStart(3, '0');
    const filename = `${next}_${name}.sql`;
    const header = `-- Generated from prisma/schema.prisma by db:migration:new. Review before applying.\n-- The migration runner supplies the transaction. Filtered indexes, rowversion and check\n-- constraints come from src/sql-features.json.\n`;
    await writeFile(resolve(migrations, filename), `${header}${body}\n`, { flag: 'wx' });
    await writeFile(snapshot, await readFile(schema, 'utf8'));
    await writeFile(featuresSnapshot, await readFile(features, 'utf8'));
    console.log(`Created database/migrations/${filename}. Review it, then run db:migrate.`);
  }
} else {
  console.error('Usage: schema-migration.mjs check | new <snake_case_name>');
  process.exitCode = 1;
}
