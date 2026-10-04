-- Current direct-report scope. Private drafts and unrelated reporting branches stay hidden.
CREATE OR ALTER PROCEDURE dbo.ReadDirectReportCapability
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@query nvarchar(100)=N'',@page int=1,@person_id uniqueidentifier=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 OR @query IS NULL THROW 51000,'Invalid team query.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @revision int;
 SELECT @revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Team capability denied.',1;
 SELECT p.person_id,p.display_name,p.employee_code INTO #scope FROM dbo.AccessPerson p
 JOIN dbo.AccessOrgAssignment o ON o.account_id=p.account_id AND o.person_id=p.person_id
 WHERE p.account_id=@account_id AND p.active=1 AND o.manager_id=@actor_id AND p.person_id<>@actor_id;
 IF @person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM #scope WHERE person_id=@person_id) THROW 51004,'Team member unavailable.',1;
 SELECT * INTO #filtered FROM #scope WHERE (@person_id IS NULL OR person_id=@person_id) AND (@query=N'' OR CHARINDEX(@query,display_name)>0 OR CHARINDEX(@query,employee_code)>0);
 SELECT COUNT(*) AS total FROM #filtered;
 SELECT * INTO #paged FROM #filtered ORDER BY display_name,person_id OFFSET ((@page-1)*12) ROWS FETCH NEXT 12 ROWS ONLY;
 SELECT p.person_id AS id,p.display_name AS name,p.employee_code AS employeeCode,
 COUNT(CASE WHEN c.status='APPROVED' THEN 1 END) AS reviewed,
 COUNT(CASE WHEN c.status='SUBMITTED' AND c.reviewer_id=@actor_id THEN 1 END) AS pending
 FROM #paged p LEFT JOIN dbo.SkillClaimDraft c ON c.account_id=@account_id AND c.person_id=p.person_id
 GROUP BY p.person_id,p.display_name,p.employee_code ORDER BY p.display_name,p.person_id;
 SELECT c.person_id AS personId,c.skill_name AS skillName,c.category,c.claimed_rank AS rank,c.level_name AS levelName,c.status
 FROM dbo.SkillClaimDraft c JOIN #paged p ON p.person_id=c.person_id WHERE c.account_id=@account_id AND @person_id IS NOT NULL
 AND (c.status='APPROVED' OR (c.status='SUBMITTED' AND c.reviewer_id=@actor_id)) ORDER BY p.display_name,c.skill_name,c.claim_id;
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadDirectReportCapability TO [skill_management_runtime];
GO
