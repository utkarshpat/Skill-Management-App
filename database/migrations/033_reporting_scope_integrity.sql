-- Broken, ambiguous or cyclic reporting relationships never create review authority.
CREATE OR ALTER FUNCTION dbo.AccessReportingValid(@account uniqueidentifier,@person uniqueidentifier)
RETURNS bit AS
BEGIN
 DECLARE @seen TABLE(person_id uniqueidentifier PRIMARY KEY);
 DECLARE @current uniqueidentifier=@person,@manager uniqueidentifier,@depth int=0;
 WHILE @depth<=200
 BEGIN
  IF EXISTS(SELECT 1 FROM @seen WHERE person_id=@current) OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account AND person_id=@current AND active=1) RETURN 0;
  INSERT @seen VALUES(@current);
  IF (SELECT COUNT(*) FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@current)>1 RETURN 0;
  SET @manager=NULL;
  SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@current;
  IF @manager IS NULL RETURN 1;
  SET @current=@manager;SET @depth=@depth+1;
 END;
 RETURN 0;
END;
GO
CREATE OR ALTER FUNCTION dbo.AccessCan(@account uniqueidentifier,@person uniqueidentifier,@permission varchar(100),@own bit)
RETURNS bit AS
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessPerson p JOIN dbo.Account a ON a.account_id=p.account_id
 WHERE p.account_id=@account AND p.person_id=@person AND p.active=1 AND a.status='ACTIVE') RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope WHERE permission_code=@permission) RETURN 0;
 IF @permission='skill.verify' AND @own=0 AND dbo.AccessReportingValid(@account,@person)=0 RETURN 0;
 IF @permission='skill.verify' AND @own=0 AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person AND dbo.AccessReportingValid(@account,o.person_id)=1) RETURN 0;
 DECLARE @permissions TABLE(effect varchar(5));
 INSERT @permissions SELECT p.effect FROM dbo.AccountRolePermission p
 JOIN dbo.AccessPersonRole r ON r.account_id=p.account_id AND r.role_id=p.role_id
 WHERE r.account_id=@account AND r.person_id=@person AND p.permission_code=@permission
 AND (p.scope_kind='ORGANIZATION' OR (@own=1 AND p.scope_kind='OWN'))
 AND (p.valid_until IS NULL OR SYSUTCDATETIME()<p.valid_until)
 UNION ALL SELECT effect FROM dbo.AccessPersonOverride WHERE account_id=@account AND person_id=@person
 AND permission_code=@permission AND (scope_kind='ORGANIZATION' OR (@own=1 AND scope_kind='OWN'))
 AND (valid_until IS NULL OR SYSUTCDATETIME()<valid_until);
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='DENY') RETURN 0;
 IF EXISTS(SELECT 1 FROM @permissions WHERE effect='ALLOW') RETURN 1;
 IF @permission='skill.verify' AND @own=0 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=@account AND o.manager_id=@person AND o.person_id<>@person AND dbo.AccessReportingValid(@account,o.person_id)=1) RETURN 1;
 RETURN 0;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadAccessWorkspace @account_id uniqueidentifier AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessWorkspace w JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE') THROW 51004,'Workspace unavailable.',1;
 -- One consistent snapshot across the related result sets.
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
 BEGIN TRANSACTION;
 SELECT revision FROM dbo.AccessWorkspace WITH (UPDLOCK,HOLDLOCK) WHERE account_id=@account_id;
 SELECT role_id AS id,display_name AS name FROM dbo.AccountRole WHERE account_id=@account_id ORDER BY display_name;
 SELECT role_id AS roleId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil FROM dbo.AccountRolePermission WHERE account_id=@account_id;
 SELECT p.person_id AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.active,p.entra_object_id AS entraObjectId,CONVERT(bit,CASE WHEN p.active=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=p.account_id AND o.manager_id=p.person_id AND o.person_id<>p.person_id AND dbo.AccessReportingValid(p.account_id,o.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports FROM dbo.AccessPerson p WHERE p.account_id=@account_id ORDER BY p.employee_code;
 SELECT person_id AS personId,role_id AS roleId FROM dbo.AccessPersonRole WHERE account_id=@account_id;
 SELECT person_id AS personId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id;
 SELECT actor_id AS actorId,action,target_id AS targetId,occurred_at AS at,revision,before_json AS [before],after_json AS [after] FROM dbo.AccessAudit WHERE account_id=@account_id ORDER BY revision;
 SELECT person_id AS personId,manager_id AS managerId FROM dbo.AccessOrgAssignment WHERE account_id=@account_id;
 COMMIT TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
 END CATCH;
END;

GO

