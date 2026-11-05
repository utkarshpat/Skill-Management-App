-- Bounded, account-bound administration reads. Existing preview/save/audit contracts are unchanged.
CREATE OR ALTER PROCEDURE dbo.ReadPeopleAdministration
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@mode varchar(12),@person_id uniqueidentifier=NULL,
 @kind varchar(12)=NULL,@query nvarchar(100)=N'',@page int=1,@node_kind varchar(20)=NULL,@parent_id uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL OR dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 THROW 51003,'People administration denied.',1;
 SET @query=LTRIM(RTRIM(ISNULL(@query,N'')));
 IF @mode='DIRECTORY' BEGIN
  IF @kind IS NULL OR @kind NOT IN('people','templates','nodes') OR @page IS NULL OR @page NOT BETWEEN 1 AND 10000 THROW 51000,'Invalid directory search.',1;
  IF @kind='nodes' AND (@node_kind IS NULL OR @node_kind NOT IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','TEAM') OR @node_kind='DELIVERY_UNIT' AND @parent_id IS NOT NULL OR @node_kind<>'DELIVERY_UNIT' AND @parent_id IS NULL) THROW 51000,'Choose the preceding organization level.',1;
  DECLARE @offset int=(@page-1)*10,@total int,@items nvarchar(max);
  IF @kind='people' AND LEN(@query)<2 BEGIN
   SELECT (SELECT @revision AS revision,JSON_QUERY('[]') AS items,0 AS total,@page AS page,10 AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
   COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;RETURN;
  END;
  IF @kind='people' BEGIN
   SELECT @total=COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND (CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,employee_code)>0);
   SET @items=(SELECT LOWER(CONVERT(varchar(36),person_id)) AS id,display_name AS name,employee_code AS employeeCode,active FROM dbo.AccessPerson WHERE account_id=@account_id AND (CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,employee_code)>0) ORDER BY display_name,person_id OFFSET @offset ROWS FETCH NEXT 10 ROWS ONLY FOR JSON PATH);
  END ELSE IF @kind='templates' BEGIN
   SELECT @total=COUNT(*) FROM dbo.AccountRole WHERE account_id=@account_id AND (@query=N'' OR CHARINDEX(@query,display_name)>0);
   SET @items=(SELECT LOWER(CONVERT(varchar(36),r.role_id)) AS id,r.display_name AS name,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission p WHERE p.account_id=r.account_id AND p.role_id=r.role_id FOR JSON PATH)) AS permissions FROM dbo.AccountRole r WHERE r.account_id=@account_id AND (@query=N'' OR CHARINDEX(@query,r.display_name)>0) ORDER BY r.display_name,r.role_id OFFSET @offset ROWS FETCH NEXT 10 ROWS ONLY FOR JSON PATH);
  END ELSE BEGIN
   DECLARE @nodes TABLE(id uniqueidentifier PRIMARY KEY,name nvarchar(100),parent_id uniqueidentifier,kind varchar(20));
   INSERT @nodes SELECT node_id,display_name,parent_id,kind FROM dbo.AccessOrgNode WHERE account_id=@account_id AND active=1 AND kind=@node_kind AND (parent_id=@parent_id OR parent_id IS NULL AND @parent_id IS NULL) AND (@query=N'' OR CHARINDEX(@query,display_name)>0)
   AND CASE WHEN kind='TEAM' THEN dbo.BusinessScopeValid(@account_id,'DEPARTMENT',parent_id) ELSE dbo.BusinessScopeValid(@account_id,kind,node_id) END=1;
   SELECT @total=COUNT(*) FROM @nodes;
   SET @items=(SELECT LOWER(CONVERT(varchar(36),id)) AS id,name,LOWER(CONVERT(varchar(36),parent_id)) AS parentId,kind,CAST(1 AS bit) AS active FROM @nodes ORDER BY name,id OFFSET @offset ROWS FETCH NEXT 10 ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES);
  END;
  SELECT (SELECT @revision AS revision,JSON_QUERY(COALESCE(@items,'[]')) AS items,@total AS total,@page AS page,10 AS pageSize FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 END ELSE IF @mode='PERSON' BEGIN
  IF @person_id IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person_id) THROW 51004,'Person unavailable.',1;
  DECLARE @path TABLE(id uniqueidentifier PRIMARY KEY,kind varchar(20),name nvarchar(100),parent_id uniqueidentifier,active bit);
  ;WITH ancestry AS (
   SELECT n.node_id,n.kind,n.display_name,n.parent_id,n.active,0 AS depth FROM dbo.AccessOrgAssignment a JOIN dbo.AccessOrgNode n ON n.account_id=a.account_id AND n.node_id=COALESCE(a.team_id,a.department_id) WHERE a.account_id=@account_id AND a.person_id=@person_id
   UNION ALL SELECT n.node_id,n.kind,n.display_name,n.parent_id,n.active,p.depth+1 FROM dbo.AccessOrgNode n JOIN ancestry p ON p.parent_id=n.node_id WHERE n.account_id=@account_id AND p.depth<3
  ) INSERT @path SELECT DISTINCT node_id,kind,display_name,parent_id,active FROM ancestry;
  SELECT (SELECT @revision AS revision,
   JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),p.person_id)) AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.active,p.job_title AS jobTitle,p.grade,
    LOWER(CONVERT(varchar(36),p.primary_capability_id)) AS primaryCapabilityId,c.display_name AS primaryCapabilityName,c.status AS primaryCapabilityStatus,
    CONVERT(bit,CASE WHEN p.active=1 AND dbo.AccessReportingValid(@account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment a JOIN dbo.AccessPerson report ON report.account_id=a.account_id AND report.person_id=a.person_id AND report.active=1 WHERE a.account_id=@account_id AND a.manager_id=p.person_id AND a.person_id<>p.person_id AND dbo.AccessReportingValid(@account_id,a.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports,
    JSON_QUERY(dbo.BusinessProjection(@account_id,p.person_id)) AS business,
    JSON_QUERY(COALESCE((SELECT '['+STRING_AGG(CONVERT(nvarchar(max),'"'+LOWER(CONVERT(varchar(36),role_id))+'"'),',')+']' FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=p.person_id),'[]')) AS roleIds,
    JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=p.person_id FOR JSON PATH)) AS overrides
    FROM dbo.AccessPerson p LEFT JOIN dbo.SkillCatalogue c ON c.account_id=p.account_id AND c.skill_id=p.primary_capability_id WHERE p.account_id=@account_id AND p.person_id=@person_id FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER)) AS person,
   JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),r.role_id)) AS id,r.display_name AS name,JSON_QUERY((SELECT permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission p WHERE p.account_id=r.account_id AND p.role_id=r.role_id FOR JSON PATH)) AS permissions FROM dbo.AccountRole r JOIN dbo.AccessPersonRole a ON a.account_id=r.account_id AND a.role_id=r.role_id WHERE a.account_id=@account_id AND a.person_id=@person_id FOR JSON PATH)) AS roles,
   JSON_QUERY((SELECT JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),id)) AS id,kind,name,LOWER(CONVERT(varchar(36),parent_id)) AS parentId,active FROM @path FOR JSON PATH,INCLUDE_NULL_VALUES)) AS nodes,
    JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),person_id)) AS personId,LOWER(CONVERT(varchar(36),department_id)) AS departmentId,LOWER(CONVERT(varchar(36),team_id)) AS teamId,LOWER(CONVERT(varchar(36),manager_id)) AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@person_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS assignments,
    JSON_QUERY((SELECT LOWER(CONVERT(varchar(36),p.person_id)) AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.active FROM dbo.AccessPerson p JOIN dbo.AccessOrgAssignment a ON a.account_id=p.account_id AND a.manager_id=p.person_id WHERE a.account_id=@account_id AND a.person_id=@person_id FOR JSON PATH)) AS people
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) AS organization
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 END ELSE THROW 51000,'Invalid administration read.',1;
 COMMIT;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadPeopleAdministration TO [skill_management_runtime];
