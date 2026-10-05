-- Authorization-only reads: actor grants + SQL-resolved reporting flag, no roster/audit history.
CREATE OR ALTER PROCEDURE dbo.ReadActorAccessContext
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@include_notifications bit=0 AS
BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace access denied.',1;
 SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRY
 BEGIN TRANSACTION;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessWorkspace w WITH(HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE') THROW 51004,'Workspace unavailable.',1;
 SELECT revision FROM dbo.AccessWorkspace WHERE account_id=@account_id;
 SELECT r.role_id AS id,r.display_name AS name FROM dbo.AccountRole r JOIN dbo.AccessPersonRole pr ON pr.account_id=r.account_id AND pr.role_id=r.role_id WHERE r.account_id=@account_id AND pr.person_id=@actor_id ORDER BY r.display_name;
 SELECT p.role_id AS roleId,p.permission_code AS permission,p.scope_kind AS scope,p.effect,p.valid_until AS validUntil FROM dbo.AccountRolePermission p JOIN dbo.AccessPersonRole pr ON pr.account_id=p.account_id AND pr.role_id=p.role_id WHERE p.account_id=@account_id AND pr.person_id=@actor_id;
 SELECT p.person_id AS id,p.display_name AS displayName,p.employee_code AS employeeCode,p.job_title AS jobTitle,p.grade,p.active,p.entra_object_id AS entraObjectId,
 CONVERT(bit,CASE WHEN p.active=1 AND dbo.AccessReportingValid(p.account_id,p.person_id)=1 AND EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson report ON report.account_id=o.account_id AND report.person_id=o.person_id AND report.active=1 WHERE o.account_id=p.account_id AND o.manager_id=p.person_id AND o.person_id<>p.person_id AND dbo.AccessReportingValid(p.account_id,o.person_id)=1) THEN 1 ELSE 0 END) AS hasDirectReports
 FROM dbo.AccessPerson p WHERE p.account_id=@account_id AND p.person_id=@actor_id;
 SELECT person_id AS personId,role_id AS roleId FROM dbo.AccessPersonRole WHERE account_id=@account_id AND person_id=@actor_id;
 SELECT person_id AS personId,permission_code AS permission,scope_kind AS scope,effect,valid_until AS validUntil,reason FROM dbo.AccessPersonOverride WHERE account_id=@account_id AND person_id=@actor_id;
 SELECT TOP(30) actor_id AS actorId,action,target_id AS targetId,occurred_at AS at,revision,before_json AS [before],after_json AS [after] FROM dbo.AccessAudit WHERE account_id=@account_id AND @include_notifications=1 AND target_id=@actor_id AND action='person.updated' ORDER BY revision DESC;
 COMMIT TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 THROW;
 END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadActorAccessContext TO [skill_management_runtime];
GO
