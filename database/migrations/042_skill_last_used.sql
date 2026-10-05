-- Optional employee-reported recency. Existing claims retain an unknown date.
ALTER TABLE dbo.SkillClaimDraft ADD last_used_on date NULL;
GO
CREATE OR ALTER PROCEDURE dbo.SaveOwnSkillClaim
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@claim_id uniqueidentifier,@expected_revision int,@payload nvarchar(max)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace_revision int,@before nvarchar(max),@after nvarchar(max);
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)<>1 OR dbo.AccessCan(@account_id,@actor_id,'skill.view',0)<>1 THROW 51003,'Own skill claim access denied.',1;
 IF @claim_id IS NULL OR @expected_revision IS NULL OR @expected_revision<0 OR ISJSON(@payload)<>1 THROW 51000,'Invalid draft.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key] NOT IN ('id','revision','skillId','definitionRevision','rank','experienceMonths','lastUsedOn','description','projects','evidence')) THROW 51000,'Only editable draft fields accepted.',1;
 DECLARE @skill uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.skillId')),
 @definition int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.definitionRevision')),@rank int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.rank')),
 @months int=TRY_CONVERT(int,JSON_VALUE(@payload,'$.experienceMonths')),@description nvarchar(4000)=LTRIM(RTRIM(JSON_VALUE(@payload,'$.description')));
 IF @skill IS NULL OR @definition IS NULL OR @definition<1 OR @rank IS NULL OR @rank NOT BETWEEN 1 AND 8 OR @months IS NULL OR @months NOT BETWEEN 0 AND 600 OR @description IS NULL OR LEN(@description)=0 OR DATALENGTH(@description)>4000 THROW 51000,'Invalid draft fields.',1;
 DECLARE @projects nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.projects'),N''),@evidence nvarchar(4000)=ISNULL(JSON_VALUE(@payload,'$.evidence'),N'');
 IF DATALENGTH(@projects)>4000 OR DATALENGTH(@evidence)>4000 THROW 51000,'Evidence or projects too long.',1;
 DECLARE @last_used_text nvarchar(max),@last_used date;
 IF (SELECT COUNT(*) FROM OPENJSON(@payload) WHERE [key]='lastUsedOn')>1 OR EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='lastUsedOn' AND [type] NOT IN (0,1)) THROW 51000,'Invalid last-used date.',1;
 SELECT @last_used_text=[value] FROM OPENJSON(@payload) WHERE [key]='lastUsedOn' AND [type]=1;
 IF @last_used_text IS NOT NULL
 BEGIN
  SET @last_used=TRY_CONVERT(date,@last_used_text,23);
  IF @last_used IS NULL OR DATALENGTH(@last_used_text)<>20 OR CONVERT(nvarchar(10),@last_used,23)<>@last_used_text OR @last_used>CONVERT(date,SYSUTCDATETIME()) THROW 51000,'Last used must be a real date on or before today (UTC).',1;
 END;
 DECLARE @current_definition int,@name nvarchar(100),@category nvarchar(80),@level nvarchar(60),@criteria nvarchar(1000);
 SELECT @current_definition=s.definition_revision,@name=s.display_name,@category=s.category,@level=l.display_name,@criteria=l.description FROM dbo.SkillCatalogue s JOIN dbo.SkillProficiencyLevel l ON l.account_id=s.account_id AND l.skill_id=s.skill_id AND l.rank=@rank WHERE s.account_id=@account_id AND s.skill_id=@skill AND s.status='PUBLISHED';
 IF @current_definition IS NULL THROW 51004,'Published skill and level unavailable.',1;
 IF @definition<>@current_definition THROW 51009,'Definition changed.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id) THROW 51004,'Own draft unavailable.',1;
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id AND revision=@expected_revision AND status IN ('DRAFT','CHANGES_REQUESTED','REJECTED')) THROW 51009,'Draft changed.',1;
 IF @expected_revision>0 AND EXISTS(SELECT 1 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND skill_id<>@skill) THROW 51000,'A draft cannot change its skill.',1;
 -- Older clients omit this field; omission preserves it, explicit null clears it.
 IF @expected_revision>0 AND NOT EXISTS(SELECT 1 FROM OPENJSON(@payload) WHERE [key]='lastUsedOn')
  SELECT @last_used=last_used_on FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id;
 SELECT @before=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @expected_revision=0
 BEGIN
 IF (SELECT COUNT(*) FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id)>=1000 THROW 51000,'Own draft limit reached.',1;
 INSERT dbo.SkillClaimDraft(account_id,claim_id,person_id,skill_id,revision,definition_revision,skill_name,category,claimed_rank,level_name,level_description,experience_months,last_used_on,description,projects,evidence)
 VALUES(@account_id,@claim_id,@actor_id,@skill,1,@definition,@name,@category,@rank,@level,@criteria,@months,@last_used,@description,@projects,@evidence);
 END
 ELSE UPDATE dbo.SkillClaimDraft SET revision=revision+1,definition_revision=@definition,skill_name=@name,category=@category,claimed_rank=@rank,level_name=@level,level_description=@criteria,experience_months=@months,last_used_on=@last_used,description=@description,projects=@projects,evidence=@evidence,updated_at=SYSUTCDATETIME() WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id;
 SELECT @after=(SELECT * FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND claim_id=@claim_id AND person_id=@actor_id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 UPDATE dbo.AccessWorkspace SET revision=revision+1 WHERE account_id=@account_id;
 INSERT dbo.AccessAudit(account_id,revision,actor_id,action,target_id,before_json,after_json) VALUES(@account_id,@workspace_revision+1,@actor_id,CASE @expected_revision WHEN 0 THEN 'claim.draft.created' ELSE 'claim.draft.updated' END,@claim_id,NULLIF(@before,''),@after);
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
CREATE OR ALTER PROCEDURE dbo.ReadOwnSkillClaims
 @account_id uniqueidentifier,@actor_id uniqueidentifier,@page int=1
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF ISNULL(IS_MEMBER('db_owner'),0)<>1 AND NOT EXISTS(SELECT 1 FROM dbo.AccessRuntimeAccount WHERE principal_id=DATABASE_PRINCIPAL_ID() AND account_id=@account_id) THROW 51003,'Workspace denied.',1;
 IF @page IS NULL OR @page<1 OR @page>100000 THROW 51000,'Invalid page.',1;
 BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @workspace_revision int;
 SELECT @workspace_revision=w.revision FROM dbo.AccessWorkspace w WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Account a ON a.account_id=w.account_id WHERE w.account_id=@account_id AND a.status='ACTIVE';
 IF @workspace_revision IS NULL THROW 51004,'Workspace unavailable.',1;
 IF dbo.AccessCan(@account_id,@actor_id,'profile.view',1)<>1 THROW 51003,'Own profile access denied.',1;
 SELECT COUNT(*) AS total,CONVERT(bit,CASE WHEN dbo.AccessCan(@account_id,@actor_id,'skill.claim',1)=1 AND dbo.AccessCan(@account_id,@actor_id,'skill.view',0)=1 THEN 1 ELSE 0 END) AS canClaim FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id;
 SELECT claim_id AS id,revision,skill_id AS skillId,skill_name AS skillName,category,definition_revision AS definitionRevision,claimed_rank AS rank,level_name AS levelName,level_description AS levelDescription,experience_months AS experienceMonths,CONVERT(char(10),last_used_on,23) AS lastUsedOn,description,status,updated_at AS updatedAt,projects,evidence,feedback,reviewer_id AS reviewerId
 FROM dbo.SkillClaimDraft WHERE account_id=@account_id AND person_id=@actor_id ORDER BY updated_at DESC,claim_id OFFSET ((@page-1)*25) ROWS FETCH NEXT 25 ROWS ONLY;
 COMMIT TRANSACTION;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;THROW;END CATCH;
END;
GO
-- Historical reviews use the submitted snapshot, never later private draft edits.
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
 CONVERT(char(10),CASE WHEN c.status='SUBMITTED' THEN c.last_used_on ELSE TRY_CONVERT(date,JSON_VALUE(s.after_json,'$.last_used_on'),23) END,23) AS lastUsedOn,
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
GRANT EXECUTE ON dbo.SaveOwnSkillClaim TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadOwnSkillClaims TO [skill_management_runtime];
GRANT EXECUTE ON dbo.ReadSkillReviewWorkbench TO [skill_management_runtime];
