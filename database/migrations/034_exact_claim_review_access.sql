-- Exact assigned-claim authorization. Discovery is not a mutation token.
CREATE OR ALTER FUNCTION dbo.AccessCanReviewClaim(@account uniqueidentifier,@actor uniqueidentifier,@claim uniqueidentifier,@decision bit)
RETURNS bit AS
BEGIN
 IF @decision IS NULL OR dbo.AccessCan(@account,@actor,'profile.view',1)<>1 OR dbo.AccessCan(@account,@actor,'skill.verify',0)<>1 RETURN 0;
 DECLARE @owner uniqueidentifier,@reviewer uniqueidentifier,@status varchar(20);
 SELECT @owner=person_id,@reviewer=reviewer_id,@status=status FROM dbo.SkillClaimDraft WHERE account_id=@account AND claim_id=@claim;
 IF @owner IS NULL OR @owner=@actor OR @reviewer IS NULL OR @reviewer<>@actor OR @status='DRAFT' RETURN 0;
 IF @decision=1 AND @status<>'SUBMITTED' RETURN 0;
 IF dbo.AccessReportingValid(@account,@actor)<>1 OR dbo.AccessReportingValid(@account,@owner)<>1 RETURN 0;
 IF (SELECT COUNT(*) FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@owner)<>1 RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment WHERE account_id=@account AND person_id=@owner AND manager_id=@actor) RETURN 0;
 RETURN 1;
END;
GO
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
 WHERE c.account_id=@account_id AND c.reviewer_id=@actor_id AND o.manager_id=@actor_id AND c.person_id<>@actor_id AND c.status<>'DRAFT' AND dbo.AccessCanReviewClaim(@account_id,@actor_id,c.claim_id,0)=1;
 IF @claim_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM #allowed WHERE claim_id=@claim_id) THROW 51004,'Assigned review unavailable.',1;
 IF @person_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.AccessOrgAssignment o JOIN dbo.AccessPerson p ON p.account_id=o.account_id AND p.person_id=o.person_id AND p.active=1 WHERE o.account_id=@account_id AND o.manager_id=@actor_id AND o.person_id=@person_id AND o.person_id<>@actor_id AND dbo.AccessReportingValid(@account_id,o.person_id)=1) THROW 51004,'Team member unavailable.',1;
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
 c.feedback,c.person_id AS personId,c.reviewer_id AS reviewerId,a.display_name AS personName
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

