-- Filtered assigned reviews and immutable submission/decision history.
CREATE OR ALTER PROCEDURE dbo.ReadSkillReviewWorkbench
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@page int=1,@query nvarchar(100)=N'',@category nvarchar(80)=N'',
 @status varchar(20)='SUBMITTED',@person_id uniqueidentifier=NULL,@claim_id uniqueidentifier=NULL,@history_page int=1
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 OR @history_page IS NULL OR @history_page<1 OR @history_page>100000 OR @query IS NULL OR @category IS NULL OR @status IS NULL OR @status NOT IN ('SUBMITTED','APPROVED','CHANGES_REQUESTED','REJECTED','ALL') THROW 51000,'Invalid review filter.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id AND a.status='ACTIVE' WHERE w.account_id=@account_id;
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 THROW 51003,'Review access denied.',1;
 SELECT c.claim_id,p.display_name,p.employee_code INTO #allowed FROM dbo.SkillClaimDraft c
 JOIN dbo.AccessPerson p ON p.account_id=c.account_id AND p.person_id=c.person_id AND p.active=1
 JOIN dbo.AccessOrgAssignment o ON o.account_id=c.account_id AND o.person_id=c.person_id
 WHERE c.account_id=@account_id AND c.reviewer_id=@actor_id AND o.manager_id=@actor_id AND c.person_id<>@actor_id AND c.status<>'DRAFT';
 IF @claim_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM #allowed WHERE claim_id=@claim_id) THROW 51004,'Assigned review unavailable.',1;
 IF @person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson p ON p.account_id=o.account_id AND p.person_id=o.person_id AND p.active=1 WHERE o.account_id=@account_id AND o.manager_id=@actor_id AND o.person_id=@person_id AND o.person_id<>@actor_id) THROW 51004,'Team member unavailable.',1;
 SELECT c.claim_id INTO #matching FROM dbo.SkillClaimDraft c JOIN #allowed a ON a.claim_id=c.claim_id
 WHERE c.account_id=@account_id AND (@claim_id IS NULL OR c.claim_id=@claim_id) AND (@person_id IS NULL OR c.person_id=@person_id)
 AND (@category=N'' OR c.category=@category) AND (@query=N'' OR CHARINDEX(@query,a.display_name)>0 OR CHARINDEX(@query,a.employee_code)>0 OR CHARINDEX(@query,c.skill_name)>0);
 SELECT c.claim_id INTO #filtered FROM dbo.SkillClaimDraft c JOIN #matching m ON m.claim_id=c.claim_id WHERE c.account_id=@account_id AND (@status='ALL' OR c.status=@status);
 SELECT COUNT(*) AS total,CONVERT(bit,0) AS canClaim FROM #filtered;
 SELECT c.claim_id INTO #paged FROM dbo.SkillClaimDraft c JOIN #filtered f ON f.claim_id=c.claim_id WHERE c.account_id=@account_id ORDER BY c.updated_at DESC,c.claim_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 SELECT c.claim_id AS id,c.revision,c.skill_id AS skillId,c.skill_name AS skillName,c.category,
 CASE WHEN c.status='SUBMITTED' THEN c.definition_revision ELSE TRY_CONVERT(int,JSON_VALUE(s.after_json,'$.definition_revision')) END AS definitionRevision,
 CASE WHEN c.status='SUBMITTED' THEN c.claimed_rank ELSE TRY_CONVERT(int,JSON_VALUE(s.after_json,'$.claimed_rank')) END AS rank,
 CASE WHEN c.status='SUBMITTED' THEN c.level_name ELSE ISNULL(JSON_VALUE(s.after_json,'$.level_name'),N'Unavailable') END AS levelName,
 CASE WHEN c.status='SUBMITTED' THEN c.level_description ELSE ISNULL(JSON_VALUE(s.after_json,'$.level_description'),N'') END AS levelDescription,
 CASE WHEN c.status='SUBMITTED' THEN c.experience_months ELSE TRY_CONVERT(int,JSON_VALUE(s.after_json,'$.experience_months')) END AS experienceMonths,
 CASE WHEN c.status='SUBMITTED' THEN c.description ELSE ISNULL(JSON_VALUE(s.after_json,'$.description'),N'') END AS description,
 c.status,c.updated_at AS updatedAt,
 CASE WHEN c.status='SUBMITTED' THEN c.projects ELSE ISNULL(JSON_VALUE(s.after_json,'$.projects'),N'') END AS projects,
 CASE WHEN c.status='SUBMITTED' THEN c.evidence ELSE ISNULL(JSON_VALUE(s.after_json,'$.evidence'),N'') END AS evidence,
 c.feedback,c.reviewer_id AS reviewerId,a.display_name AS personName
 FROM dbo.SkillClaimDraft c JOIN #paged t ON t.claim_id=c.claim_id JOIN #allowed a ON a.claim_id=c.claim_id
 OUTER APPLY(SELECT TOP(1) u.after_json FROM dbo.AccessAudit u WHERE u.account_id=c.account_id AND u.target_id=c.claim_id AND u.action='claim.submitted' ORDER BY u.revision DESC) s
 WHERE c.account_id=@account_id ORDER BY c.updated_at DESC,c.claim_id;
 SELECT DISTINCT c.category FROM dbo.SkillClaimDraft c JOIN #allowed a ON a.claim_id=c.claim_id WHERE c.account_id=@account_id ORDER BY c.category;
 SELECT COUNT(CASE WHEN c.status='SUBMITTED' THEN 1 END) AS pending,COUNT(CASE WHEN c.status='APPROVED' THEN 1 END) AS approved,
 COUNT(CASE WHEN c.status='CHANGES_REQUESTED' THEN 1 END) AS changes,COUNT(CASE WHEN c.status='REJECTED' THEN 1 END) AS rejected FROM dbo.SkillClaimDraft c JOIN #matching m ON m.claim_id=c.claim_id WHERE c.account_id=@account_id;
 SELECT u.revision,u.action,u.occurred_at AS at,p.display_name AS actorName,ISNULL(JSON_VALUE(u.after_json,'$.feedback'),N'') AS feedback
 FROM dbo.AccessAudit u JOIN dbo.AccessPerson p ON p.account_id=u.account_id AND p.person_id=u.actor_id
 WHERE u.account_id=@account_id AND u.target_id=@claim_id AND u.action IN ('claim.submitted','claim.approved','claim.changes_requested','claim.rejected')
 ORDER BY u.revision DESC OFFSET ((@history_page-1)*20) ROWS FETCH NEXT 20 ROWS ONLY;
 SELECT COUNT(*) AS total FROM dbo.AccessAudit WHERE account_id=@account_id AND target_id=@claim_id AND action IN ('claim.submitted','claim.approved','claim.changes_requested','claim.rejected');
 COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON dbo.ReadSkillReviewWorkbench TO [skill_management_runtime];
GO
