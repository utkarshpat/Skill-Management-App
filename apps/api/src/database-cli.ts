import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import {
  baselineIssues,
  filteredUniqueIndexes,
  legacyMigrationBaselineVersion,
  rowversionColumns,
} from './database-baseline.js';
import { listMigrationFiles } from './migration-files.js';
import { withDatabase } from './shared/database.js';

const command = process.argv[2];
if (
  command !== 'check' &&
  command !== 'migrate' &&
  command !== 'status' &&
  command !== 'baseline'
) {
  console.error('Usage: database-cli.ts check|migrate|status|baseline');
  process.exitCode = 1;
} else {
  try {
    await withDatabase(async pool => {
      const info = await pool
        .request()
        .query('SELECT DB_NAME() AS database_name, CAST(1 AS int) AS connected;');
      console.log('SQL connection verified:', info.recordset[0].database_name);
      if (command === 'migrate') {
        // Run only the reviewed repository migration; never accept arbitrary SQL from HTTP.
        const initialized = await pool
          .request()
          .query(
            "SELECT CASE WHEN OBJECT_ID(N'dbo.SchemaMigration', N'U') IS NULL THEN 0 ELSE 1 END AS initialized;",
          );
        if (!initialized.recordset[0].initialized) {
          await pool
            .request()
            .query(
              await readFile(
                new URL(
                  '../../../database/migrations/001_identity_authorization.sql',
                  import.meta.url,
                ),
                'utf8',
              ),
            );
          console.log('Migration 001 applied.');
        }
        const migrationDirectory = new URL('../../../database/migrations/', import.meta.url);
        for (const { version, filename } of (await listMigrationFiles(migrationDirectory)).filter(
          migration => migration.version > 1,
        )) {
          const transaction = new sql.Transaction(pool);
          await transaction.begin();
          try {
            const applied = await new sql.Request(transaction)
              .input('version', sql.Int, version)
              .query(
                'SELECT version FROM dbo.SchemaMigration WITH (UPDLOCK, HOLDLOCK) WHERE version = @version;',
              );
            if (!applied.recordset.length) {
              const source = await readFile(
                new URL(`../../../database/migrations/${filename}`, import.meta.url),
                'utf8',
              );
              for (const batch of source.split(/^GO\s*$/m))
                if (batch.trim()) await new sql.Request(transaction).batch(batch);
              await new sql.Request(transaction)
                .input('version', sql.Int, version)
                .query('INSERT INTO dbo.SchemaMigration(version) VALUES (@version);');
              console.log(`Migration ${version} applied.`);
            }
            await transaction.commit();
          } catch (error) {
            await transaction.rollback();
            const detail = error as { number?: number; lineNumber?: number; message?: string };
            if (detail.number)
              console.error(
                `Migration ${version} failed: SQL ${detail.number}, line ${detail.lineNumber ?? 'unknown'}: ${detail.message?.slice(0, 300) ?? 'Statement rejected.'}`,
              );
            throw error;
          }
        }
      }
      const exists = await pool
        .request()
        .query(
          "SELECT CASE WHEN OBJECT_ID(N'dbo.SchemaMigration', N'U') IS NULL THEN 0 ELSE 1 END AS has_migrations;",
        );
      if (exists.recordset[0].has_migrations === 0) {
        const message =
          'Schema is not initialized. Run db:migrate after verifying the target database.';
        if (command === 'baseline') {
          console.error(`Baseline verification failed: ${message}`);
          process.exitCode = 1;
        } else {
          console.log(message);
        }
        return;
      }
      const versions = await pool
        .request()
        .query('SELECT version FROM dbo.SchemaMigration ORDER BY version;');
      const appliedVersions = versions.recordset.map(row => Number(row.version));
      console.log('Applied migrations:', appliedVersions.join(', '));
      const roles = await pool.request().query('SELECT COUNT(*) AS role_count FROM dbo.AppRole;');
      console.log('Role seeds:', roles.recordset[0].role_count);
      if (command === 'baseline') {
        const indexNames = filteredUniqueIndexes.map(index => `'${index.name}'`).join(', ');
        const tableNames = [
          ...new Set([
            ...filteredUniqueIndexes.map(index => index.table),
            ...rowversionColumns.map(([table]) => table),
          ]),
        ]
          .map(table => `'${table}'`)
          .join(', ');
        const [indexes, columns] = await Promise.all([
          pool.request().query(`
            SELECT OBJECT_NAME(i.object_id) AS table_name, i.name AS index_name,
              i.is_unique, i.filter_definition,
              (
                SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
                FROM sys.index_columns AS ic
                INNER JOIN sys.columns AS c
                  ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE ic.object_id = i.object_id
                  AND ic.index_id = i.index_id
                  AND ic.key_ordinal > 0
              ) AS key_columns
            FROM sys.indexes AS i
            INNER JOIN sys.schemas AS s ON s.schema_id = OBJECT_SCHEMA_ID(i.object_id)
            WHERE s.name = 'dbo'
              AND OBJECT_NAME(i.object_id) IN (${tableNames})
              AND i.name IN (${indexNames});
          `),
          pool.request().query(`
            SELECT OBJECT_NAME(c.object_id) AS table_name, c.name AS column_name,
              c.system_type_id, c.max_length
            FROM sys.columns AS c
            INNER JOIN sys.schemas AS s ON s.schema_id = OBJECT_SCHEMA_ID(c.object_id)
            WHERE s.name = 'dbo'
              AND OBJECT_NAME(c.object_id) IN (${tableNames})
              AND c.name = 'record_version';
          `),
        ]);
        const issues = baselineIssues(appliedVersions, indexes.recordset, columns.recordset);
        if (issues.length) {
          console.error('Baseline verification failed:');
          for (const issue of issues) console.error(`- ${issue}`);
          process.exitCode = 1;
        } else {
          console.log(
            `Legacy SQL baseline verified: migrations 001-${String(legacyMigrationBaselineVersion).padStart(3, '0')}, filtered unique indexes, and rowversion columns.`,
          );
        }
      }
    });
  } catch (error) {
    // Driver errors may include identity details or configuration; do not log raw objects.
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'SQL_SETUP_FAILED';
    console.error(
      `Database setup failed (${code}). Check configuration, local Azure sign-in and the server firewall. No connection secrets are printed.`,
    );
    process.exitCode = 1;
  }
}
