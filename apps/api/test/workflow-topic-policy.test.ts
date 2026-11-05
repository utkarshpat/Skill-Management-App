import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workflowCategory, workflowChange } from '../src/modules/workflows/workflows.js';

const migration = await readFile(
  new URL('../../../database/migrations/090_workflow_topic_recipients.sql', import.meta.url),
  'utf8',
);
const baseline = await readFile(
  new URL('../../../database/migrations/081_workflow_notification_details.sql', import.meta.url),
  'utf8',
);
const listBaseline = await readFile(
  new URL('../../../database/migrations/023_workflow_lifecycle.sql', import.meta.url),
  'utf8',
);
const normalize = (value: string) =>
  value
    .replace(/--[^\r\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const between = (value: string, start: string, end: string) => {
  const from = value.indexOf(start),
    to = value.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return normalize(value.slice(from, to));
};

test('topic query uses implemented codes only and never accepts caller authority', () => {
  assert.equal(workflowCategory('PLATFORM'), 'PLATFORM');
  assert.equal(workflowCategory(undefined), undefined);
  for (const invalid of ['', 'ADMIN', ['SKILL'], { scope: 'ORGANIZATION' }])
    assert.throws(() => workflowCategory(invalid));
  const value = workflowChange({
    action: 'CREATE',
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'REQUEST',
    category: 'PLATFORM',
    priority: 'NORMAL',
    title: 'Platform help',
    description: 'Please investigate.',
    recipientId: '00000000-0000-4000-8000-000000000002',
  });
  assert.equal(value.action === 'CREATE' && value.category, 'PLATFORM');
});
test('migration preserves participant lifecycle, notification, revision, audit and historical read contracts', () => {
  for (const [start, end] of [
    ["IF @mode='REASSIGN_OPTIONS'", "ELSE IF @mode='OPTIONS'"],
    ["ELSE IF @mode IN ('LIST','DETAIL')", "ELSE IF @mode='NOTIFICATIONS'"],
    ["ELSE IF @mode='NOTIFICATIONS'", "ELSE IF @mode IN ('CREATE','COMMENT'"],
    [
      'IF (SELECT COUNT(*) FROM OPENJSON(@payload))<>CASE',
      "ELSE THROW 51000,'Unknown workflow action.'",
    ],
  ])
    assert.equal(between(migration, start, end), between(baseline, start, end));
  const listStart = 'CREATE OR ALTER PROCEDURE dbo.ReadWorkflowList';
  assert.equal(
    normalize(migration.slice(migration.indexOf(listStart))).replace(",'PLATFORM'", ''),
    normalize(listBaseline.slice(listBaseline.indexOf(listStart))).replace(
      ' GRANT EXECUTE ON dbo.ReadWorkflowList TO [skill_management_runtime]; GO',
      '',
    ),
  );
});
test('SQL shares category gate between discovery and transaction-time create without granting review authority', () => {
  assert.match(migration, /WHERE dbo\.WorkflowTopicCan\(@account_id,@actor_id,k\.kind,c\.code\)=1/);
  assert.match(
    migration,
    /IF dbo\.WorkflowTopicCan\(@account_id,@actor_id,@kind,@category\)<>1 THROW 51003/,
  );
  assert.match(migration, /@category='ASSESSMENT'.*'skill\.verify',0/);
  assert.match(migration, /@category='PROJECT'.*BusinessHasAccess.*BusinessLegacyDenied/);
  assert.match(
    migration,
    /BusinessSystemAdmin.*AccessCan.*'users\.manage'.*'permissions\.manage'.*'audit\.view'/,
  );
  assert.match(migration, /@query=N''.*@category_filter='PLATFORM' AND systemAdmin=1/);
  assert.match(migration, /sameTeam=1 OR reportingLine=1/);
  assert.match(migration, /JOIN descendants r ON a\.manager_id=r\.person_id/);
  assert.match(migration, /OPTION\(MAXRECURSION 200\)/);
  assert.match(migration, /FROM visible WHERE @query=N'' OR searchRank<=20/);
  assert.doesNotMatch(
    migration,
    /INSERT dbo\.(?:BusinessResponsibility|AccessRole|AccessPermission)/,
  );
});
