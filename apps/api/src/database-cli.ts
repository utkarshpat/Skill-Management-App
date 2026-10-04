import { readFile } from 'node:fs/promises';
import sql from 'mssql';
import { withDatabase } from './shared/database.js';

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
        for (const [version,filename] of [[2,'002_own_profile.sql'],[3,'003_custom_access.sql'],[4,'004_microsoft_access.sql'],[5,'005_organization_setup.sql'],[6,'006_department_membership.sql'],[7,'007_skill_catalogue.sql'],[8,'008_skill_claim_drafts.sql'],[9,'009_ai_conversations.sql'],[10,'010_skill_claim_reviews.sql'],[11,'011_empty_skill_search.sql'],[12,'012_versioned_skill_framework.sql'],[13,'013_claim_catalogue_discovery.sql'],[14,'014_employee_learning.sql'],[15,'015_learning_log_capacity.sql'],[16,'016_learning_skill_mapping.sql'],[17,'017_learning_practice.sql'],[18,'018_learning_recovery.sql'],[19,'019_requests_incidents.sql'],[20,'020_workflow_recipient_search.sql'],[21,'021_workflow_workbench.sql'],[22,'022_workflow_list.sql'],[23,'023_workflow_lifecycle.sql'],[24,'024_workflow_participant_assignment.sql'],[25,'025_workflow_timeline_text.sql'],[26,'026_dashboard_skill_summary.sql'],[27,'027_direct_report_capability.sql'],[28,'028_skill_review_workbench.sql'],[29,'029_notification_destinations.sql'],[30,'030_reporting_review_access.sql'],[31,'031_effective_access_baseline.sql'],[32,'032_access_reporting_snapshot.sql'],[33,'033_reporting_scope_integrity.sql'],[34,'034_exact_claim_review_access.sql'],[35,'035_team_capability_analytics.sql']] as const) {
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
        } catch (error) { await transaction.rollback();const detail=error as {number?:number;lineNumber?:number;message?:string};if(detail.number)console.error(`Migration ${version} failed: SQL ${detail.number}, line ${detail.lineNumber??'unknown'}: ${detail.message?.slice(0,300)??'Statement rejected.'}`);throw error; }
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
