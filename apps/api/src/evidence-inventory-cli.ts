import fs from 'node:fs/promises';
import sql from 'mssql';
import { BlobServiceClient } from '@azure/storage-blob';
import { withDatabase } from './shared/database.js';
import {
  evidenceInventory,
  historicalEvidenceReferences,
  type StoredEvidenceObject,
} from './modules/skills/evidence-inventory.js';

async function main() {
  if (process.argv.slice(2).join(' ') !== '--dry-run')
    throw Error('Only --dry-run is supported. No deletion command is available.');
  const account = process.env.ACCESS_ACCOUNT_ID?.toLowerCase(),
    connection = process.env.EVIDENCE_STORAGE_CONNECTION_STRING,
    containerName = process.env.EVIDENCE_STORAGE_CONTAINER;
  if (!account || !/^[0-9a-f-]{36}$/.test(account) || !connection || !containerName)
    throw Error('Configure the account and private evidence storage before inventory.');
  const prefix = account + '/';
  const refs = await withDatabase(async pool => {
    const result = await pool.request().input('account', sql.UniqueIdentifier, account).query(`
    SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account;
    SELECT blob_name AS name FROM dbo.SkillClaimEvidence WHERE account_id=@account
    UNION SELECT blob_name FROM dbo.CertificationImageRecord WHERE account_id=@account AND active=1
    UNION SELECT blob_name FROM dbo.CapabilityIntakeFile WHERE account_id=@account AND (active=1 OR transferred=1);
    SELECT snapshot_json AS document FROM dbo.CapabilitySubmissionItem WHERE account_id=@account
    UNION ALL SELECT after_json FROM dbo.AccessAudit WHERE account_id=@account;
  `);
    const sets = result.recordsets as sql.IRecordSet<any>[];
    if (!sets[0][0]) throw Error('Configured account is unavailable.');
    const history = historicalEvidenceReferences(
      sets[2].map(row => row.document),
      prefix,
    );
    for (const row of sets[1]) {
      if (row.name.startsWith(prefix)) history.references.add(row.name);
      else history.complete = false;
    }
    return { ...history, revision: sets[0][0].revision };
  });
  const service = BlobServiceClient.fromConnectionString(connection),
    container = service.getContainerClient(containerName);
  const properties = await container.getProperties();
  if (properties.blobPublicAccess)
    throw Error('Evidence storage is not private. Inventory stopped.');
  const objects: StoredEvidenceObject[] = [];
  for await (const blob of container.listBlobsFlat({ prefix }))
    objects.push({
      name: blob.name,
      bytes: blob.properties.contentLength ?? 0,
      modifiedAt: blob.properties.lastModified,
    });
  const revision = await withDatabase(
    async pool =>
      (
        await pool
          .request()
          .input('account', sql.UniqueIdentifier, account)
          .query('SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account')
      ).recordset[0]?.revision,
  );
  const report = evidenceInventory(
    account,
    objects,
    refs.references,
    refs.complete && revision === refs.revision,
  );
  let recovery: unknown = 'Storage recovery settings not verified';
  try {
    const p = await service.getProperties();
    recovery = {
      blobSoftDelete: p.deleteRetentionPolicy,
      containerSoftDelete: 'Not verified; management-plane check required',
      versioning: 'Not verified; management-plane check required',
    };
  } catch {
    /* Do not substitute permission failure with a claim of protection. */
  }
  const file = new URL('../../../.local/evidence-storage-dry-run.json', import.meta.url);
  await fs.mkdir(new URL('.', file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ ...report, privateContainer: true, recovery }, null, 2),
  );
  console.log(
    JSON.stringify({
      mode: report.mode,
      scanned: report.objects.length,
      referenced: report.objects.filter(o => o.status === 'Referenced; retain').length,
      unreferenced: report.objects.filter(o => o.status.startsWith('Unreferenced')).length,
      scanComplete: report.referenceScanComplete,
      deleted: 0,
      report: '.local/evidence-storage-dry-run.json',
    }),
  );
}
main().catch(error => {
  const safe = new Set([
    'Only --dry-run is supported. No deletion command is available.',
    'Configure the account and private evidence storage before inventory.',
    'Configured account is unavailable.',
    'Evidence storage is not private. Inventory stopped.',
  ]);
  console.error(
    safe.has(error?.message)
      ? error.message
      : 'Evidence inventory could not complete. Check the configured private storage and database connectivity. No files were deleted.',
  );
  process.exitCode = 1;
});
