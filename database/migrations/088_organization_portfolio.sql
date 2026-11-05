-- Mandatory structural level only. No PORTFOLIO permission scope or inferred grants.
-- Existing client IDs/parents are retained for explicit, audited mapping after installation.
DECLARE @constraint sysname;
SELECT @constraint=name FROM sys.check_constraints
WHERE parent_object_id=OBJECT_ID(N'dbo.AccessOrgNode')
 AND parent_column_id=COLUMNPROPERTY(OBJECT_ID(N'dbo.AccessOrgNode'),'kind','ColumnId');
IF @constraint IS NULL THROW 51000,'Organization kind constraint unavailable. Review schema before migration.',1;
DECLARE @statement nvarchar(max)=N'ALTER TABLE dbo.AccessOrgNode DROP CONSTRAINT '+QUOTENAME(@constraint);
EXEC sys.sp_executesql @statement;
ALTER TABLE dbo.AccessOrgNode ADD CONSTRAINT CK_AccessOrgNode_Kind
 CHECK(kind IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','TEAM'));
GO
CREATE OR ALTER FUNCTION dbo.OrganizationClientPath(@account uniqueidentifier) RETURNS TABLE AS RETURN (
 SELECT d.node_id AS department_id,d.display_name AS department_name,
 f.node_id AS portfolio_id,f.display_name AS portfolio_name,
 u.node_id AS unit_id,u.display_name AS unit_name
 FROM dbo.AccessOrgNode d
 JOIN dbo.AccessOrgNode f ON f.account_id=d.account_id AND f.node_id=d.parent_id AND f.kind='PORTFOLIO' AND f.active=1
 JOIN dbo.AccessOrgNode u ON u.account_id=f.account_id AND u.node_id=f.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
 WHERE d.account_id=@account AND d.kind='DEPARTMENT' AND d.active=1
);
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeValid(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier) RETURNS bit AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.Account WHERE account_id=@account AND status='ACTIVE') RETURN 0;
 IF @kind='ORGANIZATION' AND @scope IS NULL RETURN 1;
 IF @kind='PROJECT' AND EXISTS(SELECT 1 FROM dbo.BusinessProject WHERE account_id=@account AND id=@scope AND active=1) RETURN 1;
 IF @kind='DEPARTMENT' AND EXISTS(SELECT 1 FROM dbo.OrganizationClientPath(@account) WHERE department_id=@scope) RETURN 1;
 IF @kind='DELIVERY_UNIT' AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account AND node_id=@scope AND kind='DELIVERY_UNIT' AND active=1 AND parent_id IS NULL) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER TRIGGER dbo.BusinessProjectOrganizationPath ON dbo.BusinessProject AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted p WHERE p.active=1 AND p.department_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM dbo.OrganizationClientPath(p.account_id) WHERE department_id=p.department_id))
  THROW 51000,'Choose an active account/client with a complete Portfolio/Division path.',1;
