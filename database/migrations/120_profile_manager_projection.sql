CREATE OR ALTER PROCEDURE dbo.ReadProfileManager
 @account_id uniqueidentifier,@actor_id uniqueidentifier
AS BEGIN
 SET NOCOUNT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(
  SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id
 ) THROW 51003,'Workspace denied.',1;
 SELECT w.revision,o.manager_id AS managerId,m.employee_code AS employeeCode
 FROM dbo.AccessWorkspace w
 JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE'
 LEFT JOIN dbo.AccessOrgAssignment o ON o.account_id=w.account_id AND o.person_id=@actor_id
 LEFT JOIN dbo.AccessPerson m ON m.account_id=w.account_id AND m.person_id=o.manager_id AND m.active=1
 WHERE w.account_id=@account_id AND dbo.AccessCan(@account_id,@actor_id,'profile.view',1)=1;
END;
GO
GRANT EXECUTE ON dbo.ReadProfileManager TO [skill_management_runtime];
GO