GO

CREATE OR ALTER PROCEDURE dbo.BusinessAdministration @account_id uniqueidentifier,@actor_id uniqueidentifier,@person_id uniqueidentifier=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Administration denied.',1;
 IF @person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@person_id) THROW 51004,'Person unavailable.',1;
 SELECT (SELECT @revision AS revision,w.personal_baseline_enabled AS personalBaseline,
 (SELECT COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND active=1) AS baselineAffectedPeople,
 JSON_QUERY((SELECT id,name,department_id AS departmentId,active FROM dbo.BusinessProject WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS projects,
 JSON_QUERY((SELECT project_id AS projectId,person_id AS personId,active FROM dbo.BusinessProjectMember WHERE account_id=@account_id AND (@person_id IS NULL OR person_id=@person_id) FOR JSON PATH)) AS memberships,
 JSON_QUERY((SELECT id,person_id AS personId,bundle,scope_kind AS kind,scope_id AS scopeId,effect,active,valid_until AS validUntil,reason FROM dbo.BusinessResponsibility WHERE account_id=@account_id AND (@person_id IS NULL OR person_id=@person_id) FOR JSON PATH,INCLUDE_NULL_VALUES)) AS responsibilities,
 JSON_QUERY((SELECT p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode,p.active,
 dbo.AccessCan(p.account_id,p.person_id,'profile.view',1) AS employeeAccess,
 CONVERT(bit,CASE WHEN dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS managerAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.BusinessHasAccess(p.account_id,p.person_id)=1 THEN 1 ELSE 0 END) AS analyticsAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'permissions.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'users.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS adminAccess
 FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND (@person_id IS NULL OR p.person_id=@person_id) ORDER BY p.employee_code FOR JSON PATH)) AS people,
 JSON_QUERY((SELECT node_id AS id,kind,display_name AS name,parent_id AS parentId,active,dbo.BusinessScopeValid(@account_id,kind,node_id) AS scopeValid FROM dbo.AccessOrgNode WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS nodes,
 JSON_QUERY((SELECT r.role_id AS roleId,r.permission_code AS permission,r.scope_kind AS scope,r.effect FROM dbo.AccountRolePermission r WHERE r.account_id=@account_id AND NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope s WHERE s.permission_code=r.permission_code AND s.scope_kind=r.scope_kind) FOR JSON PATH)) AS historicalGrantsForReview
 FROM dbo.AccessWorkspace w WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO
