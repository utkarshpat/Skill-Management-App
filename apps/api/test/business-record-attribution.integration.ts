// Read-only verification through the restricted runtime, compared with stored record metadata.
import assert from 'node:assert/strict';
import sql from 'mssql';
import { withDatabase, closeRuntimeDatabase } from '../src/shared/database.js';
import { SqlBusinessStore } from '../src/modules/business/sql-store.js';
import { businessQuery } from '../src/modules/business/business.js';
const account = process.env.ACCESS_ACCOUNT_ID!;
assert.ok(account);
try {
  await withDatabase(async pool => {
    const actor = (
      await pool.request().input('account', sql.UniqueIdentifier, account)
        .query(`SELECT TOP(1) person_id AS id FROM dbo.AccessPerson
      WHERE account_id=@account AND active=1 AND dbo.BusinessHasAccess(@account,person_id)=1
      AND dbo.AccessCan(@account,person_id,'profile.view',1)=1 ORDER BY person_id;`)
    ).recordset[0];
    assert.ok(actor, 'A current Business Analytics actor is required.');
    const store = new SqlBusinessStore(account);
    let checked = 0;
    for (const dataset of ['skills', 'certifications', 'submissions']) {
      const page = await store.dashboard(actor.id, businessQuery({ dataset }));
      for (const row of page.rows) {
        const skill = dataset === 'skills' || row.type === 'SKILL';
        const id = String(row.id).replace(/^(skill|certification)-/, '');
        const expected = (
          await pool
            .request()
            .input('account', sql.UniqueIdentifier, account)
            .input('id', sql.UniqueIdentifier, id)
            .query(`SELECT CASE WHEN c.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,
          CASE WHEN c.reviewed_at IS NOT NULL THEN reviewer.display_name END AS reviewedBy
          FROM dbo.${skill ? 'SkillClaimDraft' : 'CertificationRecord'} c
          JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id
          LEFT JOIN dbo.AccessPerson reviewer ON reviewer.account_id=c.account_id AND reviewer.person_id=c.reviewer_id
          WHERE c.account_id=@account AND c.${skill ? 'claim_id' : 'id'}=@id;`)
        ).recordset[0];
        assert.ok(expected);
        assert.equal(row.submittedBy, expected.submittedBy);
        assert.equal(row.reviewedBy, expected.reviewedBy);
        if (!row.reviewedAt)
          assert.equal(row.reviewedBy, null, 'Assigned reviewers are not completed reviews.');
        checked++;
      }
    }
    assert.ok(checked > 0, 'At least one visible submitted record is required.');
    console.log(
      `Business record attribution verified for ${checked} scoped rows across three datasets.`,
    );
  });
} finally {
  await closeRuntimeDatabase();
}
