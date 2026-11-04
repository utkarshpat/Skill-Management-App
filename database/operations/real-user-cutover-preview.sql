-- READ-ONLY permanent data inventory for the explicitly named company workspace.
-- Run in SSMS on the company SQL connection. This file cannot import or delete.
-- Temporary tables and short read locks are used for a consistent preview.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'SS-SkillMgmtApp-SQL-Dev'
 THROW 51000, 'Wrong database. Select SS-SkillMgmtApp-SQL-Dev on the company server.', 1;
DECLARE @account uniqueidentifier='0abd9bd3-7a7e-47b2-bea2-efbb86110cfa';
DECLARE @tenant uniqueidentifier='8b87af7d-8647-4dc7-8df4-5f69a2011bb5';
IF NOT EXISTS(SELECT 1 FROM dbo.Account WHERE account_id=@account AND entra_tenant_id=@tenant AND status='ACTIVE')
 THROW 51000, 'Expected company workspace/tenant missing. Do not substitute a personal database.', 1;
IF OBJECT_ID(N'dbo.PrivateFileObject',N'U') IS NULL OR OBJECT_ID(N'dbo.BusinessProject',N'U') IS NULL
 THROW 51000, 'Expected schema missing. Inspect migrations before planning cleanup.', 1;

DROP TABLE IF EXISTS #inventory;
CREATE TABLE #inventory(schema_name sysname,table_name sysname,row_count bigint,snapshot_sha256 varchar(64));
DECLARE @schema sysname,@table sysname,@object int,@columns nvarchar(max),@order nvarchar(max),@query nvarchar(max),@rows bigint,@hash varchar(64);
BEGIN TRY
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account;
 DECLARE tables CURSOR LOCAL FAST_FORWARD FOR
  SELECT s.name,t.name,t.object_id FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
  WHERE s.name='dbo' AND EXISTS(SELECT 1 FROM sys.columns c WHERE c.object_id=t.object_id AND c.name='account_id')
  ORDER BY s.name,t.name;
 OPEN tables; FETCH NEXT FROM tables INTO @schema,@table,@object;
 WHILE @@FETCH_STATUS=0 BEGIN
  -- Hash binary values inside SQL, never export private file bytes.
  SELECT @columns=STRING_AGG(CONVERT(nvarchar(max),CASE WHEN c.system_type_id IN(165,173,189)
    THEN N'CONVERT(varchar(64),HASHBYTES(''SHA2_256'',CONVERT(varbinary(max),'+QUOTENAME(c.name)+N')),2) AS '+QUOTENAME(c.name)
    ELSE QUOTENAME(c.name) END),N',') WITHIN GROUP(ORDER BY c.column_id)
   FROM sys.columns c WHERE c.object_id=@object;
  SELECT @order=STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(c.name)),N',') WITHIN GROUP(ORDER BY ic.key_ordinal)
   FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
   JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
   WHERE i.object_id=@object AND i.is_primary_key=1 AND ic.key_ordinal>0;
  IF @order IS NULL THROW 51000, 'Account table without primary key needs individual inventory review.', 1;
  SET @query=N'SELECT @n=COUNT_BIG(*) FROM '+QUOTENAME(@schema)+N'.'+QUOTENAME(@table)+N' WITH(HOLDLOCK) WHERE account_id=@a;'
    +N'DECLARE @j nvarchar(max)=(SELECT '+@columns+N' FROM '+QUOTENAME(@schema)+N'.'+QUOTENAME(@table)
    +N' WITH(HOLDLOCK) WHERE account_id=@a ORDER BY '+@order+N' FOR JSON PATH,INCLUDE_NULL_VALUES);'
    +N'SET @h=CONVERT(varchar(64),HASHBYTES(''SHA2_256'',CONVERT(varbinary(max),@j)),2);';
  EXEC sys.sp_executesql @query,N'@a uniqueidentifier,@n bigint OUTPUT,@h varchar(64) OUTPUT',@a=@account,@n=@rows OUTPUT,@h=@hash OUTPUT;
  INSERT #inventory VALUES(@schema,@table,@rows,@hash);
  FETCH NEXT FROM tables INTO @schema,@table,@object;
 END;
 CLOSE tables; DEALLOCATE tables;

 SELECT (SELECT N'PREVIEW_ONLY_NO_DB_CHANGES' AS mode,CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) AS serverName,
  DB_NAME() AS databaseName,@account AS accountId,@tenant AS tenantId,@revision AS workspaceRevision,SYSUTCDATETIME() AS capturedAtUtc,
  JSON_QUERY((SELECT schema_name AS schemaName,table_name AS tableName,row_count AS [rowCount],snapshot_sha256 AS snapshotSha256 FROM #inventory ORDER BY schema_name,table_name FOR JSON PATH)) AS tables,
  JSON_QUERY((SELECT person_id AS id,employee_code AS employeeCode,display_name AS displayName,active,entra_object_id AS entraObjectId,
    CASE WHEN employee_code LIKE N'DEMO-%' OR employee_code LIKE N'DEV-%' THEN N'DEMO_CODE_REQUIRES_REVIEW'
      WHEN employee_code LIKE N'QA%' OR employee_code LIKE N'TEST%' THEN N'TEST_CODE_REQUIRES_REVIEW'
      ELSE N'UNCLASSIFIED_DO_NOT_DELETE_AUTOMATICALLY' END AS classification
    FROM dbo.AccessPerson WHERE account_id=@account ORDER BY employee_code FOR JSON PATH,INCLUDE_NULL_VALUES)) AS people,
  JSON_QUERY((SELECT id,name,active FROM dbo.BusinessProject WHERE account_id=@account ORDER BY name FOR JSON PATH)) AS projects,
  JSON_QUERY((SELECT node_id AS id,kind,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account ORDER BY kind,display_name FOR JSON PATH,INCLUDE_NULL_VALUES)) AS organization,
  JSON_QUERY((SELECT person_id AS personId,bundle,scope_kind AS scopeKind,scope_id AS scopeId,effect,active FROM dbo.BusinessResponsibility WHERE account_id=@account ORDER BY person_id,id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS responsibilities,
  JSON_QUERY((SELECT provider,COUNT_BIG(*) AS files,SUM(CONVERT(bigint,bytes)) AS bytes FROM dbo.PrivateFileObject WHERE account_id=@account GROUP BY provider FOR JSON PATH)) AS privateFiles,
  JSON_QUERY((SELECT skill_id AS id,business_code AS businessCode,display_name AS name,category,status FROM dbo.SkillCatalogue WHERE account_id=@account ORDER BY display_name,skill_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS skillCatalogue,
  JSON_QUERY((SELECT id,name,active FROM dbo.CredentialProvider WHERE account_id=@account ORDER BY name,id FOR JSON PATH)) AS credentialProviders,
  JSON_QUERY((SELECT id,name,provider_id AS providerId,category,active FROM dbo.CredentialDefinition WHERE account_id=@account ORDER BY name,id FOR JSON PATH)) AS credentialDefinitions,
  JSON_QUERY((SELECT f.name,OBJECT_SCHEMA_NAME(f.parent_object_id)+N'.'+OBJECT_NAME(f.parent_object_id) AS childTable,
    OBJECT_SCHEMA_NAME(f.referenced_object_id)+N'.'+OBJECT_NAME(f.referenced_object_id) AS parentTable
    FROM sys.foreign_keys f WHERE f.referenced_object_id=OBJECT_ID(N'dbo.AccessPerson') ORDER BY f.name FOR JSON PATH)) AS personDependencies,
  (SELECT MAX(version) FROM dbo.SchemaMigration) AS latestMigration,
  N'Name/code patterns are review candidates only. No delete authorization is inferred from a name or prefix. Preserve genuine catalogue/configuration; review audit dependencies and backing Blob objects separately.' AS reviewNote
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS preview_json;
 COMMIT TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
END TRY
BEGIN CATCH
 IF CURSOR_STATUS('local','tables')>=0 CLOSE tables;
 IF CURSOR_STATUS('local','tables')>=-1 DEALLOCATE tables;
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
END CATCH;
