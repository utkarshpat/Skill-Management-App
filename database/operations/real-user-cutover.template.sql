-- Generated employee-specific copies belong in ignored artifacts only.
-- Company DBA operation. Stop the app first; retain a recoverable backup.
-- Default PREVIEW makes no permanent changes. Review its results before applying.
-- Applying deliberately retires demo login. All real profiles remain INACTIVE.
-- Capability-lead view/export intent is staged, NOT a broad Business Operations grant.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET LOCK_TIMEOUT 15000;
DECLARE @apply bit=0;
DECLARE @backupConfirmed bit=0;
DECLARE @maintenanceConfirmed bit=0;
DECLARE @account uniqueidentifier='0abd9bd3-7a7e-47b2-bea2-efbb86110cfa';
DECLARE @tenant uniqueidentifier='8b87af7d-8647-4dc7-8df4-5f69a2011bb5';
DECLARE @sourceHash varchar(64)='{{SOURCE_HASH}}';
DECLARE @roster nvarchar(max)={{ROSTER}};
DECLARE @reviewedSnapshot nvarchar(max)={{SNAPSHOT}};
IF DB_NAME()<>N'SS-SkillMgmtApp-SQL-Dev'
 OR LOWER(CONVERT(nvarchar(128),SERVERPROPERTY('ServerName'))) NOT IN(N'ssskillmgmtappsqlsrvdev',N'ssskillmgmtappsqlsrvdev.database.windows.net')
 THROW 51000,'Wrong company server/database; cutover refused.',1;
IF CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varbinary(max),@roster)),2)<>'{{ROSTER_HASH}}'
 THROW 51000,'Employee source manifest changed; regenerate and review.',1;
IF @apply=1 AND (@backupConfirmed=0 OR @maintenanceConfirmed=0)
 THROW 51000,'Apply requires a recoverable backup and stopped app/maintenance window. Set both confirmation flags only after completing those steps.',1;
IF OBJECT_ID(N'dbo.OperationsRealUserCutover',N'U') IS NOT NULL
 THROW 51000,'Cutover archive already exists. Do not replay; inspect the recorded batch.',1;
DROP TABLE IF EXISTS #expected;
DROP TABLE IF EXISTS #inventory;
DROP TABLE IF EXISTS #deletions;
DROP TABLE IF EXISTS #users;
CREATE TABLE #expected(schema_name sysname,table_name sysname,row_count bigint,snapshot_sha256 varchar(64),PRIMARY KEY(schema_name,table_name));
INSERT #expected VALUES
{{EXPECTED}};
CREATE TABLE #inventory(schema_name sysname,table_name sysname,row_count bigint,snapshot_sha256 varchar(64));
CREATE TABLE #deletions(object_id int PRIMARY KEY,table_name sysname,expected_rows bigint,done bit NOT NULL DEFAULT 0);
CREATE TABLE #users(person_id uniqueidentifier PRIMARY KEY,employee_code nvarchar(40) UNIQUE,display_name nvarchar(100),manager_code nvarchar(40),project_name nvarchar(100));
INSERT #users SELECT personId,employeeCode,displayName,managerEmployeeCode,project
 FROM OPENJSON(@roster,'$.users') WITH(personId uniqueidentifier,employeeCode nvarchar(40),displayName nvarchar(100),managerEmployeeCode nvarchar(40),project nvarchar(100));
IF (SELECT COUNT(*) FROM #users)<>20 OR (SELECT COUNT(*) FROM #users WHERE manager_code IS NOT NULL)<>19
 THROW 51000,'Invalid roster/reporting manifest.',1;
DECLARE @schema sysname,@table sysname,@object int,@columns nvarchar(max),@order nvarchar(max),@query nvarchar(max),@rows bigint,@hash varchar(64);
DECLARE @batch uniqueidentifier=NEWID(),@now datetime2=SYSUTCDATETIME(),@revision int;
BEGIN TRY
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account AND entra_tenant_id=@tenant AND status='ACTIVE')
  THROW 51000,'Company tenant/account mismatch.',1;
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account;
 IF @revision IS NULL OR @revision<>{{REVISION}} OR (SELECT MAX(version) FROM dbo.SchemaMigration)<>87
  THROW 51000,'Workspace revision or schema changed. Obtain and review a fresh inventory.',1;
{{RECHECK}}
 IF EXISTS(SELECT * FROM #expected EXCEPT SELECT * FROM #inventory)
  OR EXISTS(SELECT * FROM #inventory EXCEPT SELECT * FROM #expected)
  THROW 51000,'Database data/schema changed since reviewed preview. Nothing changed; obtain a fresh inventory.',1;
 IF EXISTS(SELECT 1 FROM dbo.PrivateFileObject WHERE account_id=@account AND provider<>'sql')
  THROW 51000,'External file objects require separate cleanup.',1;
 -- Preserve account/workspace/runtime configuration. All other reviewed account data
 -- is explicitly retired, including test catalogue, old grants and test workflows.
 INSERT #deletions(object_id,table_name,expected_rows)
  SELECT OBJECT_ID(N'dbo.'+QUOTENAME(table_name)),table_name,row_count FROM #expected
  WHERE row_count>0 AND table_name NOT IN('Account','AccessWorkspace','AccessRuntimeAccount');
 SELECT CASE WHEN @apply=0 THEN 'PREVIEW_ONLY_NO_DB_CHANGES' ELSE 'APPLYING' END AS mode,
  @revision AS reviewedRevision,20 AS pendingEmployees,2 AS projects,19 AS managerEdges,
  N'All 20 employees INACTIVE; real SSO/binding still required. Current demo admin retired.' AS loginImpact,
  N'Capability-lead project view/export intent staged; no broader grant.' AS leadAccess;
 SELECT table_name,expected_rows AS rowsToRetire FROM #deletions ORDER BY table_name;
 -- Required review: show exact old grants, including unsupported historical entries.
 SELECT * FROM dbo.BusinessResponsibility WHERE account_id=@account;
 SELECT * FROM dbo.AccessPersonOverride WHERE account_id=@account;
 SELECT * FROM dbo.AccountRole WHERE account_id=@account;
 SELECT * FROM dbo.AccountRolePermission WHERE account_id=@account;
 SELECT * FROM dbo.AccessPersonRole WHERE account_id=@account;
 SELECT u.employee_code,u.display_name,u.manager_code,u.project_name,'INACTIVE_PENDING_SSO' AS activation FROM #users u ORDER BY employee_code;
 IF @apply=0 BEGIN
  COMMIT TRANSACTION;
  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  RETURN;
 END;
 -- Deliberately separate archival audit from active app records. No FK to retired
 -- people; preserve historical actor IDs/names, SQL operator and exact prior grants.
 -- No runtime permission is granted to this setup-only archive/identity source.
 CREATE TABLE dbo.OperationsRealUserCutover(
  batch_id uniqueidentifier NOT NULL PRIMARY KEY,
  account_id uniqueidentifier NOT NULL,
  occurred_at datetime2 NOT NULL,
  sql_operator nvarchar(128) NOT NULL,
  prior_revision int NOT NULL,
  source_sha256 varchar(64) NOT NULL,
  roster_json nvarchar(max) NOT NULL CHECK(ISJSON(roster_json)=1),
  inventory_json nvarchar(max) NOT NULL CHECK(ISJSON(inventory_json)=1),
  historical_audit_json nvarchar(max) NOT NULL CHECK(ISJSON(historical_audit_json)=1),
  prior_access_json nvarchar(max) NOT NULL CHECK(ISJSON(prior_access_json)=1),
  outcome_json nvarchar(max) NOT NULL CHECK(ISJSON(outcome_json)=1)
 );
 DECLARE @history nvarchar(max)=(SELECT
  JSON_QUERY((SELECT * FROM dbo.AccessAudit WHERE account_id=@account ORDER BY revision FOR JSON PATH,INCLUDE_NULL_VALUES)) AS accessAudit,
  JSON_QUERY((SELECT * FROM dbo.AuditEvent WHERE account_id=@account ORDER BY event_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS auditEvent
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @access nvarchar(max)=(SELECT
  JSON_QUERY((SELECT * FROM dbo.AccessPerson WHERE account_id=@account ORDER BY person_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS people,
  JSON_QUERY((SELECT * FROM dbo.AccessOrgNode WHERE account_id=@account ORDER BY node_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS organization,
  JSON_QUERY((SELECT * FROM dbo.AccessOrgAssignment WHERE account_id=@account ORDER BY person_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS relationships,
  JSON_QUERY((SELECT * FROM dbo.BusinessResponsibility WHERE account_id=@account ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS responsibilities,
  JSON_QUERY((SELECT * FROM dbo.AccessPersonOverride WHERE account_id=@account FOR JSON PATH,INCLUDE_NULL_VALUES)) AS overrides,
  JSON_QUERY((SELECT * FROM dbo.AccountRole WHERE account_id=@account FOR JSON PATH,INCLUDE_NULL_VALUES)) AS templates,
  JSON_QUERY((SELECT * FROM dbo.AccountRolePermission WHERE account_id=@account FOR JSON PATH,INCLUDE_NULL_VALUES)) AS templateGrants,
  JSON_QUERY((SELECT * FROM dbo.AccessPersonRole WHERE account_id=@account FOR JSON PATH,INCLUDE_NULL_VALUES)) AS assignments
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @outcome nvarchar(max)=N'{"people":20,"activePeople":0,"projects":2,"managerEdges":19,"leadGrant":"PENDING_NARROW_VIEW_EXPORT_IMPLEMENTATION","authentication":"PENDING_VERIFIED_ENTRA_BINDING","auditRetention":"ARCHIVED_IN_THIS_BATCH"}';
 INSERT dbo.OperationsRealUserCutover VALUES(@batch,@account,@now,ORIGINAL_LOGIN(),@revision,@sourceHash,@roster,@reviewedSnapshot,@history,@access,@outcome);
 -- Compute deletion order from installed foreign keys. Never disable constraints.
 -- Self references are satisfied by deleting the complete reviewed account set.
 WHILE EXISTS(SELECT 1 FROM #deletions WHERE done=0) BEGIN
  SET @object=NULL;
  SELECT TOP(1) @object=d.object_id,@table=d.table_name,@rows=d.expected_rows FROM #deletions d
   WHERE d.done=0 AND NOT EXISTS(SELECT 1 FROM sys.foreign_keys f JOIN #deletions child ON child.object_id=f.parent_object_id AND child.done=0
    WHERE f.referenced_object_id=d.object_id AND f.parent_object_id<>f.referenced_object_id)
   ORDER BY d.table_name;
  IF @object IS NULL THROW 51000,'Unexpected foreign-key cycle. Rolled back; inspect dependencies.',1;
  SET @query=N'DELETE FROM dbo.'+QUOTENAME(@table)+N' WHERE account_id=@a; IF @@ROWCOUNT<>@expected THROW 51000,''Deletion count mismatch; rollback.'',1;';
  EXEC sys.sp_executesql @query,N'@a uniqueidentifier,@expected bigint',@a=@account,@expected=@rows;
  UPDATE #deletions SET done=1 WHERE object_id=@object;
 END;
 INSERT dbo.AccessPerson(account_id,person_id,display_name,employee_code,active,entra_object_id)
  SELECT @account,person_id,display_name,employee_code,0,NULL FROM #users;
 INSERT dbo.AccessOrgAssignment(account_id,person_id,team_id,manager_id,department_id)
  SELECT @account,u.person_id,NULL,m.person_id,NULL FROM #users u LEFT JOIN #users m ON m.employee_code=u.manager_code;
 INSERT dbo.BusinessProject(account_id,id,name,department_id,active)
  SELECT @account,id,name,NULL,1 FROM OPENJSON(@roster,'$.projects') WITH(id uniqueidentifier,name nvarchar(100));
 INSERT dbo.BusinessProjectMember(account_id,project_id,person_id,active)
  SELECT @account,p.id,u.person_id,1 FROM #users u JOIN dbo.BusinessProject p ON p.account_id=@account AND p.name=u.project_name;
 -- Explicit Admin intent only, unusable until the profile is securely activated.
 INSERT dbo.BusinessResponsibility(account_id,id,person_id,bundle,scope_kind,scope_id,effect,active,valid_until,reason)
  SELECT @account,NEWID(),person_id,'SYSTEM_ADMIN','ORGANIZATION',NULL,'ALLOW',1,NULL,
   N'Explicit user-designated initial administrator; profile pending verified Entra binding. Cutover '+CONVERT(nvarchar(36),@batch)
  FROM #users WHERE employee_code=JSON_VALUE(@roster,'$.accessIntent.initialAdminEmployeeCode');
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account AND revision=@revision;
 IF @@ROWCOUNT<>1 THROW 51000,'Revision conflict; rollback.',1;
 IF (SELECT COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account)<>20
  OR EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND (active=1 OR entra_object_id IS NOT NULL))
  OR (SELECT COUNT(*) FROM dbo.AccessOrgAssignment WHERE account_id=@account AND manager_id IS NOT NULL)<>19
  OR (SELECT COUNT(*) FROM dbo.BusinessProject WHERE account_id=@account)<>2
  OR (SELECT COUNT(*) FROM dbo.BusinessProjectMember WHERE account_id=@account)<>20
  OR (SELECT COUNT(*) FROM dbo.BusinessResponsibility WHERE account_id=@account)<>1
  THROW 51000,'Post-import verification failed; rollback.',1;
 -- Every retired table must be empty unless intentionally repopulated above.
 DECLARE verification CURSOR LOCAL FAST_FORWARD FOR
  SELECT table_name FROM #expected WHERE table_name NOT IN('Account','AccessWorkspace','AccessRuntimeAccount','AccessPerson','AccessOrgAssignment','BusinessProject','BusinessProjectMember','BusinessResponsibility');
 OPEN verification; FETCH NEXT FROM verification INTO @table;
 WHILE @@FETCH_STATUS=0 BEGIN
  SET @query=N'IF EXISTS(SELECT 1 FROM dbo.'+QUOTENAME(@table)+N' WHERE account_id=@a) THROW 51000,''Retired data remains; rollback.'',1;';
  EXEC sys.sp_executesql @query,N'@a uniqueidentifier',@a=@account;
  FETCH NEXT FROM verification INTO @table;
 END;
 CLOSE verification; DEALLOCATE verification;
 COMMIT TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 SELECT 'COMMITTED' AS outcome,@batch AS batchId,@revision+1 AS revision,20 AS inactiveEmployees,2 AS projects,
  N'dbo.OperationsRealUserCutover' AS auditArchive,N'Keep app stopped until real SSO and verified initial-admin binding are installed.' AS nextStep;
END TRY
BEGIN CATCH
 IF CURSOR_STATUS('local','tables')>=0 CLOSE tables;
 IF CURSOR_STATUS('local','tables')>=-1 DEALLOCATE tables;
 IF CURSOR_STATUS('local','verification')>=0 CLOSE verification;
 IF CURSOR_STATUS('local','verification')>=-1 DEALLOCATE verification;
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
END CATCH;
