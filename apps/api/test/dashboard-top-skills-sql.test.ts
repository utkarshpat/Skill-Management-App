import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('top-skills SQL retains workspace/own access checks and derives saved scale from the full reviewed dataset',async()=>{
 const text=await readFile(new URL('../../../database/migrations/041_dashboard_top_skills.sql',import.meta.url),'utf8');
 assert.match(text,/AccessRuntimeAccount/);assert.match(text,/AccessCan\(@account_id,@actor_id,'profile.view',1\)/);
 assert.match(text,/AccessCan\(@account_id,@actor_id,'skill.view',1\)/);
 assert.match(text,/TOP\(6\)/);assert.match(text,/c\.person_id=@actor_id AND c\.status='APPROVED'/);
 assert.match(text,/v\.definition_revision=c\.definition_revision/);assert.match(text,/MAX\(v\.rank\)/);
 assert.match(text,/ORDER BY c\.claimed_rank DESC,c\.skill_name,c\.claim_id/);
 assert.doesNotMatch(text,/OFFSET|@page|experience_months AS|evidence AS|description AS/);
});