END;
GO
CREATE OR ALTER PROCEDURE dbo.BusinessAdministration @account_id uniqueidentifier,@actor_id uniqueidentifier AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY BEGIN TRANSACTION;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 DECLARE @revision int;SELECT @revision=revision FROM dbo.AccessWorkspace WITH(HOLDLOCK) WHERE account_id=@account_id;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'audit.view',0)<>1 THROW 51003,'Administration denied.',1;
 SELECT (SELECT @revision AS revision,w.personal_baseline_enabled AS personalBaseline,
 (SELECT COUNT(*) FROM dbo.AccessPerson WHERE account_id=@account_id AND active=1) AS baselineAffectedPeople,
 JSON_QUERY((SELECT id,name,department_id AS departmentId,active FROM dbo.BusinessProject WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS projects,
 JSON_QUERY((SELECT project_id AS projectId,person_id AS personId,active FROM dbo.BusinessProjectMember WHERE account_id=@account_id FOR JSON PATH)) AS memberships,
 JSON_QUERY((SELECT id,person_id AS personId,bundle,scope_kind AS kind,scope_id AS scopeId,effect,active,valid_until AS validUntil,reason FROM dbo.BusinessResponsibility WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS responsibilities,
 JSON_QUERY((SELECT p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode,p.active,
 dbo.AccessCan(p.account_id,p.person_id,'profile.view',1) AS employeeAccess,
 CONVERT(bit,CASE WHEN dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'skill.verify',0)=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment report JOIN dbo.AccessPerson member ON member.account_id=report.account_id AND member.person_id=report.person_id AND member.active=1 WHERE report.account_id=p.account_id AND report.manager_id=p.person_id AND report.person_id<>p.person_id AND dbo.AccessReportingValid(report.account_id,report.person_id)=1) THEN 1 ELSE 0 END) AS managerAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.BusinessHasAccess(p.account_id,p.person_id)=1 THEN 1 ELSE 0 END) AS analyticsAccess,
 CONVERT(bit,CASE WHEN dbo.AccessCan(p.account_id,p.person_id,'profile.view',1)=1 AND dbo.AccessCan(p.account_id,p.person_id,'permissions.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'users.manage',0)=1 AND dbo.AccessCan(p.account_id,p.person_id,'audit.view',0)=1 THEN 1 ELSE 0 END) AS adminAccess
 FROM dbo.AccessPerson p WHERE p.account_id=@account_id ORDER BY p.employee_code FOR JSON PATH)) AS people,
 JSON_QUERY((SELECT node_id AS id,kind,display_name AS name,parent_id AS parentId,active,dbo.BusinessScopeValid(@account_id,kind,node_id) AS scopeValid FROM dbo.AccessOrgNode WHERE account_id=@account_id FOR JSON PATH,INCLUDE_NULL_VALUES)) AS nodes,
 JSON_QUERY((SELECT r.role_id AS roleId,r.permission_code AS permission,r.scope_kind AS scope,r.effect FROM dbo.AccountRolePermission r WHERE r.account_id=@account_id AND NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope s WHERE s.permission_code=r.permission_code AND s.scope_kind=r.scope_kind) FOR JSON PATH)) AS historicalGrantsForReview
 FROM dbo.AccessWorkspace w WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
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
 AND (@kind='DEPARTMENT' AND path.department_id=@scope OR @kind='DELIVERY_UNIT' AND path.unit_id=@scope)
 ) members WHERE dbo.BusinessScopeValid(@account,@kind,@scope)=1
);
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeMatches(@account uniqueidentifier,@person uniqueidentifier,@kind varchar(20),@scope uniqueidentifier) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.BusinessScopePeople(@account,@kind,@scope) WHERE person_id=@person) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessResponsibilityUsable(@account uniqueidentifier,@actor uniqueidentifier,@grant uniqueidentifier) RETURNS bit AS BEGIN
 IF EXISTS(SELECT 1 FROM dbo.BusinessResponsibility g WHERE g.account_id=@account AND g.person_id=@actor AND g.id=@grant AND g.active=1 AND g.effect='ALLOW' AND (g.valid_until IS NULL OR g.valid_until>SYSUTCDATETIME()) AND dbo.BusinessScopeValid(g.account_id,g.scope_kind,g.scope_id)=1
 AND NOT EXISTS(SELECT 1 FROM dbo.BusinessResponsibility d WHERE d.account_id=g.account_id AND d.person_id=g.person_id AND d.active=1 AND d.effect='DENY' AND (d.valid_until IS NULL OR d.valid_until>SYSUTCDATETIME()) AND
 (d.scope_kind='ORGANIZATION'
 OR d.scope_kind=g.scope_kind AND (d.scope_id=g.scope_id OR d.scope_id IS NULL AND g.scope_id IS NULL)
 OR d.scope_kind='DELIVERY_UNIT' AND g.scope_kind='DEPARTMENT' AND EXISTS(
 SELECT 1 FROM dbo.OrganizationClientPath(g.account_id) WHERE department_id=g.scope_id AND unit_id=d.scope_id)))) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.BusinessScopeCovers(@account uniqueidentifier,@kind varchar(20),@scope uniqueidentifier,@targetKind varchar(20),@target uniqueidentifier) RETURNS bit AS BEGIN
 IF dbo.BusinessScopeValid(@account,@kind,@scope)<>1 OR dbo.BusinessScopeValid(@account,@targetKind,@target)<>1 RETURN 0;
 IF @kind='ORGANIZATION' RETURN 1;
 IF @kind=@targetKind AND @scope=@target RETURN 1;
 IF @kind='DELIVERY_UNIT' AND @targetKind='DEPARTMENT' AND EXISTS(
 SELECT 1 FROM dbo.OrganizationClientPath(@account) WHERE department_id=@target AND unit_id=@scope) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadOwnOrganization @account_id uniqueidentifier,@actor_id uniqueidentifier AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace nvarchar(200),@revision int;
 SELECT @workspace=a.display_name,@revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Own profile access denied.',1;
 DECLARE @team uniqueidentifier,@department uniqueidentifier,@manager uniqueidentifier,
 @team_name nvarchar(100),@department_name nvarchar(100),@portfolio_name nvarchar(100),@unit_name nvarchar(100),@manager_name nvarchar(100),
 @placement varchar(20)='NOT_ASSIGNED',@reporting varchar(20)='NOT_ASSIGNED';
 SELECT @team=team_id,@department=department_id,@manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@actor_id;
 IF @team IS NOT NULL OR @department IS NOT NULL
 BEGIN
  SET @placement='NEEDS_ATTENTION';
  IF @team IS NOT NULL AND @department IS NULL
   SELECT @team_name=t.display_name,@department_name=path.department_name,@portfolio_name=path.portfolio_name,@unit_name=path.unit_name
   FROM dbo.AccessOrgNode t JOIN dbo.OrganizationClientPath(@account_id) path ON path.department_id=t.parent_id
   WHERE t.account_id=@account_id AND t.node_id=@team AND t.kind='TEAM' AND t.active=1;
  ELSE IF @team IS NULL AND @department IS NOT NULL
   SELECT @department_name=department_name,@portfolio_name=portfolio_name,@unit_name=unit_name
   FROM dbo.OrganizationClientPath(@account_id) WHERE department_id=@department;
  IF @department_name IS NOT NULL SET @placement='ASSIGNED';
 END;
 IF @manager IS NOT NULL
 BEGIN
  SET @reporting='NEEDS_ATTENTION';
  IF dbo.AccessReportingValid(@account_id,@actor_id)=1
   SELECT @manager_name=display_name FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@manager AND active=1 AND person_id<>@actor_id;
  IF @manager_name IS NOT NULL SET @reporting='ASSIGNED';
 END;
 SELECT @workspace AS workspace,@placement AS placementStatus,@unit_name AS deliveryUnit,@portfolio_name AS portfolio,
 @department_name AS department,@team_name AS team,@reporting AS managerStatus,@manager_name AS managerName;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.SaveOrganizationChange
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@expected_revision int,
 @kind varchar(20),@target_id uniqueidentifier,@is_new bit,@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int,@before nvarchar(max),@after nvarchar(max),@action varchar(50);
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF @expected_revision IS NULL OR @revision<>@expected_revision THROW 51009,'Configuration changed. Reload and try again.',1;
 IF @is_new IS NULL OR @target_id IS NULL THROW 51000,'Invalid organization target.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'permissions.manage',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'users.manage',0)<>1 THROW 51003,'Organization administration is not allowed.',1;
 IF ISJSON(@payload)<>1 THROW 51000,'Invalid organization change.',1;
 IF @kind='node'
 BEGIN
  DECLARE @type varchar(20)=JSON_VALUE(@payload,'$.type'),@name nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.name'))),
  @parent uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.parentId')),@active bit;
  SET @active=CASE JSON_VALUE(@payload,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END;
  IF @type IS NULL OR @type NOT IN('DELIVERY_UNIT','PORTFOLIO','DEPARTMENT','TEAM') OR @name IS NULL OR LEN(@name)=0 OR LEN(@name)>100 OR @active IS NULL THROW 51000,'Invalid unit name, type or status.',1;
  IF JSON_VALUE(@payload,'$.parentId') IS NOT NULL AND @parent IS NULL THROW 51000,'Invalid parent.',1;
  IF @type='DELIVERY_UNIT' AND @parent IS NOT NULL THROW 51000,'A delivery unit must be a root.',1;
  IF @type='PORTFOLIO' AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@parent AND kind='DELIVERY_UNIT' AND active=1 AND parent_id IS NULL)
   THROW 51000,'Choose an active delivery unit for this Portfolio/Division.',1;
  IF @type='DEPARTMENT' AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode f
   JOIN dbo.AccessOrgNode u ON u.account_id=f.account_id AND u.node_id=f.parent_id AND u.kind='DELIVERY_UNIT' AND u.active=1 AND u.parent_id IS NULL
   WHERE f.account_id=@account_id AND f.node_id=@parent AND f.kind='PORTFOLIO' AND f.active=1)
   THROW 51000,'Choose an active Portfolio/Division under a delivery unit.',1;
  IF @type='TEAM' AND NOT EXISTS(SELECT 1 FROM dbo.OrganizationClientPath(@account_id) WHERE department_id=@parent)
   THROW 51000,'Choose an active account/client with a Portfolio/Division and delivery unit.',1;
  IF @is_new=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id) THROW 51000,'Node already exists.',1;
  IF @is_new=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id AND kind=@type) THROW 51004,'Node unavailable or type changed.',1;
  IF @is_new=1 AND (SELECT COUNT(*) FROM dbo.AccessOrgNode WHERE account_id=@account_id)>=1000 THROW 51000,'Organization node limit reached.',1;
  IF @active=0 AND (EXISTS(SELECT 1 FROM dbo.AccessOrgNode WHERE account_id=@account_id AND parent_id=@target_id AND active=1)
   OR EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND (team_id=@target_id OR department_id=@target_id)))
   THROW 51000,'Move assigned people and archive active children first.',1;
  SELECT @before=(SELECT node_id AS id,kind AS type,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @is_new=1 INSERT dbo.AccessOrgNode(account_id,node_id,kind,display_name,parent_id,active) VALUES(@account_id,@target_id,@type,@name,@parent,@active);
  ELSE UPDATE dbo.AccessOrgNode SET display_name=@name,parent_id=@parent,active=@active WHERE account_id=@account_id AND node_id=@target_id;
  SELECT @after=(SELECT node_id AS id,kind AS type,display_name AS name,parent_id AS parentId,active FROM dbo.AccessOrgNode WHERE account_id=@account_id AND node_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @action=CASE @is_new WHEN 1 THEN 'organization.node.created' ELSE 'organization.node.updated' END;
 END
 ELSE IF @kind='assignment'
 BEGIN
  DECLARE @department uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.departmentId')),
  @team uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.teamId')),@manager uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.managerId'));
  IF (JSON_VALUE(@payload,'$.departmentId') IS NOT NULL AND @department IS NULL) OR (JSON_VALUE(@payload,'$.teamId') IS NOT NULL AND @team IS NULL)
   OR (JSON_VALUE(@payload,'$.managerId') IS NOT NULL AND @manager IS NULL) THROW 51000,'Invalid assignment identifier.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@target_id AND active=1) THROW 51004,'Active person unavailable.',1;
  IF @team IS NOT NULL AND @department IS NOT NULL THROW 51000,'Choose either an account/client or an organizational project.',1;
  IF @team IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgNode t JOIN dbo.OrganizationClientPath(@account_id) path ON path.department_id=t.parent_id
   WHERE t.account_id=@account_id AND t.node_id=@team AND t.kind='TEAM' AND t.active=1)
   THROW 51000,'Choose an active project with a complete Portfolio/Division path.',1;
  IF @department IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.OrganizationClientPath(@account_id) WHERE department_id=@department)
   THROW 51000,'Choose an active account/client with a complete Portfolio/Division path.',1;
  IF @manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@manager AND active=1) THROW 51000,'Choose an active reporting manager in this workspace.',1;
  IF @manager=@target_id THROW 51000,'A person cannot report to themselves.',1;
  DECLARE @cursor uniqueidentifier=@manager,@steps int=0;
  DECLARE @seen TABLE(id uniqueidentifier PRIMARY KEY);
  WHILE @cursor IS NOT NULL
  BEGIN
   IF @cursor=@target_id OR EXISTS(SELECT 1 FROM @seen WHERE id=@cursor) THROW 51000,'Reporting line would contain a cycle.',1;
   SET @steps=@steps+1;
   IF @steps>200 THROW 51000,'Reporting chain is too deep.',1;
   INSERT @seen VALUES(@cursor);
   DECLARE @next uniqueidentifier=NULL;
   SELECT @next=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@cursor;
   SET @cursor=@next;
  END;
  SELECT @before=(SELECT person_id AS personId,team_id AS teamId,department_id AS departmentId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id)
   UPDATE dbo.AccessOrgAssignment SET team_id=@team,department_id=@department,manager_id=@manager WHERE account_id=@account_id AND person_id=@target_id;
  ELSE INSERT dbo.AccessOrgAssignment(account_id,person_id,team_id,department_id,manager_id) VALUES(@account_id,@target_id,@team,@department,@manager);
  SELECT @after=(SELECT person_id AS personId,team_id AS teamId,department_id AS departmentId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@target_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  SET @action='organization.person.assigned';
 END
 ELSE THROW 51000,'Unknown organization change.',1;
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json)
 VALUES(@account_id,@revision+1,@actor_id,@action,@target_id,@before,@after);
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
