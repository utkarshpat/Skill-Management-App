-- Explicit Business Analytics Portfolio/Division scopes and narrowing hierarchy filters.
-- Does not grant access, backfill placements, or change direct-manager review policy.
DECLARE @table sysname,@constraint sysname,@sql nvarchar(max);
DECLARE scope_tables CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.tables WHERE name IN('BusinessResponsibility','BusinessDemand') AND schema_id=SCHEMA_ID('dbo');
OPEN scope_tables;FETCH NEXT FROM scope_tables INTO @table;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @constraint=NULL;
 SELECT @constraint=name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.'+@table) AND definition LIKE '%scope_kind%' AND definition LIKE '%DELIVERY_UNIT%' AND definition NOT LIKE '%scope_id%';
 IF @constraint IS NULL THROW 51000,'Business scope constraint unavailable. Review schema.',1;
 SET @sql=N'ALTER TABLE dbo.'+QUOTENAME(@table)+N' DROP CONSTRAINT '+QUOTENAME(@constraint);EXEC sys.sp_executesql @sql;
 SET @sql=N'ALTER TABLE dbo.'+QUOTENAME(@table)+N' ADD CONSTRAINT '+QUOTENAME('CK_'+@table+'_ScopeKind')+N' CHECK(scope_kind IN(''ORGANIZATION'',''DELIVERY_UNIT'',''PORTFOLIO'',''DEPARTMENT'',''PROJECT''))';EXEC sys.sp_executesql @sql;
 FETCH NEXT FROM scope_tables INTO @table;
END;
CLOSE scope_tables;DEALLOCATE scope_tables;

GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeValid(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier) RETURNS bit AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WHERE account_id=@account AND status='ACTIVE') RETURN 0;
 IF @kind='ORGANIZATION' AND @scope IS NULL RETURN 1;
 IF @kind='PROJECT' AND EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account AND id=@scope AND active=1) RETURN 1;
 IF @kind='PORTFOLIO' AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode f JOIN dbo.AccessOrgNode u ON u.account_id=f.account_id AND u.node_id=f.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL WHERE f.account_id=@account AND f.node_id=@scope AND f.kind='PORTFOLIO' AND f.active=1) RETURN 1;
 IF @kind='DEPARTMENT' AND EXISTS(SELECT 1 FROM dbo.OrganizationClientPath(@account) WHERE department_id=@scope) RETURN 1;
 IF @kind='DELIVERY_UNIT' AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account AND node_id=@scope AND kind='DELIVERY_UNIT' AND active=1 AND parent_id IS NULL) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopePeople(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier) RETURNS TABLE AS RETURN (
 SELECT members.person_id FROM (
 SELECT p.person_id FROM dbo.AccessPerson p WHERE p.account_id=@account AND p.active=1 AND @kind='ORGANIZATION'
 UNION ALL
 SELECT m.person_id FROM dbo.BusinessProjectMember m
 JOIN dbo.BusinessProject p ON p.account_id=m.account_id AND p.id=m.project_id AND p.active=1
 JOIN dbo.AccessPerson person ON person.account_id=m.account_id AND person.person_id=m.person_id AND person.active=1
 WHERE m.account_id=@account AND m.active=1 AND @kind='PROJECT' AND m.project_id=@scope
 UNION ALL
 SELECT a.person_id FROM dbo.AccessOrgAssignment a
 JOIN dbo.AccessPerson p ON p.account_id=a.account_id AND p.person_id=a.person_id AND p.active=1
 LEFT JOIN dbo.AccessOrgNode t ON t.account_id=a.account_id AND t.node_id=a.team_id AND t.kind='TEAM' AND t.active=1
 JOIN dbo.OrganizationClientPath(@account) path ON path.department_id=COALESCE(a.department_id,t.parent_id)
 WHERE a.account_id=@account AND (a.team_id IS NULL OR a.department_id IS NULL)
 AND (@kind='PORTFOLIO' AND path.portfolio_id=@scope OR @kind='DEPARTMENT' AND path.department_id=@scope OR @kind='DELIVERY_UNIT' AND path.unit_id=@scope)
 ) members WHERE dbo.BusinessScopeValid(@account,@kind,@scope)=1
);
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeCovers(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier,@targetKind varchar(20),@target uniqueidentifier) RETURNS bit AS BEGIN
 IF dbo.BusinessScopeValid(@account,@kind,@scope)<>1 OR dbo.BusinessScopeValid(@account,@targetKind,@target)<>1 RETURN 0;
 IF @kind='ORGANIZATION' RETURN 1;
 IF @kind=@targetKind AND @scope=@target RETURN 1;
 IF @kind='DELIVERY_UNIT' AND @targetKind='DEPARTMENT' AND EXISTS(
 SELECT 1 FROM dbo.OrganizationClientPath(@account) WHERE department_id=@target AND unit_id=@scope) RETURN 1;
 IF @kind='DELIVERY_UNIT' AND @targetKind='PORTFOLIO' AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account AND node_id=@target AND parent_id=@scope AND kind='PORTFOLIO' AND active=1) RETURN 1;
 IF @kind='PORTFOLIO' AND @targetKind='DEPARTMENT' AND EXISTS(SELECT 1 FROM dbo.OrganizationClientPath(@account) WHERE department_id=@target AND portfolio_id=@scope) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessResponsibilityUsable(@account uniqueidentifier,@actor uniqueidentifier,@grant uniqueidentifier) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility g WHERE g.account_id=@account AND g.person_id=@actor AND g.id=@grant AND g.active=1 AND g.effect='ALLOW' AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME()) AND dbo.BusinessScopeValid(g.account_id,g.scope_kind,g.scope_id)=1
 AND NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility d WHERE d.account_id=g.account_id AND d.person_id=g.person_id AND d.active=1 AND d.effect='DENY' AND (d.valid_until IS NULL OR d.valid_until>SYSUTCDATETIME()) AND
 dbo.BusinessScopeCovers(@account,d.scope_kind,d.scope_id,g.scope_kind,g.scope_id)=1)) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessHierarchy(@account uniqueidentifier,@actor uniqueidentifier) RETURNS TABLE AS RETURN (
 SELECT n.node_id AS id,n.kind,n.display_name AS name,n.parent_id AS parentId
 FROM dbo.AccessOrgNode n
 WHERE n.account_id=@account AND n.kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT') AND dbo.BusinessScopeValid(@account,n.kind,n.node_id)=1
 AND EXISTS(SELECT 1 FROM dbo.BusinessScopePeople(@account,n.kind,n.node_id) members JOIN dbo.BusinessVisiblePeople(@account,@actor,NULL) visible ON visible.person_id=members.person_id)
);

