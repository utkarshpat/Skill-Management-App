import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('last-used migration preserves ownership, CAS, workflow gates, audit and historical privacy',async()=>{
 const text=await readFile(new URL('../../../database/migrations/042_skill_last_used.sql',import.meta.url),'utf8');
 assert.match(text,/ADD last_used_on date NULL/);
 for(const name of ['SaveOwnSkillClaim','ReadOwnSkillClaims','ReadSkillReviewWorkbench']){
  const procedure=text.split('CREATE OR ALTER PROCEDURE dbo.'+name)[1]?.split('\nGO')[0];
  assert.ok(procedure);
  assert.match(procedure,/AccessRuntimeAccount/);
  assert.match(procedure,/AccessCan\(@account_id,@actor_id,'profile.view',1\)/);
  assert.match(procedure,/BEGIN TRANSACTION/);
 }
 assert.match(text,/revision=@expected_revision AND status IN \('DRAFT','CHANGES_REQUESTED','REJECTED'\)/);
 assert.match(text,/claim_id=@claim_id AND person_id=@actor_id/);
 assert.match(text,/INSERT dbo.AccessAudit/);
 assert.match(text,/@last_used>CONVERT\(date,SYSUTCDATETIME\(\)\)/);
 assert.match(text,/DECLARE @last_used_text nvarchar\(max\)/);
 assert.match(text,/SELECT @last_used_text=\[value\] FROM OPENJSON/);
 assert.match(text,/NOT EXISTS\(SELECT 1 FROM OPENJSON\(@payload\) WHERE \[key\]='lastUsedOn'\)/);
 assert.match(text,/AccessCanReviewClaim\(@account_id,@actor_id,c.claim_id,0\)=1/);
 assert.match(text,/CASE WHEN c.status='SUBMITTED' THEN c.last_used_on ELSE TRY_CONVERT\(date,JSON_VALUE\(s.after_json,'\$\.last_used_on'\),23\) END/);
 assert.doesNotMatch(text,/UPDATE dbo.SkillClaimDraft SET status|TransitionSkillClaim|INSERT dbo.AccountRolePermission/);
 const runner=await readFile(new URL('../src/database-cli.ts',import.meta.url),'utf8');
 assert.match(runner,/\[41,'041_dashboard_top_skills.sql'\],\[42,'042_skill_last_used.sql'\]/);
});
