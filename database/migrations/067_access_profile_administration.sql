-- Canonical read-only access profiles. Assignments still use revision-bound SaveBusinessChange.
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
 JSON_QUERY((SELECT node_id AS id,kind,display_name AS name,active FROM dbo.AccessOrgNode WHERE account_id=@account_id FOR JSON PATH)) AS nodes,
 JSON_QUERY((SELECT r.role_id AS roleId,r.permission_code AS permission,r.scope_kind AS scope,r.effect FROM dbo.AccountRolePermission r WHERE r.account_id=@account_id AND NOT EXISTS(SELECT 1 FROM dbo.AccessImplementedScope s WHERE s.permission_code=r.permission_code AND s.scope_kind=r.scope_kind) FOR JSON PATH)) AS historicalGrantsForReview
 FROM dbo.AccessWorkspace w WHERE account_id=@account_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS json;
 COMMIT TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;THROW;END CATCH;
END;
GO

