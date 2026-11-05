-- Maintenance window only, after 088. Use reviewed account/person/node UUIDs.
-- First run with execute=0. Review every row, then supply that revision and execute=1.
-- Mapping JSON: [{"unitId":"UUID","portfolioId":"UUID","portfolioName":"Name","clientId":"UUID"}]
-- Reuse an existing matching portfolio UUID or explicitly approve a new one.
DECLARE @account uniqueidentifier=NULL,@actor uniqueidentifier=NULL,
 @expected_revision int=NULL,@expected_plan varbinary(32)=NULL,@execute bit=0,@mapping nvarchar(max)=N'[]';
SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRY
 BEGIN TRANSACTION;
 IF @account IS NULL OR @actor IS NULL OR @execute IS NULL OR ISJSON(@mapping)<>1 OR LEFT(LTRIM(@mapping),1)<>'['
  THROW 51000,'Provide the reviewed workspace, actor and complete mapping array.',1;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 THROW 51003,'Run this maintenance script as the approved database operator.',1;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account;
 IF @revision IS NULL THROW 51004,'Active workspace unavailable.',1;
 IF dbo.AccessCan(@account,@actor,'permissions.manage',0)<>1 OR dbo.AccessCan(@account,@actor,'users.manage',0)<>1
  THROW 51003,'The audited actor needs current organization administration.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.SchemaMigration WHERE version=88) THROW 51000,'Install migration 088 before mapping.',1;
 IF @execute=1 AND (@expected_revision IS NULL OR @expected_revision<>@revision)
  THROW 51009,'Workspace changed. Preview the complete mapping again.',1;
 DECLARE @plan varbinary(32)=HASHBYTES('SHA2_256',CONCAT(CONVERT(nvarchar(36),@account),'|',CONVERT(nvarchar(36),@actor),'|',@revision,'|',@mapping));
 IF @execute=1 AND (@expected_plan IS NULL OR @expected_plan<>@plan)
  THROW 51009,'Mapping changed. Use the exact reviewed plan hash and preview again.',1;
 DECLARE @map TABLE(clientId uniqueidentifier PRIMARY KEY,unitId uniqueidentifier NOT NULL,
  portfolioId uniqueidentifier NOT NULL,portfolioName nvarchar(100) NOT NULL);
 IF EXISTS(SELECT 1 FROM OPENJSON(@mapping) j WHERE j.type<>5
  OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.clientId')) IS NULL
  OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.unitId')) IS NULL
  OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(j.value,'$.portfolioId')) IS NULL
  OR NULLIF(LTRIM(RTRIM(JSON_VALUE(j.value,'$.portfolioName'))),'') IS NULL
  OR LEN(JSON_VALUE(j.value,'$.portfolioName'))>100)
  THROW 51000,'Every mapping needs reviewed UUIDs and a Portfolio/Division name of at most 100 characters.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@mapping))<>(SELECT COUNT(DISTINCT JSON_VALUE(value,'$.clientId')) FROM OPENJSON(@mapping))
  THROW 51000,'Each existing client must appear exactly once in the mapping.',1;
 INSERT @map SELECT clientId,unitId,portfolioId,LTRIM(RTRIM(portfolioName)) FROM OPENJSON(@mapping)
 WITH(clientId uniqueidentifier,unitId uniqueidentifier,portfolioId uniqueidentifier,portfolioName nvarchar(100));
 IF NOT EXISTS(SELECT 1 FROM @map) THROW 51000,'Provide all existing client mappings, not an empty plan.',1;
 IF EXISTS(SELECT 1 FROM dbo.AccessOrgNode d WHERE d.account_id=@account AND d.kind='DEPARTMENT'
  AND NOT EXISTS(SELECT 1 FROM @map m WHERE m.clientId=d.node_id))
  THROW 51000,'The mapping must include every existing client, including archived records.',1;
 IF EXISTS(SELECT 1 FROM @map m
  LEFT JOIN dbo.AccessOrgNode d ON d.account_id=@account AND d.node_id=m.clientId AND d.kind='DEPARTMENT'
  LEFT JOIN dbo.AccessOrgNode u ON u.account_id=@account AND u.node_id=m.unitId AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
  WHERE d.node_id IS NULL OR u.node_id IS NULL OR d.parent_id IS NULL OR d.parent_id NOT IN(m.unitId,m.portfolioId))
  THROW 51000,'Review missing/cross-workspace nodes or a client moving outside its approved current delivery unit.',1;
 IF EXISTS(SELECT portfolioId FROM @map GROUP BY portfolioId HAVING COUNT(DISTINCT unitId)>1 OR COUNT(DISTINCT portfolioName)>1)
  OR EXISTS(SELECT unitId,portfolioName FROM @map GROUP BY unitId,portfolioName HAVING COUNT(DISTINCT portfolioId)>1)
  OR EXISTS(SELECT 1 FROM @map m JOIN dbo.AccessOrgNode n ON n.account_id=@account AND
   (n.node_id=m.portfolioId OR n.parent_id=m.unitId AND n.display_name=m.portfolioName)
   WHERE n.node_id<>m.portfolioId OR n.kind<>'PORTFOLIO' OR n.parent_id<>m.unitId OR n.display_name<>m.portfolioName OR n.active<>1)
  THROW 51000,'Portfolio IDs, parent units and names must agree; review conflicting existing nodes.',1;
 SELECT @revision AS previewRevision,CONVERT(varchar(64),@plan,2) AS previewPlanHash,m.unitId,u.display_name AS deliveryUnit,m.portfolioId,m.portfolioName,
 m.clientId,d.display_name AS clientName,d.parent_id AS oldParentId,d.active AS clientActive
 FROM @map m JOIN dbo.AccessOrgNode d ON d.account_id=@account AND d.node_id=m.clientId
 JOIN dbo.AccessOrgNode u ON u.account_id=@account AND u.node_id=m.unitId ORDER BY u.display_name,m.portfolioName,d.display_name;
 IF @execute=0
 BEGIN
  ROLLBACK;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;RETURN;
 END;
 DECLARE @id uniqueidentifier,@unit uniqueidentifier,@name nvarchar(100),@active bit,@payload nvarchar(max);
 DECLARE portfolios CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT portfolioId,unitId,portfolioName FROM @map;
 OPEN portfolios;FETCH NEXT FROM portfolios INTO @id,@unit,@name;
 WHILE @@FETCH_STATUS=0
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account AND node_id=@id)
  BEGIN
   SELECT @payload=(SELECT 'PORTFOLIO' AS type,@name AS name,@unit AS parentId,CONVERT(bit,1) AS active FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   SELECT @revision=revision FROM dbo.AccessWorkspace WHERE account_id=@account;
   EXEC dbo.SaveOrganizationChange @account,@actor,@revision,'node',@id,1,@payload;
  END;
  FETCH NEXT FROM portfolios INTO @id,@unit,@name;
 END;
 CLOSE portfolios;DEALLOCATE portfolios;
 DECLARE clients CURSOR LOCAL FAST_FORWARD FOR
 SELECT m.clientId,m.portfolioId,d.display_name,d.active FROM @map m
 JOIN dbo.AccessOrgNode d ON d.account_id=@account AND d.node_id=m.clientId WHERE d.parent_id<>m.portfolioId;
 OPEN clients;FETCH NEXT FROM clients INTO @id,@unit,@name,@active;
 WHILE @@FETCH_STATUS=0
 BEGIN
  SELECT @payload=(SELECT 'DEPARTMENT' AS type,@name AS name,@unit AS parentId,@active AS active FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SELECT @revision=revision FROM dbo.AccessWorkspace WHERE account_id=@account;
  EXEC dbo.SaveOrganizationChange @account,@actor,@revision,'node',@id,0,@payload;
  FETCH NEXT FROM clients INTO @id,@unit,@name,@active;
 END;
 CLOSE clients;DEALLOCATE clients;
 COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
END CATCH;
