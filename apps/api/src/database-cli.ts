import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from './database.js';

const command = process.argv[2];
if (command !== 'check' && command !== 'migrate') {
  console.error('Usage: database-cli.ts check|migrate');
  process.exitCode = 1;
} else {
  try {
    await withDatabase(async pool => {
      const info = await pool.request().query('SELECT DB_NAME() AS database_name, CAST(1 AS int) AS connected;');
      console.log('SQL connection verified:', info.recordset[0].database_name);
      if (command === 'migrate') {
        // Run only the reviewed repository migration; never accept arbitrary SQL from HTTP.
        const initialized = await pool.request().query("SELECT CASE WHEN OBJECT_ID(N'dbo.SchemaMigration', N'U') IS NULL THEN 0 ELSE 1 END AS initialized;");
        if (!initialized.recordset[0].initialized) {
          await pool.request().query(await readFile(new URL('../../../database/migrations/001_identity_authorization.sql', import.meta.url), 'utf8'));
          console.log('Migration 001 applied.');
        }
        for (const [version,filename] of [[2,'002_own_profile.sql'],[3,'003_custom_access.sql']] as const) {
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
          const applied = await new sql.Request(transaction).input('version',sql.Int,version).query('SELECT version FROM dbo.SchemaMigration WITH (UPDLOCK, HOLDLOCK) WHERE version = @version;');
          if (!applied.recordset.length) {
            const source=await readFile(new URL(`../../../database/migrations/${filename}`, import.meta.url),'utf8');
            for(const batch of source.split(/^GO\s*$/m)) if(batch.trim())await new sql.Request(transaction).batch(batch);
            await new sql.Request(transaction).input('version',sql.Int,version).query('INSERT INTO dbo.SchemaMigration(version) VALUES (@version);');
            console.log(`Migration ${version} applied.`);
          }
          await transaction.commit();
        } catch (error) { await transaction.rollback(); throw error; }
        }
      }
      const exists = await pool.request().query("SELECT CASE WHEN OBJECT_ID(N'dbo.SchemaMigration', N'U') IS NULL THEN 0 ELSE 1 END AS has_migrations;");
      if (exists.recordset[0].has_migrations === 0) {
        console.log('Schema is not initialized. Run db:migrate after verifying the target database.');
        return;
      }
      const versions = await pool.request().query('SELECT version FROM dbo.SchemaMigration ORDER BY version;');
      console.log('Applied migrations:', versions.recordset.map(row => row.version).join(', '));
      const roles = await pool.request().query('SELECT COUNT(*) AS role_count FROM dbo.AppRole;');
      console.log('Role seeds:', roles.recordset[0].role_count);
    });
  } catch (error) {
    // Driver errors may include identity details or configuration; do not log raw objects.
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'SQL_SETUP_FAILED';
    console.error(`Database setup failed (${code}). Check configuration, local Azure sign-in and the server firewall. No connection secrets are printed.`);
    process.exitCode = 1;
  }
}