GO
CREATE OR ALTER FUNCTION dbo.BusinessProjection(@account uniqueidentifier,@actor uniqueidentifier) RETURNS nvarchar(max) AS BEGIN
 DECLARE @result nvarchar(max);
 SELECT @result=(SELECT w.personal_baseline_enabled AS personalBaseline,dbo.BusinessHasAccess(@account,@actor) AS [view],
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'reports.export')=0 THEN 1 ELSE 0 END) AS [export],
 dbo.BusinessSystemAdmin(@account,@actor) AS systemAdmin,dbo.BusinessAmendCan(@account,@actor) AS amend,
 CONVERT(bit,CASE WHEN dbo.AccessCan(@account,@actor,'profile.view',1)=1 AND dbo.AccessCan(@account,@actor,'permissions.manage',0)=1 AND dbo.AccessCan(@account,@actor,'users.manage',0)=1 AND dbo.AccessCan(@account,@actor,'audit.view',0)=1 THEN 1 ELSE 0 END) AS manage,
 CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account AND person_id=@actor AND bundle='SYSTEM_ADMIN' AND active=1 AND effect='DENY' AND valid_until>SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS adminDenied,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS demandView,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.AccessCan(@account,@actor,'skill.view',0)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.create')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS demandCreate,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.view')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS matchingView,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.run')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.view')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS matchingRun,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account,@actor)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.shortlist')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.run')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'matching.view')=0 AND dbo.BusinessLegacyDenied(@account,@actor,'demand.view')=0 THEN 1 ELSE 0 END) AS shortlist,
 CONVERT(bit,CASE WHEN dbo.AccessCan(@account,@actor,'permissions.manage',0)=1 AND dbo.AccessCan(@account,@actor,'users.manage',0)=1 AND dbo.AccessCan(@account,@actor,'audit.view',0)=1 AND dbo.AccessCan(@account,@actor,'skill.catalogue.manage',0)=1 AND dbo.BusinessLegacyDenied(@account,@actor,'request.approve')=0 THEN 1 ELSE 0 END) AS approve,
 JSON_QUERY((SELECT g.id,g.bundle,g.scope_kind AS kind,g.scope_id AS scopeId,COALESCE(p.name,n.display_name,N'Organization') AS label,g.effect,g.valid_until AS validUntil,g.reason FROM dbo.BusinessResponsibility g LEFT JOIN dbo.BusinessProject p ON g.scope_kind='PROJECT' AND p.account_id=g.account_id AND p.id=g.scope_id LEFT JOIN dbo.AccessOrgNode n ON g.scope_kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT') AND n.account_id=g.account_id AND n.node_id=g.scope_id WHERE g.account_id=@account AND g.person_id=@actor AND g.active=1 AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME()) AND dbo.BusinessScopeValid(@account,g.scope_kind,g.scope_id)=1 AND (g.effect='DENY' OR dbo.BusinessResponsibilityUsable(@account,@actor,g.id)=1) FOR JSON PATH,INCLUDE_NULL_VALUES)) AS scopes FROM dbo.AccessWorkspace w WHERE w.account_id=@account FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 RETURN @result;
END;
GO
CREATE OR ALTER PROCEDURE dbo.BusinessContext @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @lock int;SELECT @lock=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Personal access denied.',1;
 DECLARE @policy nvarchar(max)=dbo.BusinessProjection(@account_id,@actor_id);
 SELECT (SELECT w.revision,@actor_id AS actorId,SYSUTCDATETIME() AS asOf,dbo.BusinessHasAccess(@account_id,@actor_id) AS canView,
 CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account_id,@actor_id)=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,
 CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS canManage,
 dbo.BusinessAmendCan(@account_id,@actor_id) AS canAmend,
 CONVERT(bit,JSON_VALUE(@policy,'$.demandView')) AS canDemandView,CONVERT(bit,JSON_VALUE(@policy,'$.demandCreate')) AS canDemandCreate,CONVERT(bit,JSON_VALUE(@policy,'$.matchingRun')) AS canMatch,CONVERT(bit,JSON_VALUE(@policy,'$.shortlist')) AS canShortlist,CONVERT(bit,JSON_VALUE(@policy,'$.approve')) AS canApprove,
 w.personal_baseline_enabled AS personalBaseline,JSON_QUERY(JSON_QUERY(@policy,'$.scopes')) AS scopes,JSON_QUERY((SELECT * FROM dbo.BusinessHierarchy(@account_id,@actor_id) ORDER BY kind,name,id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS hierarchy FROM dbo.AccessWorkspace w WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.SaveBusinessChange @account_id uniqueidentifier,@actor_id uniqueidentifier,@expected_revision int,@kind varchar(30),@id uniqueidentifier,@payload nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Administration denied.',1;
 IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Access changed. Preview again.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>10000 OR @id IS NULL OR NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.reason'))),'') IS NULL THROW 51000,'Explain a valid change.',1;
 DECLARE @before nvarchar(max),@after nvarchar(max),@active bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.active')),@person uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.personId')),
 @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),@scopeKind varchar(20)=JSON_VALUE(@payload,'$.kind'),@bundle varchar(30)=JSON_VALUE(@payload,'$.bundle'),@effect varchar(5)=JSON_VALUE(@payload,'$.effect'),@until datetime2=TRY_CONVERT(datetime2,JSON_VALUE(@payload,'$.validUntil')),
 @reason nvarchar(1000)=JSON_VALUE(@payload,'$.reason'),@department uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.departmentId'));
 IF @kind='PROJECT' BEGIN
  IF @active IS NULL OR NULLIF(LTRIM(RTRIM(JSON_VALUE(@payload,'$.name'))),'') IS NULL OR LEN(JSON_VALUE(@payload,'$.name'))>100 THROW 51000,'Invalid project.',1;
  IF @department IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@department AND kind='DEPARTMENT' AND active=1) THROW 51000,'Choose an active department.',1;
  SELECT @before=(SELECT * FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@id) UPDATE dbo.BusinessProject SET name=JSON_VALUE(@payload,'$.name'),department_id=@department,active=@active WHERE account_id=@account_id AND id=@id;
  ELSE INSERT dbo.BusinessProject VALUES(@account_id,@id,JSON_VALUE(@payload,'$.name'),@department,@active);
 END ELSE IF @kind='MEMBERSHIP' BEGIN
  DECLARE @project uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.projectId'));
  IF @active IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person AND (@active=0 OR active=1)) OR NOT EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@project AND (@active=0 OR active=1)) THROW 51000,'Choose an active person and project.',1;
  SELECT @before=(SELECT * FROM dbo.BusinessProjectMember WHERE account_id=@account_id AND project_id=@project AND person_id=@person FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.BusinessProjectMember WHERE account_id=@account_id AND project_id=@project AND person_id=@person) UPDATE dbo.BusinessProjectMember SET active=@active WHERE account_id=@account_id AND project_id=@project AND person_id=@person;
  ELSE INSERT dbo.BusinessProjectMember VALUES(@account_id,@project,@person,@active);
 END ELSE IF @kind='RESPONSIBILITY' BEGIN
  IF @active IS NULL OR @scopeKind IS NULL OR @scopeKind NOT IN('ORGANIZATION','DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','PROJECT') OR @bundle IS NULL OR @bundle NOT IN('SYSTEM_ADMIN','BUSINESS_OPERATIONS') OR @effect IS NULL OR @effect NOT IN('ALLOW','DENY') OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person AND (@active=0 OR active=1)) THROW 51000,'Invalid responsibility.',1;
  IF @bundle='SYSTEM_ADMIN' AND @scopeKind<>'ORGANIZATION' OR @scopeKind='ORGANIZATION' AND @scope IS NOT NULL OR @scopeKind<>'ORGANIZATION' AND @scope IS NULL THROW 51000,'Invalid scope binding.',1;
  IF JSON_VALUE(@payload,'$.validUntil') IS NOT NULL AND (@until IS NULL OR @active=1 AND @until<=SYSUTCDATETIME()) OR @effect='DENY' AND @until IS NULL THROW 51000,'Exception needs future expiry.',1;
  IF @scopeKind='PROJECT' AND NOT EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account_id AND id=@scope AND (@active=0 OR active=1)) OR @scopeKind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT') AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@scope AND kind=@scopeKind AND (@active=0 OR active=1)) THROW 51000,'Choose an active scope in this account.',1;
  IF @active=1 AND dbo.BusinessScopeValid(@account_id,@scopeKind,@scope)<>1 THROW 51000,'Choose a complete active hierarchy scope.',1;
  SELECT @before=(SELECT * FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND id=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND id=@id) UPDATE dbo.BusinessResponsibility SET person_id=@person,bundle=@bundle,scope_kind=@scopeKind,scope_id=@scope,effect=@effect,active=@active,valid_until=@until,reason=@reason WHERE account_id=@account_id AND id=@id;
  ELSE INSERT dbo.BusinessResponsibility VALUES(@account_id,@id,@person,@bundle,@scopeKind,@scope,@effect,@active,@until,@reason);
 END ELSE IF @kind='PERSONAL_BASELINE' BEGIN
  DECLARE @enabled bit=TRY_CONVERT(bit,JSON_VALUE(@payload,'$.enabled'));IF @enabled IS NULL THROW 51000,'Choose baseline state.',1;
  SELECT @before=(SELECT personal_baseline_enabled AS enabled FROM dbo.AccessWorkspace WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  UPDATE dbo.AccessWorkspace SET personal_baseline_enabled=@enabled WHERE account_id=@account_id;
 END ELSE THROW 51000,'Unsupported change.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND dbo.AccessCan(@account_id,person_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,person_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,person_id,'audit.view',0)=1 AND dbo.AccessCan(@account_id,person_id,'profile.view',1)=1) THROW 51000,'Keep at least one active access administrator.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,target_id,action,occurred_at,before_json,after_json) VALUES(@account_id,@revision+1,@actor_id,@id,'business.'+LOWER(@kind),SYSUTCDATETIME(),@before,@payload);
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.BusinessDashboard @account_id uniqueidentifier,@actor_id uniqueidentifier,@payload nvarchar(max),@export bit=0 AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.BusinessHasAccess(@account_id,@actor_id)<>1 OR @export=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=1 THROW 51003,'Business access denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>10000 THROW 51000,'Invalid query.',1;
 DECLARE @asof datetime2=SYSUTCDATETIME(),@scopeSnapshot nvarchar(max)=JSON_QUERY(dbo.BusinessProjection(@account_id,@actor_id),'$.scopes');
 DECLARE @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),@dataset varchar(20)=JSON_VALUE(@payload,'$.dataset'),@sort varchar(20)=ISNULL(JSON_VALUE(@payload,'$.sort'),'updated_desc'),@search nvarchar(100)=ISNULL(JSON_VALUE(@payload,'$.search'),''),
 @status varchar(20)=ISNULL(JSON_VALUE(@payload,'$.status'),''),@validity varchar(10)=ISNULL(JSON_VALUE(@payload,'$.validity'),''),@category nvarchar(80)=ISNULL(JSON_VALUE(@payload,'$.category'),''),@issuer nvarchar(120)=ISNULL(JSON_VALUE(@payload,'$.issuer'),''),
 @skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),@rank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.minRank')),@maxRank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.maxRank')),@page int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),@from date=TRY_CONVERT(date,NULLIF(JSON_VALUE(@payload,'$.from'),'')),@to date=TRY_CONVERT(date,NULLIF(JSON_VALUE(@payload,'$.to'),'')),@today date=CONVERT(date,@asof);
 IF @sort NOT IN('employee_asc','employee_desc','name_asc','updated_desc','expiry_asc','certified_desc') THROW 51000,'Invalid sort.',1;
 IF @dataset IS NULL OR @dataset NOT IN('people','skills','certifications','submissions') OR @status NOT IN('','SUBMITTED','APPROVED','CHANGES_REQUESTED','REJECTED') OR @validity NOT IN('','CURRENT','EXPIRED','14','30','60','90','15_30','31_60','61_90','NO_EXPIRY','LATER') OR @rank IS NULL OR @rank NOT BETWEEN 1 AND 4 OR @maxRank IS NULL OR @maxRank NOT BETWEEN @rank AND 4 OR @page IS NULL OR @page NOT BETWEEN 1 AND 10000 THROW 51000,'Invalid filters.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='scopeId') AND (@scope IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND person_id=@actor_id AND id=@scope AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,id)=1)) THROW 51003,'Selected scope unavailable.',1;
 DECLARE @hierarchy uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.hierarchyId')),@hierarchyKind varchar(20);
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='hierarchyId') BEGIN
  SELECT @hierarchyKind=kind FROM dbo.BusinessHierarchy(@account_id,@actor_id) WHERE id=@hierarchy;
  IF @hierarchyKind IS NULL THROW 51003,'Selected hierarchy unavailable.',1;
 END;
 SELECT p.person_id,p.display_name,p.employee_code INTO #people FROM dbo.AccessPerson p JOIN dbo.BusinessVisiblePeople(@account_id,@actor_id,@scope) visible ON visible.person_id=p.person_id WHERE p.account_id=@account_id AND (@hierarchy IS NULL OR EXISTS(SELECT 1 FROM dbo.BusinessScopePeople(@account_id,@hierarchyKind,@hierarchy) h WHERE h.person_id=p.person_id)) AND (@search='' OR CHARINDEX(@search,p.display_name)>0 OR CHARINDEX(@search,p.employee_code)>0);
 CREATE UNIQUE CLUSTERED INDEX IX_People ON #people(person_id);
 SELECT c.claim_id AS id,c.person_id,c.skill_id,c.skill_name AS name,c.category,c.claimed_rank AS recorded_rank,CASE WHEN EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') THEN c.claimed_rank ELSE NULL END AS rank,c.status,c.reviewer_id,c.submitted_at,c.reviewed_at,c.updated_at INTO #skills FROM dbo.SkillClaimDraft c JOIN #people p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND c.status<>'DRAFT' AND (@category='' OR c.category=@category) AND (@skill IS NULL OR c.skill_id=@skill) AND (@rank=1 AND @maxRank=4 OR (CASE WHEN EXISTS(SELECT 1 FROM dbo.SkillDefinitionVersion v WHERE v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003') THEN c.claimed_rank ELSE NULL END) BETWEEN @rank AND @maxRank);
 SELECT c.id,c.person_id,c.certification_name AS name,c.provider AS issuer,c.category,c.issue_date,c.expiry_date,c.status,c.reviewer_id,c.submitted_at,c.reviewed_at,c.updated_at,CAST(dbo.CertificationIdentityText(c.certification_name) AS nvarchar(200)) COLLATE Latin1_General_100_CI_AS AS identity_name,CAST(dbo.CertificationIdentityText(c.provider) AS nvarchar(120)) COLLATE Latin1_General_100_CI_AS AS identity_issuer INTO #certs FROM dbo.CurrentCertificationRecord c JOIN #people p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND c.status<>'DRAFT' AND (@skill IS NULL OR EXISTS(SELECT 1 FROM dbo.SkillCertificationLink l JOIN #skills supporting ON supporting.id=l.claim_id WHERE l.account_id=@account_id AND l.certification_id=c.id AND l.published=1 AND supporting.skill_id=@skill)) AND (@category='' OR c.category=@category) AND (@issuer='' OR c.provider=@issuer) AND (@validity='' OR @validity='EXPIRED' AND c.expiry_date<@today OR @validity='CURRENT' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) OR @validity IN('14','30','60','90') AND c.expiry_date BETWEEN @today AND DATEADD(day,TRY_CONVERT(int,@validity),@today) OR @validity='15_30' AND c.expiry_date BETWEEN DATEADD(day,15,@today) AND DATEADD(day,30,@today) OR @validity='31_60' AND c.expiry_date BETWEEN DATEADD(day,31,@today) AND DATEADD(day,60,@today) OR @validity='61_90' AND c.expiry_date BETWEEN DATEADD(day,61,@today) AND DATEADD(day,90,@today) OR @validity='NO_EXPIRY' AND c.expiry_date IS NULL OR @validity='LATER' AND c.expiry_date>DATEADD(day,90,@today));
 CREATE INDEX IX_CertIdentity ON #certs(identity_issuer,identity_name,person_id) INCLUDE(status,issue_date,expiry_date);
 CREATE INDEX IX_SkillHolders ON #skills(skill_id,rank,person_id) INCLUDE(status);
 DECLARE @rows nvarchar(max),@total int,@size int=CASE WHEN @export=1 THEN 50000 ELSE 25 END,@offset int=CASE WHEN @export=1 THEN 0 ELSE (@page-1)*25 END;
 IF @dataset='people' BEGIN
  SELECT p.person_id,ISNULL(h.total,0) AS currentCertifications,CASE WHEN ISNULL(h.total,0)>0 THEN DENSE_RANK() OVER(ORDER BY ISNULL(h.total,0) DESC) END AS certificationRank INTO #ranking
  FROM #people p LEFT JOIN (SELECT person_id,COUNT(DISTINCT CONVERT(nvarchar(10),LEN(identity_issuer))+N':'+LOWER(identity_issuer)+LOWER(identity_name)) AS total FROM #certs WHERE status='APPROVED' AND issue_date<=@today AND (expiry_date IS NULL OR expiry_date>=@today) GROUP BY person_id) h ON h.person_id=p.person_id
  WHERE (@validity='' AND @issuer='' OR EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id));
  SELECT @total=COUNT(*) FROM #people p WHERE (@validity='' AND @issuer='' OR EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id));
  SELECT @rows=(SELECT p.person_id AS id,p.display_name AS employee,p.employee_code AS employeeCode,(SELECT COUNT(*) FROM #skills s WHERE s.person_id=p.person_id AND s.status='APPROVED') AS reviewedSkills,r.currentCertifications,r.certificationRank FROM #people p JOIN #ranking r ON r.person_id=p.person_id WHERE (@validity='' AND @issuer='' OR EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id)) AND (@skill IS NULL OR EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id)) ORDER BY CASE WHEN @sort='certified_desc' THEN r.currentCertifications END DESC,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort<>'employee_desc' THEN p.display_name END,p.person_id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END ELSE IF @dataset='submissions' BEGIN
  SELECT 'skill-'+CONVERT(varchar(36),s.id) AS id,s.person_id,'SKILL' AS type,s.name,s.category,s.status,s.reviewer_id,s.submitted_at,s.reviewed_at,s.updated_at INTO #submissions FROM #skills s WHERE @status='' OR s.status=@status
  UNION ALL SELECT 'certification-'+CONVERT(varchar(36),c.id),c.person_id,'CERTIFICATION',c.name,c.category,c.status,c.reviewer_id,c.submitted_at,c.reviewed_at,c.updated_at FROM #certs c WHERE @status='' OR c.status=@status;
  SELECT @total=COUNT(*) FROM #submissions;
  SELECT @rows=(SELECT s.id,p.display_name AS employee,p.employee_code AS employeeCode,s.type,s.name,s.category,s.status,s.submitted_at AS submittedAt,s.reviewed_at AS reviewedAt,CASE WHEN s.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,(SELECT reviewer.display_name FROM dbo.AccessPerson reviewer WHERE reviewer.account_id=@account_id AND reviewer.person_id=s.reviewer_id AND s.reviewed_at IS NOT NULL) AS reviewedBy,CONVERT(bit,CASE WHEN s.status IN('SUBMITTED','APPROVED') AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'evidence.view')=0 THEN 1 ELSE 0 END) AS canViewFiles FROM #submissions s JOIN #people p ON p.person_id=s.person_id ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN s.name END,s.updated_at DESC,s.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END ELSE IF @dataset='skills' BEGIN
  SELECT @total=COUNT(*) FROM #skills WHERE @status='' OR status=@status;
  SELECT @rows=(SELECT s.id,p.display_name AS employee,p.employee_code AS employeeCode,s.name,s.category,s.recorded_rank AS recordedRank,s.rank AS chartRank,(SELECT COUNT(*) FROM dbo.SkillCertificationLink l JOIN dbo.CurrentCertificationRecord c ON c.account_id=l.account_id AND c.id=l.certification_id WHERE l.account_id=@account_id AND l.claim_id=s.id AND l.published=1 AND c.status='APPROVED') AS reviewedCertificates,s.status,s.submitted_at AS submittedAt,s.reviewed_at AS reviewedAt,CASE WHEN s.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,(SELECT reviewer.display_name FROM dbo.AccessPerson reviewer WHERE reviewer.account_id=@account_id AND reviewer.person_id=s.reviewer_id AND s.reviewed_at IS NOT NULL) AS reviewedBy,CONVERT(bit,CASE WHEN s.status IN('SUBMITTED','APPROVED') AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'evidence.view')=0 THEN 1 ELSE 0 END) AS canViewFiles FROM #skills s JOIN #people p ON p.person_id=s.person_id WHERE @status='' OR s.status=@status ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN s.name END,s.updated_at DESC,s.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END ELSE BEGIN
  SELECT @total=COUNT(*) FROM #certs WHERE @status='' OR status=@status;
  SELECT @rows=(SELECT c.id,p.display_name AS employee,p.employee_code AS employeeCode,c.name,c.issuer,c.category,(SELECT COUNT(*) FROM dbo.SkillCertificationLink l JOIN dbo.SkillClaimDraft s ON s.account_id=l.account_id AND s.claim_id=l.claim_id WHERE l.account_id=@account_id AND l.certification_id=c.id AND l.published=1 AND s.status IN('SUBMITTED','APPROVED')) AS linkedSkills,c.status,CASE WHEN c.expiry_date IS NULL THEN 'NO_EXPIRY' WHEN c.expiry_date<@today THEN 'EXPIRED' ELSE 'CURRENT' END AS validity,c.issue_date AS issued,c.expiry_date AS expiry,c.submitted_at AS submittedAt,c.reviewed_at AS reviewedAt,CASE WHEN c.submitted_at IS NOT NULL THEN p.display_name END AS submittedBy,(SELECT reviewer.display_name FROM dbo.AccessPerson reviewer WHERE reviewer.account_id=@account_id AND reviewer.person_id=c.reviewer_id AND c.reviewed_at IS NOT NULL) AS reviewedBy,CONVERT(bit,CASE WHEN c.status IN('SUBMITTED','APPROVED') AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'evidence.view')=0 THEN 1 ELSE 0 END) AS canViewFiles FROM #certs c JOIN #people p ON p.person_id=c.person_id WHERE @status='' OR c.status=@status ORDER BY CASE WHEN @sort='employee_asc' THEN p.display_name END,CASE WHEN @sort='employee_desc' THEN p.display_name END DESC,CASE WHEN @sort='name_asc' THEN c.name END,CASE WHEN @sort='expiry_asc' THEN COALESCE(c.expiry_date,'9999-12-31') END,c.updated_at DESC,c.id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
 END;
 IF @export=1 AND @total>50000 THROW 51000,'Export exceeds 50000 rows. Narrow the filters.',1;
 SELECT (SELECT JSON_QUERY((SELECT @revision AS revision,@actor_id AS actorId,@asof AS asOf,CAST(1 AS bit) AS canView,CONVERT(bit,CASE WHEN dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS canManage,dbo.BusinessAmendCan(@account_id,@actor_id) AS canAmend,w.personal_baseline_enabled AS personalBaseline,JSON_QUERY(@scopeSnapshot) AS scopes,JSON_QUERY((SELECT * FROM dbo.BusinessHierarchy(@account_id,@actor_id) ORDER BY kind,name,id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS hierarchy FROM dbo.AccessWorkspace w WHERE w.account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS context,
 JSON_QUERY((SELECT (SELECT COUNT(*) FROM #people) AS employees,(SELECT COUNT(DISTINCT person_id) FROM #certs WHERE status='APPROVED' AND issue_date<=@today AND (expiry_date IS NULL OR expiry_date>=@today)) AS certified,(SELECT COUNT(DISTINCT person_id) FROM #skills WHERE status='APPROVED') AS skilled,(SELECT COUNT(*) FROM #skills WHERE status='SUBMITTED')+(SELECT COUNT(*) FROM #certs WHERE status='SUBMITTED') AS pending,(SELECT COUNT(*) FROM #certs WHERE expiry_date<@today) AS expired,(SELECT COUNT(*) FROM #certs WHERE expiry_date BETWEEN @today AND DATEADD(day,30,@today)) AS expiring FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS summary,
 JSON_QUERY((SELECT c.skill_id AS id,c.display_name AS label,c.category,levels.rank,COUNT(DISTINCT holding.person_id) AS holders
 FROM dbo.SkillCatalogue c JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision AND v.framework_id='00000000-0000-4000-8000-000000000003'
 CROSS JOIN (VALUES(1),(2),(3),(4)) levels(rank)
 LEFT JOIN #skills holding ON holding.skill_id=c.skill_id AND holding.rank=levels.rank AND holding.status='APPROVED'
 WHERE c.account_id=@account_id AND c.status='PUBLISHED' AND (@skill IS NULL OR c.skill_id=@skill) AND (@category='' OR c.category=@category) AND levels.rank BETWEEN @rank AND @maxRank
 GROUP BY c.skill_id,c.display_name,c.category,levels.rank ORDER BY c.display_name,c.skill_id,levels.rank FOR JSON PATH)) AS coverage,
 CONVERT(bit,1) AS coverageComplete,
 JSON_QUERY((SELECT d.id,d.name,p.name AS issuer,d.category,COUNT(DISTINCT CASE WHEN c.status='APPROVED' THEN c.person_id END) AS reviewedHolders,
 COUNT(DISTINCT CASE WHEN c.status='APPROVED' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) THEN c.person_id END) AS currentHolders,
 COUNT(DISTINCT CASE WHEN c.status='APPROVED' AND c.expiry_date<@today THEN c.person_id END) AS expiredHolders
 FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id AND p.active=1
 LEFT JOIN #certs c ON c.identity_name=dbo.CertificationIdentityText(d.name) COLLATE Latin1_General_100_CI_AS AND c.identity_issuer=dbo.CertificationIdentityText(p.name) COLLATE Latin1_General_100_CI_AS
 WHERE d.account_id=@account_id AND d.active=1 AND (@category='' OR d.category=@category) AND (@issuer='' OR p.name=@issuer)
 GROUP BY d.id,d.name,p.name,d.category ORDER BY currentHolders DESC,d.name,p.name,d.id FOR JSON PATH)) AS credentialCoverage,
 JSON_QUERY((SELECT c.name,c.issuer,COUNT(DISTINCT CASE WHEN c.status='APPROVED' THEN c.person_id END) AS reviewedHolders,
 COUNT(DISTINCT CASE WHEN c.status='APPROVED' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) THEN c.person_id END) AS currentHolders,
 COUNT(DISTINCT CASE WHEN c.status='APPROVED' AND c.expiry_date<@today THEN c.person_id END) AS expiredHolders
 FROM #certs c WHERE c.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM dbo.CredentialDefinition d JOIN dbo.CredentialProvider p ON p.account_id=d.account_id AND p.id=d.provider_id AND p.active=1
 WHERE d.account_id=@account_id AND d.active=1 AND c.identity_name=dbo.CertificationIdentityText(d.name) COLLATE Latin1_General_100_CI_AS AND c.identity_issuer=dbo.CertificationIdentityText(p.name) COLLATE Latin1_General_100_CI_AS)
 GROUP BY c.name,c.issuer ORDER BY c.name,c.issuer FOR JSON PATH)) AS uncataloguedCredentials,
 JSON_QUERY((SELECT TOP(15) issuer AS label,COUNT(*) AS value FROM #certs WHERE status='APPROVED' GROUP BY issuer ORDER BY value DESC,issuer FOR JSON PATH)) AS distribution,
 JSON_QUERY((SELECT TOP(15) category AS label,COUNT(*) AS value FROM #certs WHERE status='APPROVED' GROUP BY category ORDER BY value DESC,category FOR JSON PATH)) AS categories,
 JSON_QUERY((SELECT TOP(30) g.id,g.scope_kind AS kind,COALESCE(project.name,node.display_name,N'Organization') AS label,counts.employees,counts.certified,counts.skilled FROM dbo.BusinessResponsibility g LEFT JOIN dbo.BusinessProject project ON project.account_id=g.account_id AND project.id=g.scope_id AND g.scope_kind='PROJECT' LEFT JOIN dbo.AccessOrgNode node ON node.account_id=g.account_id AND node.node_id=g.scope_id AND g.scope_kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT') CROSS APPLY (SELECT COUNT(*) AS employees,ISNULL(SUM(holding.certified),0) AS certified,ISNULL(SUM(holding.skilled),0) AS skilled FROM #people p JOIN dbo.BusinessScopePeople(@account_id,g.scope_kind,g.scope_id) members ON members.person_id=p.person_id CROSS APPLY(SELECT CASE WHEN EXISTS(SELECT 1 FROM #certs c WHERE c.person_id=p.person_id AND c.status='APPROVED' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today)) THEN 1 ELSE 0 END AS certified,CASE WHEN EXISTS(SELECT 1 FROM #skills s WHERE s.person_id=p.person_id AND s.status='APPROVED') THEN 1 ELSE 0 END AS skilled) holding) counts WHERE g.account_id=@account_id AND g.person_id=@actor_id AND g.active=1 AND g.effect='ALLOW' AND (g.valid_until IS NULL OR g.valid_until>@asof) AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,g.id)=1 ORDER BY label,g.id FOR JSON PATH)) AS comparisons,
 JSON_QUERY((SELECT CASE WHEN expiry_date<@today THEN 'Expired' WHEN expiry_date IS NULL THEN 'No expiry' WHEN expiry_date<=DATEADD(day,14,@today) THEN '14 days' WHEN expiry_date<=DATEADD(day,30,@today) THEN '30 days' WHEN expiry_date<=DATEADD(day,60,@today) THEN '60 days' WHEN expiry_date<=DATEADD(day,90,@today) THEN '90 days' ELSE 'Later' END AS label,COUNT(*) AS value FROM #certs GROUP BY CASE WHEN expiry_date<@today THEN 'Expired' WHEN expiry_date IS NULL THEN 'No expiry' WHEN expiry_date<=DATEADD(day,14,@today) THEN '14 days' WHEN expiry_date<=DATEADD(day,30,@today) THEN '30 days' WHEN expiry_date<=DATEADD(day,60,@today) THEN '60 days' WHEN expiry_date<=DATEADD(day,90,@today) THEN '90 days' ELSE 'Later' END FOR JSON PATH)) AS expiry,
 JSON_QUERY((SELECT CONVERT(char(7),at,126) AS label,SUM(submission) AS submissions,SUM(decision) AS decisions FROM (SELECT a.occurred_at AS at,CASE WHEN a.action IN('claim.submitted','certification.submitted') THEN 1 ELSE 0 END AS submission,CASE WHEN a.action IN('claim.submitted','certification.submitted') THEN 0 ELSE 1 END AS decision
 FROM dbo.AccessAudit a JOIN #people p ON p.person_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(a.after_json)=1 THEN a.after_json ELSE N'{}' END,'$.person_id'))
 WHERE a.account_id=@account_id AND (
 a.action IN('claim.submitted','claim.approved','claim.changes_requested','claim.rejected') AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft c WHERE c.account_id=@account_id AND c.claim_id=a.target_id AND c.person_id=p.person_id AND (@category='' OR c.category=@category) AND (@skill IS NULL OR c.skill_id=@skill) AND CASE WHEN c.claimed_rank>5 THEN 5 ELSE c.claimed_rank END BETWEEN @rank AND @maxRank)
 OR a.action IN('certification.submitted','certification.approved','certification.changes_requested','certification.rejected') AND EXISTS(SELECT 1 FROM dbo.CertificationRecord c WHERE c.account_id=@account_id AND c.id=a.target_id AND c.person_id=p.person_id AND (@category='' OR c.category=@category) AND (@issuer='' OR c.provider=@issuer) AND (@validity='' OR @validity='EXPIRED' AND c.expiry_date<@today OR @validity='CURRENT' AND c.issue_date<=@today AND (c.expiry_date IS NULL OR c.expiry_date>=@today) OR @validity IN('14','30','60','90') AND c.expiry_date BETWEEN @today AND DATEADD(day,TRY_CONVERT(int,@validity),@today) OR @validity='15_30' AND c.expiry_date BETWEEN DATEADD(day,15,@today) AND DATEADD(day,30,@today) OR @validity='31_60' AND c.expiry_date BETWEEN DATEADD(day,31,@today) AND DATEADD(day,60,@today) OR @validity='61_90' AND c.expiry_date BETWEEN DATEADD(day,61,@today) AND DATEADD(day,90,@today) OR @validity='NO_EXPIRY' AND c.expiry_date IS NULL OR @validity='LATER' AND c.expiry_date>DATEADD(day,90,@today))))) e WHERE (@from IS NULL OR at>=@from) AND (@to IS NULL OR at<DATEADD(day,1,@to)) GROUP BY CONVERT(char(7),at,126) ORDER BY label FOR JSON PATH)) AS activity,
 JSON_QUERY(@rows) AS rows,@total AS total,@page AS page,@size AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.BusinessPeopleSearch
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@payload nvarchar(max),@export bit=0 AS BEGIN
 SET NOCOUNT ON;
 -- Use the same canonical projection as BusinessContext without INSERT EXEC.
 -- Its denial path rolls back its transaction, which SQL forbids under INSERT EXEC.
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount
  WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Personal access denied.',1;
 DECLARE @context nvarchar(max),@policy nvarchar(max)=dbo.BusinessProjection(@account_id,@actor_id);
 SET @context=(SELECT w.revision,@actor_id AS actorId,SYSUTCDATETIME() AS asOf,
  dbo.BusinessHasAccess(@account_id,@actor_id) AS canView,
  CONVERT(bit,CASE WHEN dbo.BusinessHasAccess(@account_id,@actor_id)=1 AND dbo.BusinessLegacyDenied(@account_id,@actor_id,'reports.export')=0 THEN 1 ELSE 0 END) AS canExport,
  CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'users.manage',0)=1 AND dbo.AccessCan(@account_id,@actor_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS canManage,
  dbo.BusinessAmendCan(@account_id,@actor_id) AS canAmend,
  CONVERT(bit,JSON_VALUE(@policy,'$.demandView')) AS canDemandView,
  CONVERT(bit,JSON_VALUE(@policy,'$.demandCreate')) AS canDemandCreate,
  CONVERT(bit,JSON_VALUE(@policy,'$.matchingRun')) AS canMatch,
  CONVERT(bit,JSON_VALUE(@policy,'$.shortlist')) AS canShortlist,
  CONVERT(bit,JSON_VALUE(@policy,'$.approve')) AS canApprove,
  w.personal_baseline_enabled AS personalBaseline,JSON_QUERY(JSON_QUERY(@policy,'$.scopes')) AS scopes,JSON_QUERY((SELECT * FROM dbo.BusinessHierarchy(@account_id,@actor_id) ORDER BY kind,name,id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS hierarchy
  FROM dbo.AccessWorkspace w JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE'
  WHERE w.account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF ISNULL(JSON_VALUE(@context,'$.canView'),'false')<>'true' OR ISNULL(JSON_VALUE(@context,'$.canMatch'),'false')<>'true'
  OR @export=1 AND ISNULL(JSON_VALUE(@context,'$.canExport'),'false')<>'true' THROW 51003,'Matching access denied.',1;
 IF ISJSON(@payload)<>1 OR DATALENGTH(@payload)>16000 THROW 51000,'Invalid matching request.',1;
 DECLARE @scope uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.scopeId')),
  @page int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.page')),
  @eligible bit=CASE JSON_VALUE(@payload,'$.onlyEligible') WHEN 'true' THEN 1 ELSE 0 END,
  @skills nvarchar(max)=JSON_QUERY(@payload,'$.skills'),@certs nvarchar(max)=JSON_QUERY(@payload,'$.certifications'),
  @required int,@requirements nvarchar(max),@total int,@eligibleTotal int,@size int=25,@offset int;
 IF @page IS NULL OR @page NOT BETWEEN 1 AND 10000 OR @skills IS NULL OR @certs IS NULL THROW 51000,'Invalid matching request.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='scopeId') AND (@scope IS NULL OR NOT EXISTS(
  SELECT 1 FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND person_id=@actor_id AND id=@scope
  AND dbo.BusinessResponsibilityUsable(@account_id,@actor_id,id)=1)) THROW 51003,'Selected scope unavailable.',1;
 SET @required=(SELECT COUNT(*) FROM OPENJSON(@skills))+(SELECT COUNT(*) FROM OPENJSON(@certs));
 IF @required NOT BETWEEN 1 AND 20 THROW 51000,'Choose 1 to 20 requirements.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@skills) s LEFT JOIN dbo.SkillCatalogue c ON c.account_id=@account_id
  AND c.skill_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(s.value,'$.id')) AND c.status='PUBLISHED'
  LEFT JOIN dbo.SkillDefinitionVersion v ON v.account_id=c.account_id AND v.skill_id=c.skill_id AND v.definition_revision=c.definition_revision
  WHERE c.skill_id IS NULL OR v.framework_id IS NULL OR v.framework_id<>'00000000-0000-4000-8000-000000000003'
  OR TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(s.value,'$.minRank')) NOT BETWEEN 1 AND 4)
  OR EXISTS(SELECT 1 FROM OPENJSON(@certs) s LEFT JOIN dbo.CredentialDefinition c ON c.account_id=@account_id AND c.id=TRY_CONVERT(uniqueidentifier,s.value) AND c.active=1
  LEFT JOIN dbo.CredentialProvider p ON p.account_id=c.account_id AND p.id=c.provider_id AND p.active=1 WHERE c.id IS NULL OR p.id IS NULL)
  THROW 51000,'Choose published four-level skills and active credentials.',1;
 IF EXISTS(SELECT JSON_VALUE(value,'$.id') FROM OPENJSON(@skills) GROUP BY JSON_VALUE(value,'$.id') HAVING COUNT(*)>1)
  OR EXISTS(SELECT value FROM OPENJSON(@certs) GROUP BY value HAVING COUNT(*)>1) THROW 51000,'Duplicate requirement.',1;
 SET @requirements=(SELECT JSON_QUERY(@skills) AS skills,JSON_QUERY(@certs) AS certifications FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 DECLARE @hierarchy uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.hierarchyId')),@hierarchyKind varchar(20);
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='hierarchyId') BEGIN
  SELECT @hierarchyKind=kind FROM dbo.BusinessHierarchy(@account_id,@actor_id) WHERE id=@hierarchy;
  IF @hierarchyKind IS NULL THROW 51003,'Selected hierarchy unavailable.',1;
 END;
 SELECT p.person_id,p.display_name,p.employee_code INTO #people FROM dbo.AccessPerson p
  JOIN dbo.BusinessVisiblePeople(@account_id,@actor_id,@scope) visible ON visible.person_id=p.person_id WHERE p.account_id=@account_id AND (@hierarchy IS NULL OR EXISTS(SELECT 1 FROM dbo.BusinessScopePeople(@account_id,@hierarchyKind,@hierarchy) h WHERE h.person_id=p.person_id));
 SELECT p.person_id,c.type,c.name,c.criterion,c.matched INTO #criteria FROM #people p
  CROSS APPLY dbo.BusinessMatchRequirements(@account_id,p.person_id,@requirements) c;
 SELECT p.person_id,p.display_name,p.employee_code,ISNULL(SUM(CONVERT(int,c.matched)),0) AS matched INTO #matches
  FROM #people p LEFT JOIN #criteria c ON c.person_id=p.person_id GROUP BY p.person_id,p.display_name,p.employee_code;
 SELECT @eligibleTotal=COUNT(*) FROM #matches WHERE matched=@required;
 SELECT @total=COUNT(*) FROM #matches WHERE @eligible=0 OR matched=@required;
 IF @export=1 AND @total>5000 THROW 51000,'Narrow the scope before exporting more than 5000 people.',1;
 IF @export=1 BEGIN SET @size=5000;SET @page=1;END;
 SET @offset=(@page-1)*@size;
 SELECT (SELECT JSON_QUERY(@context) AS context,@total AS total,@eligibleTotal AS eligibleTotal,@required AS required,@page AS page,@size AS pageSize,
  JSON_QUERY((SELECT CONVERT(varchar(36),m.person_id) AS id,m.display_name AS employee,m.employee_code AS employeeCode,m.matched,
   CONVERT(bit,CASE WHEN m.matched=@required THEN 1 ELSE 0 END) AS eligible,
   JSON_QUERY((SELECT type,name,criterion,matched FROM #criteria c WHERE c.person_id=m.person_id ORDER BY type,name FOR JSON PATH)) AS criteria
   FROM #matches m WHERE @eligible=0 OR m.matched=@required ORDER BY m.matched DESC,m.display_name,m.person_id
   OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY FOR JSON PATH)) AS rows,
  JSON_QUERY((SELECT type,name,criterion FROM dbo.BusinessMatchRequirements(@account_id,@actor_id,@requirements) ORDER BY type,name FOR JSON PATH)) AS requirements
  FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
END;
GO