CREATE OR ALTER PROCEDURE dbo.TransitionSkillClaim
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@expected_revision int,@action varchar(20),@feedback nvarchar(2000)=N''
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @action IS NULL OR @action NOT IN ('SUBMIT','APPROVE','REQUEST_CHANGES','REJECT') THROW 51000,'Invalid action.',1;
 BEGIN TRY BEGIN TRANSACTION;
 DECLARE @workspace int;
 SELECT @workspace=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Profile access denied.',1;
 DECLARE @owner uniqueidentifier,@reviewer uniqueidentifier,@manager uniqueidentifier,@revision int,@status varchar(20),@skill uniqueidentifier,@definition int,@before nvarchar(max),@after nvarchar(max);
 SELECT @owner=person_id,@reviewer=reviewer_id,@revision=revision,@status=status,@skill=skill_id,@definition=definition_revision FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id;
 IF @owner IS NULL THROW 51004,'Claim unavailable.',1;
 SELECT @manager=manager_id FROM dbo.AccessOrgAssignment WHERE account_id=@account_id AND person_id=@owner;
 IF @action='SUBMIT'
 BEGIN
  IF @owner<>@actor_id OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own submission denied.',1;
  IF dbo.AccessReportingValid(@account_id,@owner)<>1 OR @manager IS NULL OR @manager=@owner OR dbo.AccessCan(@account_id,@manager,'skill.verify',0)<>1 OR dbo.AccessCan(@account_id,@manager,'profile.view',1)<>1 THROW 51011,'Reporting reviewer unavailable.',1;
  IF @status NOT IN ('DRAFT','CHANGES_REQUESTED','REJECTED') AND NOT (@status='SUBMITTED' AND @reviewer<>@manager) THROW 51010,'Submission state invalid.',1;
  IF NOT EXISTS(SELECT 1 FROM dbo.SkillCatalogue WHERE account_id=@account_id AND skill_id=@skill AND status='PUBLISHED' AND definition_revision=@definition) THROW 51009,'Definition changed.',1;
 END
 ELSE
 BEGIN
  IF @action NOT IN ('APPROVE','REQUEST_CHANGES','REJECT') THROW 51000,'Invalid decision.',1;
  IF dbo.AccessCanReviewClaim(@account_id,@actor_id,@claim_id,0)<>1 OR @owner=@actor_id OR @reviewer IS NULL OR @reviewer<>@actor_id OR @manager IS NULL OR @manager<>@actor_id OR dbo.AccessCan(@account_id,@actor_id,'skill.verify',0)<>1 OR NOT EXISTS(SELECT 1 FROM dbo.AccessPerson WHERE account_id=@account_id AND person_id=@owner AND active=1) THROW 51003,'Assigned review denied.',1;
  IF @status<>'SUBMITTED' THROW 51010,'Claim is not awaiting review.',1;
  IF LEN(LTRIM(RTRIM(ISNULL(@feedback,N''))))=0 THROW 51000,'Feedback required.',1;
 END
 IF @expected_revision IS NULL OR @expected_revision<>@revision THROW 51009,'Claim changed.',1;
 SELECT @before=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.SkillClaimDraft SET revision=revision+1,status=CASE @action WHEN 'SUBMIT' THEN 'SUBMITTED' WHEN 'APPROVE' THEN 'APPROVED' WHEN 'REQUEST_CHANGES' THEN 'CHANGES_REQUESTED' ELSE 'REJECTED' END,
 reviewer_id=CASE WHEN @action='SUBMIT' THEN @manager ELSE reviewer_id END,
 feedback=CASE WHEN @action='SUBMIT' THEN N'' ELSE LTRIM(RTRIM(@feedback)) END,
 submitted_at=CASE WHEN @action='SUBMIT' THEN SYSUTCDATETIME() ELSE submitted_at END,reviewed_at=CASE WHEN @action='SUBMIT' THEN NULL ELSE SYSUTCDATETIME() END,updated_at=SYSUTCDATETIME()
 WHERE account_id=@account_id AND claim_id=@claim_id;
 SELECT @after=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace+1,@actor_id,CASE @action WHEN 'SUBMIT' THEN 'claim.submitted' WHEN 'APPROVE' THEN 'claim.approved' WHEN 'REQUEST_CHANGES' THEN 'claim.changes_requested' ELSE 'claim.rejected' END,@claim_id,@before,@after);
 INSERT dbo.SkillClaimNotification(account_id,person_id,claim_id,title,body,href) VALUES(@account_id,CASE WHEN @action='SUBMIT' THEN @manager ELSE @owner END,@claim_id,
 CASE @action WHEN 'SUBMIT' THEN 'Skill review requested' WHEN 'APPROVE' THEN 'Skill claim approved' WHEN 'REQUEST_CHANGES' THEN 'Changes requested' ELSE 'Skill claim rejected' END,
 CASE WHEN @action='SUBMIT' THEN 'A direct report submitted a skill claim for your review.' ELSE 'Your reporting manager reviewed your skill claim. Open My skills for feedback.' END,
 CASE WHEN @action='SUBMIT' THEN '/skill-reviews' ELSE '/my-skills' END);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
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
 WHERE p.account_id=@account_id AND p.active=1 AND o.manager_id=@actor_id AND p.person_id<>@actor_id AND dbo.AccessReportingValid(@account_id,p.person_id)=1;
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
