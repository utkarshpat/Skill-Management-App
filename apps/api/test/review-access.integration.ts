import assert from 'node:assert/strict';
import sql from 'mssql';
import { withDatabase, withRuntimeDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlAccessStore } from '../src/modules/access/sql-access-store.js';
import { effectiveClaimReview } from '../src/modules/access/effective-access.js';

// Read-only parity checks against current records. No live claims/grants are changed.
const account = process.env.ACCESS_ACCOUNT_ID;
assert.ok(account);
try {
  const store = new SqlAccessStore(account),
    before = await store.snapshot();
  const rows = await withDatabase(
    async pool =>
      (
        await pool.request().input('account', sql.UniqueIdentifier, account).query(`
 SELECT TOP(500) a.person_id AS actorId,c.claim_id AS id,c.person_id AS personId,c.reviewer_id AS reviewerId,c.status,c.revision,
 dbo.AccessCanReviewClaim(c.account_id,a.person_id,c.claim_id,1) AS allowed
 FROM dbo.SkillClaimDraft c JOIN dbo.AccessPerson a ON a.account_id=c.account_id
 WHERE c.account_id=@account ORDER BY c.claim_id,a.person_id;`)
      ).recordset,
  );
  assert.ok(rows.length, 'Existing claims are required for parity verification.');
  for (const row of rows) {
    const actor = before.people.find(p => p.id === row.actorId.toLowerCase());
    assert.ok(actor);
    const claim = {
      ...row,
      id: row.id.toLowerCase(),
      personId: row.personId.toLowerCase(),
      reviewerId: row.reviewerId?.toLowerCase(),
    };
    assert.equal(
      effectiveClaimReview(before, actor, claim).allowed,
      Boolean(row.allowed),
      'SQL and service exact-claim decisions must agree',
    );
  }
  const foreign = '55555555-5555-4555-8555-555555555555';
  await assert.rejects(
    withRuntimeDatabase(pool =>
      pool
        .request()
        .input('account_id', sql.UniqueIdentifier, account)
        .input('actor_id', sql.UniqueIdentifier, foreign)
        .input('claim_id', sql.UniqueIdentifier, rows[0].id)
        .execute('dbo.ReadSkillReviewWorkbench'),
    ),
    error => [51003, 51004].includes((error as { number: number }).number),
  );
  const after = await store.snapshot();
  assert.equal(after.revision, before.revision);
  assert.equal(after.audit.length, before.audit.length);
  console.log(
    `Exact claim access SQL/service parity passed for ${rows.length} actor/claim combinations; unauthorized runtime read rejected; configuration and audit unchanged.`,
  );
} finally {
  await closeRuntimeDatabase();
}
